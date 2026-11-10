# PPC dashboard: an example to build your own

**This is inspiration, not a template.** It's the Google Ads dashboard I built for how I work, shared so you can see what's possible and take what's useful.

Every account is different, so don't expect this to fit yours out of the box. Your campaign structure, your metrics, your clients and your tools will all need changes. That's the point: open it with the LLM you already use, whether that's Claude, Codex, Grok or something else, and have it build the version you need.

Built by Bob Meijer, for The PPC Hub by PPC Mastery.

## What you get

- **Overview and trends:** spend, revenue, ROAS, CPA and conversion lag, with period comparison and targets.
- **Categories and campaigns:** performance by your own campaign naming scheme.
- **Products and buckets:** product performance, product types, and heroes, sidekicks, villains and zombies. The buckets page expects `H`, `S`, `V` or `Z` in custom label 2 of your feed, so have your LLM change that if you label differently.
- **Countries and devices:** where and on what your budget works.
- **Status page and roles:** see when data last synced, and give clients a read-only login.

Optional modules, off until you switch them on:

| Module | What it adds | What it needs |
|---|---|---|
| Microsoft Ads | The same reports for Microsoft Ads | Microsoft Advertising API access |
| Feed status | Merchant Center approval and issues | Merchant API access |
| Auction insights | Competitor trends over time | Report Editor exports through Google Drive |
| Change history | A log of account changes that the AI can read. It has no page of its own | Nothing extra |
| Quality Score | Quality Score and its components by keyword | Nothing extra |
| Communication | Meeting and email digests with an action board | A JSON import, see `docs/recipes` |
| AI analysis and chat | A written analysis of the overview, and questions about your data | An Anthropic API key |

Profit, margin and POAS are not included. `docs/recipes/add-poas.md` explains how to add them.

## Try it in two minutes

You need [Node.js](https://nodejs.org) 20 or newer. No accounts or keys are needed.

```bash
git clone https://github.com/bobmeijer/ppcmastery-dashboard-ecommerce.git
cd ppcmastery-dashboard-ecommerce
npm install
npm run dev
```

Open http://localhost:3000. You'll see the full dashboard, with every module switched on, running on two fictional shops. Nothing connects to the internet, and no login is needed.

AI answers in demo mode are pre-generated. To ask your own questions, connect your own API key using the steps below.

## Make it yours with your LLM

The repo is written so any capable coding LLM can understand and change it. `AGENTS.md` and `docs/ARCHITECTURE.md` explain how it fits together, and `docs/recipes` has examples of common changes.

Open the folder in the coding tool you use, and start with a conversation. Here are some ways to begin.

**To understand it:**

```text
Read AGENTS.md and docs/ARCHITECTURE.md. Explain how data moves from the Google
Ads API to a chart on the Trends page, in plain language.
```

**To decide what you actually need:**

```text
Read AGENTS.md and docs/ARCHITECTURE.md, then interview me about my accounts,
my clients, how I report and which tools I already pay for. Tell me which parts
of this dashboard are useful for me, which to remove, and what is missing.
Give me a plan before you change anything.
```

**To swap a tool:**

```text
I want to use [my tool] instead of [the tool in this project]. Read
docs/ARCHITECTURE.md, list every file that has to change, and tell me what I
would gain and lose. Wait for my OK before you change anything.
```

### Every tool here is a choice

These are what I happened to pick. None of them is required. Ask your LLM what would have to change.

| What it does | What I used | You could use |
|---|---|---|
| Database | Supabase | Plain Postgres, BigQuery, MySQL, whatever you run |
| Hosting and scheduling | Vercel | Cloudflare, Railway, your own server |
| AI analysis and chat | Anthropic API | OpenAI, Gemini, Grok, a local model, or no AI at all |
| Getting Google Ads data | Google Ads API | Google Ads Scripts, BigQuery Data Transfer, a connector you already pay for |
| Login | NextAuth | Your own login, or none if it only runs for you |
| Email | Resend | Any email service, or leave it out |
| The interface | Next.js and React | Anything your LLM can build |

The same goes for the metrics, the pages and the layout. Delete what you don't need.

## How I run it

These are the steps for running this project with the tools I chose. If you've swapped a tool, have your LLM update the steps that change.

Plan for about an hour, plus any waiting time for Google to approve your API access.

### What this version uses

- A [Supabase](https://supabase.com) project. This holds your data. The free plan has a 500 MB limit, and my version with two ecommerce accounts and all modules is past that, so expect to need a paid plan once you load product history.
- A [Vercel](https://vercel.com) account. This runs the dashboard and the daily sync. Vercel's free Hobby plan is for non-commercial personal use only, so client work needs a paid Pro plan.
- A Google Ads account or manager account (MCC) your Google login can access.
- A Google Cloud project with the Google Ads API enabled and at least Explorer access. Test access can't read real accounts. You don't need a developer token: Google retired those on 9 September 2026.

### 1. Get the code

GitHub doesn't allow a private fork of a public repo. Create a new, empty **private** repo on your own account, then push your clone to it:

```bash
git remote set-url origin https://github.com/YOUR-NAME/YOUR-PRIVATE-REPO.git
git push -u origin main
```

### 2. Tell it about your business

Ask your LLM to follow `docs/SETUP.md`, which works with any coding tool, or edit `dashboard.config.ts` yourself. This is where your brand, account labels, currency, campaign naming scheme and modules are set.

If your campaign names don't follow a pattern, start with `docs/recipes/change-the-name-parser.md`. Categories and buckets depend on it.

### 3. Create the database

In your Supabase project, run the SQL in `supabase/migrations` using the SQL editor, or use the Supabase CLI:

```bash
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

All tables have row level security on and no policies. Only the server can read them, using the service role key. Don't add a permissive policy.

### 4. Set your environment variables

Copy `.env.example` to `.env.local` and fill it in. The Google values come from step 5.

| Variable | Needed for | Where it comes from |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Everything | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Everything | Supabase project settings. Server only |
| `NEXTAUTH_SECRET` | Login | Run `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Login | The address of your dashboard |
| `CRON_SECRET` | Sync | Run `openssl rand -base64 32` |
| `DASHBOARD_BASE_URL` | Backfill script | The address of your dashboard |
| `GOOGLE_ADS_CLIENT_ID` | Sync | Step 5 |
| `GOOGLE_ADS_CLIENT_SECRET` | Sync | Step 5 |
| `GOOGLE_ADS_REFRESH_TOKEN` | Sync | Step 5 |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Manager accounts | Step 5 |
| `MERCHANT_REFRESH_TOKEN` | Feed status | Needs its own login with the content scope. `npm run google:auth` only requests Google Ads access |
| `MSADS_CLIENT_ID`, `MSADS_CLIENT_SECRET`, `MSADS_DEVELOPER_TOKEN`, `MSADS_REFRESH_TOKEN` | Microsoft Ads | Microsoft Advertising API. Run `npm run msads:auth` for the token |
| `GOOGLE_SHEETS_SERVICE_ACCOUNT_B64` | Auction insights | A Google service account key, base64 encoded |
| `ANTHROPIC_API_KEY` | AI analysis and chat | Anthropic Console |
| `RESEND_API_KEY`, `ESCALATION_MAIL_FROM`, `ESCALATION_MAIL_TO` | Sending chat questions to you by email | Resend |

Never commit `.env.local`. Never give the service role key a `NEXT_PUBLIC_` name, because that would send it to the browser.

### 5. Connect Google Ads

1. In Google Cloud, create a project or reuse one, and enable the Google Ads API. If you used the API before 9 September 2026, reuse the project that made those calls, because your access level moved to it.
2. Open the **Google Ads API Overview** page for that project. If it says Test, apply for **Explorer** access there. Review is automated in most cases, and it allows 2,880 operations a day on real accounts. Google may reject projects on a Cloud free trial, so upgrade the project to a paid tier if that happens.
3. Under **Google Auth Platform > Audience**, choose Internal if your Workspace allows it, or External and **Publish app**. If it stays in Testing, your login expires after 7 days and the sync stops.
4. Create an OAuth client of the type "Desktop app", and add its ID and secret to `.env.local`.
5. Run `npm run google:auth` and sign in with a user who can access your accounts. Google may warn that the app isn't verified. It's your own app, so continue under Advanced. The script stores the refresh token and lists the accounts it can reach.
6. If you use a manager account, set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to its 10-digit ID without dashes.

### 6. Add your accounts and create your login

Add each account from your config:

```bash
npm run accounts:add -- --label shop --name "My shop" --id XXX-XXX-XXXX --currency EUR --lag 7
```

`--lag` is how many days conversions usually take to come in.

Then create your login:

```bash
npm run users:add -- you@example.com admin "Your name"
```

You'll be asked for a password. Use the role `client` for read-only logins.

### 7. Check your setup

```bash
npm run doctor
```

This tests each connection and tells you exactly what to fix.

### 8. Deploy

Import your private repo in Vercel, add the same environment variables under the production environment, and set `NEXTAUTH_URL` to your real address. Vercel builds it on every push to `main`.

The sync runs once a day. To test it, open **Schedules** in your Vercel project and click **Run Schedule**. Vercel Schedules are still in beta. To run it more often, see `docs/recipes/faster-sync.md`.

### 9. Load your history

Set `DASHBOARD_BASE_URL` in `.env.local` to your deployed address, then run:

```bash
npm run backfill -- --from 2024-01-01
```

This loads campaigns, conversions, countries and devices month by month, newest first. If it stops, rerun it with `--to` set to the last month that didn't finish. Product history is a separate run, in 7-day pieces because it's slower:

```bash
npm run backfill -- --from 2026-01-01 --datasets product --days 7
```

Then open the dashboard and look at the Status page.

## Security

- This dashboard holds your or your clients' performance data. Keep your repo private and use a login for every person.
- Secrets belong in environment variables, never in code.
- With `DASHBOARD_DEMO=1` set, demo mode refuses to start when real Supabase credentials are set. Without it, database settings simply make the app use the real database.
- The AI features send report data to Anthropic. Check that this fits your client agreements before you switch them on.
- Before you share screenshots or recordings, remember that account names, product titles and spend are visible.

## Troubleshooting

| Problem | What to try |
|---|---|
| Something isn't connecting | Run `npm run doctor` first |
| `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` | Your Google Cloud project only has Test access. Apply for Explorer on the Google Ads API Overview page |
| `invalid_grant`, or the sync stops after a week | The OAuth app is still in Testing. Publish it, run `npm run google:auth` again, and update `GOOGLE_ADS_REFRESH_TOKEN` in Vercel |
| Google says the API version is deprecated | Update the `google-ads-api` package. This version, v26, runs until about November 2027 |
| Google Ads permission error | Check that the OAuth user can access the account, and that the manager account ID is right |
| Numbers are missing after deploying | Run the backfill in step 9, then check the Status page |
| Categories all show as "Other" | Your campaign names don't match the parser. See the name parser recipe |
| Login loops back to the login page | `NEXTAUTH_URL` must exactly match the address in your browser |

## Support

This is shared as is, without a support promise. Members of [The PPC Hub](https://hub.ppcmastery.com) get the walkthrough video, a methodology pack for the AI prompts, and a place to ask questions.

## License

MIT. See `LICENSE`.
