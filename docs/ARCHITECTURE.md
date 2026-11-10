# Architecture

How the dashboard fits together, and where each tool can be replaced. Function and file names here are the real ones, so search for them.

## The short version

```text
Google Ads API
  -> scheduled job (/api/cron/daily)
  -> src/lib/sync (publish functions in Postgres)
  -> fact tables
  -> read functions in Postgres
  -> /api/report/* (session required)
  -> hooks and pure shaping in the browser
  -> tiles, tables and charts
```

Only the server touches the database. Every table has row level security on and no policies, so the service role key is the only way in.

## From the Google Ads API to a chart

### Writing

1. `vercel.json` calls `GET /api/cron/daily` once a day. The route checks `isCronRequest` in `src/lib/requestGuards.ts`.
2. `dailySteps` in `src/lib/sync/dailyPlan.ts` lists the steps. Each step calls a route handler in `src/app/api/cron/` directly, for example `google-ads?dataset=campaign`.
3. `src/app/api/cron/google-ads/route.ts` works out the window with `defaultWindow`, reads the accounts with `listAccounts`, and calls `syncDataset` per account.
4. `syncDataset` in `src/lib/sync/googleAdsSync.ts` starts a row in `sync_runs` with `startRun`, then builds an API client with `getCustomer` in `src/lib/googleAds/client.ts`.
5. For the `campaign` dataset, `syncCampaignDim` runs first. `fetchCampaignDim` reads every campaign, `classifyCampaign` in `src/lib/campaignParser.ts` turns each name into network, category and bucket, and `upsert_campaign_dim` stores them. Rows in `campaign_overrides` win here.
6. A fetch function in `src/lib/googleAds/datasets.ts`, such as `fetchCampaignDaily`, runs the GAQL and maps the rows. `micros` turns cost into currency units.
7. `publishFacts` calls `publish_daily_facts`. It deletes the account's rows for the whole date range and inserts the new ones in one transaction, so readers never see a half-written range. Above 20,000 rows, later chunks are plain inserts.
8. `completeRun` or `failRun` closes the `sync_runs` row, which is what the Status page shows.

### Reading

1. The Overview page, `src/app/(dashboard)/page.tsx`, calls `useCampaignReport` in `src/hooks/useReport.ts`. The account, period and comparison come from `useScope` in `src/components/ScopeContext.tsx`, and live in the URL.
2. The hook fetches `GET /api/report/campaigns`. The route calls `requireSession`, resolves accounts and picks a grain with `chooseGrain`.
3. `readCampaignFacts` in `src/lib/reports.ts` calls `read_campaign_facts_json`, which groups `ads_campaign_daily` by period and campaign and joins `campaign_dim`.
4. The browser applies the top-bar filters with `applyFilters` in `src/lib/filters.ts`. Filtering happens client-side, on rows already fetched.
5. `useOverviewView` in `src/components/overview/shared.tsx` shapes the rows with `totals` and `byPeriod` from `src/lib/reportShaping.ts`. Those use `sumRows` and `derive` from `src/lib/metrics.ts`, where ratios such as ROAS and CPA are computed from totals, never averaged.
6. `KpiTiles`, `BreakdownTables` and `GoalMeters` render the result. The Overview page has tiles and tables. The line charts are on Trends, `src/app/(dashboard)/trends/page.tsx`, which uses the same report, `rollingPeriods` and `TrendChart` (Recharts).

Other pages follow the same path: page, hook in `src/hooks/`, route in `src/app/api/report/`, reader in `src/lib/reports-*.ts`, read function, and pure shaping in `src/lib/*Shaping.ts`.

## Demo mode

`resolveDemoMode` in `demo-mode.js` decides once, at build time. `next.config.js` writes the answer into `NEXT_PUBLIC_DEMO_MODE`.

| Situation | Result |
|---|---|
| `npm run dev`, no database settings | Demo |
| `npm run dev`, database settings present | Real database |
| Production build | Real database, unless `DASHBOARD_DEMO=1` |
| `DASHBOARD_DEMO=1` with database settings | Refuses to start |

In demo mode:

- `getSupabaseAdmin` in `src/lib/supabaseAdmin.ts` returns the fake client from `src/lib/demo/fakeClient.ts` through a `require`, so a normal build does not include it. Pages and routes do not change.
- The fake client has the same `.from(table)` and `.rpc(name, args)` shape as Supabase. `Store.rpc` answers each read function from `src/lib/demo/reads.ts`. Any other name, including every sync write, returns "Not available in the demo".
- `DemoWorld` in `src/lib/demo/world.ts` generates the data from a seed and from how many days ago a date is, so the demo always ends yesterday and the same seed gives the same numbers. It takes the first two accounts from the config and runs its campaign names through the real `classifyCampaign`.
- Table writes, such as action status, stay in memory until a restart. One fake database is kept per day.
- `requireSession` in `src/lib/auth.ts` returns `DEMO_SESSION`, and `src/middleware.ts` skips the login. Crons return `{ skipped: true }` through `moduleGate`.
- `src/lib/config.ts` turns every module on.
- AI text is replayed from `src/lib/demo/replay.json`, keyed by account label and question. Free text gets `NO_KEY_MESSAGE`. `npm run demo:replay` regenerates the file by running the real AI code on the fictional data.

The replay is keyed on the labels `shopa` and `shopb`. If you change those labels, the demo's AI text goes empty and `src/lib/demo/demo.test.ts` fails until you regenerate the replay or update the test.

## Config versus tables

`dashboard.config.ts` holds what is decided once per install. It is read through `src/lib/config.ts` and ships to the browser, so it must never hold a secret.

| In `dashboard.config.ts` | In tables |
|---|---|
| `brand` | `users` |
| `accounts`: label, name, logo, `lagDays`, `hiddenPages`, `goals`, auction settings | `accounts`: ID, label, manager ID, Merchant ID, `lag_days`, `enabled`, Microsoft IDs |
| `currency`, `locale`, `timeZone` | `targets`: ROAS, CPA and volume targets with validity dates |
| `campaignNames`: pattern, prefixes, aliases, bucket tokens | `campaign_overrides`: hand corrections per campaign |
| `modules` | `conversion_roles`, `product_type_exclusions` |

`accounts[].label` in the config must equal `accounts.label` in the database. `npm run doctor` checks this.

Some settings exist on both sides. See "Things that will surprise you" in `AGENTS.md` for goals and lag days.

## Modules

`modules` in `dashboard.config.ts` switches optional parts. Core pages are always on. Three places act on a switch:

- `moduleGate` in `src/lib/modules.ts`, called from `src/middleware.ts`. Pages and API paths of a disabled module return not found. A cron path of a disabled module answers `{ skipped: true }`.
- `NAV` in `src/components/nav.ts` drops the entry from the sidebar.
- `dailySteps` in `src/lib/sync/dailyPlan.ts` leaves out the sync step.

The AI tools also check the switches, through `TOOL_MODULE` in `src/lib/insightTools.ts`.

| Key | Page | Daily step |
|---|---|---|
| `microsoftAds` | Platform switch in the top bar | `microsoft-ads`, one step per fact dataset |
| `feedStatus` | `/feed` | `feed` |
| `auctionInsights` | `/auction` | `auction` |
| `changeHistory` | None yet | `google-ads?dataset=changes` |
| `qualityScore` | `/quality-score` | `google-ads?dataset=quality` |
| `communications` | `/meetings` | None. Loaded with `npm run communications:import` |
| `ai` | Analysis and chat in the side dock | `insights`, always last |

What each one needs is in `docs/recipes/enable-a-module.md`.

## Auth and roles

Login is NextAuth with email and password, in `src/lib/auth.ts`. Passwords are bcrypt hashes in `users`. Sessions are JWTs valid for 30 days.

- `src/middleware.ts` runs on every request. In order: module gate, demo bypass, cron paths pass through to their own check, public paths, then the token check. `/status`, `/users`, `/api/sync` and `/api/admin` need the `admin` role.
- `requireSession(minimumRole)` in each route is the real check. It re-reads the user's role and `session_version` from the database, so a deleted user or a reset password takes effect at once.
- After 10 failed logins per email or 30 per IP in 15 minutes, login locks.
- Cron routes accept only `Authorization: Bearer $CRON_SECRET`, compared in constant time by `isCronRequest`.
- Mutating calls from the browser must pass `isSameOriginJson`.

Two roles exist, `admin` and `client`. A `client` can read every report and change action status, but does not get:

- The Status and Users pages.
- Campaign tROAS and tCPA, which `/api/report/campaigns` and `/api/report/categories` strip.
- The admin findings on Devices and Countries, and the feed audit.
- Communication items marked hidden, and their actions.
- `/api/report/changes` and the AI's `change_history` tool.
- Forcing a fresh AI run, or editing or withdrawing an analysis.

## The daily job

`vercel.json` schedules `/api/cron/daily` at 05:00 UTC. `dailySteps` returns, in order:

1. Google facts: `campaign`, `conversions`, `geo`, `device`, `product`.
2. `changes` and `quality`, if on.
3. Microsoft facts, if on.
4. `feed`, `auction`, then `insights`, if on.

A step only starts while `hasTimeLeft` is true, before `TIME_BUDGET_MS` (240 seconds). The route has `maxDuration = 300`. Steps that did not start are listed under `skipped`, and the response is then 500. The order is fixed, so if earlier steps always use up the time, the same later steps are skipped every day. `docs/recipes/faster-sync.md` shows how to split them.

Default windows come from `defaultWindow`, ending yesterday:

| Dataset | Days re-read each run |
|---|---|
| `campaign`, `conversions`, `geo`, `device` | 56 |
| `product` | 35, plus the monthly table for the last 2 months |
| `quality` | 14 |
| `changes` | 2 |

Re-reading a window replaces it, which is how late conversions come in.

## Swapping a tool

There is no provider layer on purpose. Each tool below has a plain boundary, listed so you can see the work before you start. Ask your LLM to confirm the list against the current code.

### Database (Supabase)

- `src/lib/supabaseAdmin.ts` creates the client. It is the single entry point.
- 29 non-test files import `getSupabaseAdmin`. They use either `.rpc(name, args)` or `.from(table)` chains:
  - Reads: `src/lib/reports.ts`, `src/lib/reports-*.ts`, `src/lib/accounts.ts`, and the routes `src/app/api/report/buckets`, `meetings` (three routes), `platforms`, `product` and `quality`.
  - Writes: `src/lib/sync/googleAdsSync.ts`, `microsoftAdsSync.ts`, `feedSync.ts`, `auctionSync.ts`, `runs.ts`.
  - App state: `src/lib/auth.ts`, `users.ts`, `chatLog.ts`, `claudeLoop.ts`, `insightStore.ts`, `insightTools.ts`, `insightView.ts`, `microsoftAds/client.ts`.
- `supabase/migrations/20260101000000_schema.sql` is plain Postgres apart from the grants. Plain Postgres can keep it as is, with these in place: the roles `anon`, `authenticated` and `service_role` must exist (or the grants change), the role the app connects with needs `BYPASSRLS` or ownership of the tables, because row level security is on with no policies, and the `pgcrypto` extension is required. BigQuery or MySQL means rewriting the publish and read functions, which use `jsonb` and PL/pgSQL.
- `scripts/add-account.mjs`, `add-user.mjs`, `doctor.mjs` and `import-communications.mjs` make their own client.
- `src/lib/demo/fakeClient.ts` copies the Supabase call shape, and casts itself to `SupabaseClient`. If the call shape changes, change it too.
- `demo-mode.js` decides between demo and real data by checking `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Two tests depend on those names: `src/lib/demo/demo.test.ts` tests `resolveDemoMode` directly, and `scripts/demo/generate-replay.test.ts` refuses to run with `SUPABASE_SERVICE_ROLE_KEY` set.
- `next.config.js` calls `resolveDemoMode` and fixes the answer into the build.
- `.env.example` lists the database settings.
- `README.md`, `docs/SETUP.md`, `docs/table-contracts.md` and `docs/recipes` describe Supabase setup, tables or migrations. Update them to match.
- `package.json`: `@supabase/supabase-js`.

### Hosting and scheduling (Vercel)

- `vercel.json` holds the schedule. Any scheduler works if it calls `GET /api/cron/daily` with `Authorization: Bearer $CRON_SECRET`.
- `export const maxDuration` is Vercel's setting, in 10 route files: `src/app/api/cron/*/route.ts`, `src/app/api/cron/auction/import/route.ts`, `src/app/api/chat/route.ts`, `src/app/api/insights/route.ts`, `src/app/api/report/auction/route.ts`. Other hosts ignore it, so check their timeout.
- `TIME_BUDGET_MS` in `src/lib/sync/dailyPlan.ts` should sit below your host's limit.
- `next.config.js`: `outputFileTracingIncludes` and the security headers. `src/lib/auth.ts`: `clientIp` trusts `x-forwarded-for`, so check what your proxy sends.
- The app is a normal Next.js server, so `next build` and `next start` work on any Node host.

### AI (Anthropic API)

- `src/lib/claudeLoop.ts` holds the only API calls: the tool loop in `runToolLoop`, `PRICES`, `MONTHLY_CAP_USD`, and the check on `ANTHROPIC_API_KEY`.
- `src/lib/insightTools.ts` defines the tools in Anthropic's format, through the `tool` helper.
- `src/lib/insightAgent.ts` and `src/lib/chatAgent.ts` hold the prompts, the model names, and message types.
- `src/lib/chatRun.ts` and `scripts/demo/generate-replay.test.ts` check `ANTHROPIC_API_KEY`. `scripts/doctor.mjs` names it.
- `package.json`: `@anthropic-ai/sdk`.
- The loop relies on tool calls and a JSON schema for the answer, so a replacement model needs both, or the code that parses its answer must change. The number check in `insightWriter.ts` does not depend on the provider.
- No AI at all: set `ai: false`. Core pages do not need it.

### Data source (Google Ads API)

- `src/lib/googleAds/` holds the client, queries and mappers.
- `src/lib/sync/googleAdsSync.ts`: `syncDataset` calls the fetch functions, then the publish path. Keep `publishFacts`, and replace what comes before it.
- `src/app/api/cron/google-ads/route.ts` and `src/lib/sync/dailyPlan.ts`, which schedule it.
- `src/lib/sync/feedSync.ts` and `src/lib/feedBuild.ts` also use Google Ads data.
- `scripts/google-auth.mjs`, `scripts/doctor.mjs`, and `serverExternalPackages` in `next.config.js`.
- The contract to fill is `docs/table-contracts.md`. See `docs/recipes/add-another-data-route.md`.

### Login (NextAuth)

- `src/lib/auth.ts`: `authOptions`, `getSession`, `requireSession`. Keep the signature of `requireSession` and the API routes do not change.
- `src/middleware.ts` reads the token with `getToken`.
- `src/app/api/auth/[...nextauth]/route.ts`, `src/app/login/page.tsx`, `src/app/providers.tsx`.
- `useSession` or `signOut` in `src/components/Shell.tsx`, `src/components/ai/AnalysisView.tsx`, `src/components/pages/countries/AdminNote.tsx`, `src/hooks/useChangeEvents.ts`, and the Feed and Categories pages.
- `src/lib/users.ts`, `src/app/api/admin/users/`, `src/app/(dashboard)/users/page.tsx`, `scripts/add-user.mjs`, and the `users` and `login_attempts` tables.
- `src/lib/demo/demo.test.ts` mocks `next-auth`.
- No login at all is only safe when the app is not reachable from the internet, for example behind a VPN or an access proxy. Without login, anyone who finds the address sees the data.

### Email (Resend)

- `src/lib/mail.ts` holds the only `Resend` call, in `send`. `MAIL_PREVIEW_DIR` writes the mail to a file instead.
- `src/app/api/chat/escalate/route.ts` calls `mailEscalation`. A failed mail is logged and the question stays flagged in `chat_messages`.
- `package.json`: `resend`.
- To leave it out, do not set the variables. The chat still works and the "ask the account manager" flag is still stored.

### The interface (Next.js and React)

The boundary is `src/app/api/report/`: these routes return JSON and know nothing about the pages. The pure modules in `src/lib/*Shaping.ts` and `src/lib/metrics.ts` have no React in them, so they move with little change.
