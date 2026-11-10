# Setup guide for any LLM

You are helping someone run this dashboard on their own Google Ads data. Work through this file in order. It assumes the tools the project ships with. If they want a different database, host or data source, read `docs/ARCHITECTURE.md`, agree the change with them first, and adapt the steps.

Rules while you work:

- Ask before you change anything outside this repo.
- Secrets go in `.env.local` or the host's environment settings. Never print them, never commit them, and never give the service role key a `NEXT_PUBLIC_` name.
- Row level security stays on, with no policies. Never add a permissive policy.
- Run `npm run doctor` whenever you finish a step that adds a connection. It names the exact fix.

## 1. Interview them

Ask these one at a time, and write the answers into `dashboard.config.ts`:

1. Which ad accounts should this show? For each: a short label, a display name, and the 10-digit customer ID.
2. Do they use a manager account (MCC)? If so, what is its ID?
3. What currency, locale and time zone do the accounts use? Check the time zone against the Google Ads account.
4. How long after a click do conversions usually come in? That sets `lagDays`.
5. How are campaigns named? Ask for five real names. Adjust `campaignNames` until they parse, and test it with `src/lib/campaignParser.ts`. If there is no pattern, say so: everything then shows as Other until the parser is rewritten.
6. Which optional modules do they want? Leave the rest off.
7. Do they sell products through Shopping or Performance Max? If not, offer to remove the product pages.

## 2. Create the database

In a new Supabase project, run `supabase/migrations/20260101000000_schema.sql` in the SQL editor, or use the Supabase CLI with `supabase link` and `supabase db push`.

## 3. Fill in the environment file

Copy `.env.example` to `.env.local`. Generate `NEXTAUTH_SECRET` and `CRON_SECRET` with `openssl rand -base64 32`. Have them paste keys into the file themselves.

## 4. Connect Google Ads

1. In Google Cloud, enable the Google Ads API.
2. Create an OAuth client of the type "Desktop app". Add its ID and secret to the environment file.
3. In the manager account, open Admin > API Center and copy the developer token. It must have production access. A test-only token cannot read real accounts.
4. Run `npm run google:auth`. It stores the refresh token and lists the accounts the login can reach.
5. If they use a manager account, set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to its ID without dashes.

## 5. Add the accounts and a login

For each account in the config:

```bash
npm run accounts:add -- --label shop --name "My shop" --id XXX-XXX-XXXX --currency EUR --lag 7
```

Then create a login. It asks for the password:

```bash
npm run users:add -- you@example.com admin "Your name"
```

Run `npm run doctor`. Continue when it passes.

## 6. Load data

Start the app with `npm run dev`, then in a second terminal load a recent month first, so a problem shows up early:

```bash
npm run backfill -- --from 2026-01-01
```

Use a date about a month back. When that works, rerun it from the earliest date they want. Add `--datasets product --days 7` for product data, because a full month of product rows can be slow.

## 7. Tell the dashboard what counts

Revenue and conversions come from the columns Google Ads marks as primary, so fix those in Google Ads first. Roles here are optional: today only `samples` changes what is shown, as a separate count beside conversions. After the first sync, list the actions in the Supabase SQL editor:

```sql
select account_id, conversion_action_id, max(conversion_action_name) as name, sum(all_conversions) as conversions, sum(all_conversions_value) as value
from ads_conversions_daily group by 1, 2 order by 5 desc;
```

Ask whether any are sample requests or similar, and store those. Roles are `primary_revenue`, `secondary`, `samples` or `micro`:

```sql
insert into conversion_roles (account_id, conversion_action_id, conversion_action_name, role)
values ('YOUR_ACCOUNT_ID', '111', 'Purchase', 'primary_revenue');
```

Targets are optional, but the goal meters only appear when an account has both `revenue_per_month` and `roas`. Metrics are `roas`, `cpa`, `revenue_per_month`, `purchases_per_month`, `budget_per_day` and `spend_per_month`:

```sql
insert into targets (account_id, metric, value, valid_from) values ('YOUR_ACCOUNT_ID', 'roas', 5, '2026-01-01');
```

Run `npm run doctor` again. It now reports how many campaign names match the naming scheme.

## 8. Deploy

Push to a **private** repo and import it in Vercel. Add the same environment variables, with `NEXTAUTH_URL` set to the real address. `vercel.json` runs one sync a day through `/api/cron/daily`. Steps that do not fit in the time limit are reported under `skipped`. The order is fixed, so the same steps can be skipped every day: if that happens, see `docs/recipes/faster-sync.md`.

## Check before you finish

- The Status page shows recent data for every account.
- Spend on the Overview page matches Google Ads for a closed month.
- A login with the `client` role cannot reach the admin pages.
- `.env.local` is not tracked: `git check-ignore .env.local` prints its name.
