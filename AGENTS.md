# PPC dashboard

Instructions for any coding agent working in this repo. Read this file first, then `docs/ARCHITECTURE.md`.

## What this is

A Google Ads reporting dashboard: Next.js 15, React 19, Supabase and Vercel. It is one person's working setup, shared as inspiration. Every account is different, so expect to change it. Campaign names, metrics, pages and tools are all open to change. The person you are working with may want something quite different from what is here, so ask before you assume.

One deployment holds one business, with one or more ad accounts identified by a short label. There is no multi-tenant layer.

## Run the demo

```bash
npm install
npm run dev
```

Open http://localhost:3000. It needs no environment variables, no accounts and no network. Two fictional shops, 24 months of data, every module on, no login.

The demo starts only when no database settings are present. If `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is set, `npm run dev` runs against the real database instead.

To set up real data, follow `docs/SETUP.md`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app (demo when no database settings are present) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, `src/**/*.test.ts` |
| `npm run lint` | Next lint |
| `npm run build` | Production build |
| `npm run scan:leaks` | Generic scan for secrets and account IDs in tracked files |
| `npm run doctor` | Check each real connection and name the fix |
| `npm run backfill -- --from YYYY-MM-DD` | Load history through the running app |
| `npm run accounts:add`, `npm run users:add` | Add an ad account or a login |
| `npm run google:auth`, `npm run msads:auth` | One-time OAuth for Google Ads or Microsoft Ads |
| `npm run communications:import -- file.json` | Load digests for the Communication page |
| `npm run demo:replay` | Regenerate the demo's AI text. Calls a paid API |

## Layout

| Path | What is there |
|---|---|
| `dashboard.config.ts` | Brand, accounts, currency, time zone, campaign name scheme, module switches. Ships to the browser |
| `demo-mode.js`, `src/lib/demoMode.ts` | Decide whether the app runs on the fictional data |
| `src/lib/demo/` | Fake database client, data generator, AI replay |
| `supabase/migrations/` | Tables, publish functions, read functions |
| `src/lib/supabaseAdmin.ts` | The one place the database client is created |
| `src/lib/googleAds/` | Google Ads API client, GAQL queries, row mappers |
| `src/lib/microsoftAds/`, `src/lib/merchant/`, `src/lib/sheets/` | Other data sources |
| `src/lib/sync/` | Sync runs, the publish path, the daily plan |
| `src/lib/reports*.ts` | Server code that calls the read functions |
| `src/lib/*Shaping.ts`, `src/lib/metrics.ts`, `src/lib/filters.ts`, `src/lib/campaignParser.ts` | Pure aggregation and parsing, with tests beside them |
| `src/lib/modules.ts` | Which module owns which path |
| `src/lib/auth.ts`, `src/middleware.ts`, `src/lib/requestGuards.ts` | Login, roles, cron auth |
| `src/lib/claudeLoop.ts`, `src/lib/insight*.ts`, `src/lib/chat*.ts` | AI analysis and chat |
| `src/app/(dashboard)/` | Pages |
| `src/app/api/report/` | Read endpoints the pages call. Session required |
| `src/app/api/cron/` | Sync endpoints. `Authorization: Bearer $CRON_SECRET` |
| `src/components/`, `src/hooks/` | UI and data-fetching hooks |
| `scripts/` | Setup and operational scripts |
| `docs/recipes/` | Worked examples of common changes |
| `docs/table-contracts.md` | Every fact table, for loading data another way |

## Rules

- **Row level security stays on with no policies.** Never add a permissive policy. The app reaches the database only through the service role, from the server.
- **Lock down anything new in the database.** Supabase grants new objects to `anon` and `authenticated`. Every new table needs `enable row level security`. Every new function needs `revoke all ... from public, anon, authenticated` and a grant to `service_role`. Use `security definer` and `set search_path` as the existing functions do.
- **Secrets only in environment variables.** Never put one in code or in `dashboard.config.ts`, which ships to the browser. Never print one. Never give the service role key a `NEXT_PUBLIC_` name. Never commit `.env.local`.
- **Typecheck and test before every commit:** `npm run typecheck` and `npm test`. Run `npm run scan:leaks` too.
- **Pure modules have vitest tests.** A new or changed shaping, parsing or metric function gets a test next to it, as `name.test.ts`.
- **The demo must keep working.** After any change, `npm run dev` with no environment variables must still show every page. A new read function needs a `case` in `Store.rpc` in `src/lib/demo/fakeClient.ts` and a reader in `src/lib/demo/reads.ts`. A new field in a read function must be added to the fake data and to the key lists in `src/lib/demo/demo.test.ts`.
- **Do not add provider abstraction layers.** Every tool here is a choice, and swapping one means editing the files listed in `docs/ARCHITECTURE.md`. Keep the boundaries plain.
- **Data that changes per client decision lives in tables,** such as conversion roles, targets and campaign overrides.
- **No real client data in the repo:** no names, account IDs, Drive IDs or screenshots with real numbers. Use `XXX-XXX-XXXX` and `example.com` in examples.
- **Profit, margin and POAS are not included.** `docs/recipes/add-poas.md` explains how to add them if someone wants them.
- **Ask before changing anything outside this repo,** such as a database, a hosting project or an ad account.

## Where to look for common changes

| To change | Start here |
|---|---|
| Brand, labels, currency, locale, time zone | `dashboard.config.ts` |
| How campaign names are read | `docs/recipes/change-the-name-parser.md` |
| A metric, column or KPI tile | `docs/recipes/add-a-metric.md` |
| A new page | `docs/recipes/add-a-page.md` |
| Turn on an optional module | `docs/recipes/enable-a-module.md` |
| Profit or POAS | `docs/recipes/add-poas.md` |
| Sync schedule or windows | `docs/recipes/faster-sync.md` |
| Data from somewhere other than the API | `docs/recipes/add-another-data-route.md` |
| Meeting and email digests | `docs/recipes/build-a-digest-step.md` |
| AI prompts | `SYSTEM` in `src/lib/insightAgent.ts` and `src/lib/chatAgent.ts` |
| AI spend cap and models | `MONTHLY_CAP_USD` and `PRICES` in `src/lib/claudeLoop.ts`, `AGENT_MODEL` in `src/lib/insightAgent.ts`, `CHAT_MODEL` in `src/lib/chatAgent.ts` |
| A different database, host, AI, login or email tool | "Swapping a tool" in `docs/ARCHITECTURE.md` |

## Things that will surprise you

These are in the code today. Check them against the account you are adapting this for.

- **Revenue is Google's own number.** It comes from `conversions_value` in `ads_campaign_daily`, so the account's primary conversions decide it. `conversion_roles` does not change Revenue, ROAS or CPA. The only role with an effect in the UI is `samples`, which adds a hint under the conversions tile.
- **One place for goals.** The goal meters, the metric tree and the AI all read the `targets` table. The meters need both `revenue_per_month` and `roas` for the account, through `/api/report/goals`.
- **Public versus private settings.** `dashboard.config.ts` ships to the browser and anyone can read it, even without logging in. Put private per-account settings in `dashboard.server.ts`.
- **Two sets of lag days.** Date presets and chart shading read `lagDays` in the config. The AI's matured date and the Buckets page read `accounts.lag_days`. Keep them equal.
- **Countries are narrow.** `COUNTRY_BY_CRITERION` in `src/lib/googleAds/datasets.ts` knows 8 countries and maps the rest to `Other`. `countryKey` in `src/lib/geoShaping.ts` splits only `NL`, `BE` and `Other`. Change both for another market.
- **A fixed time zone in places.** `read_change_events_json` and `read_data_coverage_json` in the migration, and `REPORT_TIME_ZONE` in `src/lib/microsoftAds/client.ts`, are set to Amsterdam whatever the config says.
- **Daily product history starts at a fixed date.** `PRODUCT_DAILY_FLOOR` in `src/lib/sync/googleAdsSync.ts` and `DAILY_FLOOR` in `src/app/api/report/buckets/route.ts` are both `2026-01-01`. Older periods use the monthly table.
- **Currency formatting is global.** `currency` in the config formats every account. `accounts.currency` is stored but not used for display.
- **Change history has no page.** The module syncs data and feeds the AI's `change_history` tool. `src/hooks/useChangeEvents.ts` and `/api/report/changes` exist, but no page uses them yet.
- **One analysis key.** `/api/insights` accepts only `page=overview`. The analysis covers the current account, period and filters, and does not differ per page.
- **Disabled modules are not gated in the demo.** The demo ignores the switches, so test a switch against real data.
