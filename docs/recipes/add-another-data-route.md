# Add another data route

## When to use it

You cannot or do not want to use the Google Ads API, for example because Google has not approved your Cloud project for production accounts. Or the data already sits in a warehouse or a connector you pay for. The app needs its fact tables filled. It does not care how.

The contract is `docs/table-contracts.md`.

## Files to change

| File | Why |
|---|---|
| Your loader, in `scripts/` or elsewhere | Fetches rows and calls the publish functions |
| `src/lib/sync/dailyPlan.ts`, `src/lib/sync/dailyPlan.test.ts` | Remove the steps you replaced |
| `src/lib/sync/googleAdsSync.ts` | Only if the loader runs inside the app |
| `scripts/doctor.mjs` | Its Google Ads section fails without API keys |

## Steps

1. **Pick where the loader runs.**
   - A script or scheduled job outside the app, such as a warehouse export calling the database.
   - A new route under `src/app/api/cron/`, protected with `isCronRequest`. Something like Google Ads Scripts could post to it.
   - Inside `syncDataset`, replacing the fetch functions and keeping `publishFacts`.

2. **Create the account.** `npm run accounts:add`, or insert into `accounts`. Every fact row needs it.

3. **Load campaigns first.** Names and categories come from `campaign_dim`. Decide `network`, `category`, `bucket` and `parsed` yourself, or run names through `classifyCampaign` when the loader is inside the app.

4. **Publish facts one account and date range at a time.** The range is replaced, so always send it complete:

   ```js
   import { createClient } from '@supabase/supabase-js';

   const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
   const accountId = 'YOUR_ACCOUNT_ID';

   const dim = await db.rpc('upsert_campaign_dim', {
     p_account_id: accountId,
     p_rows: [{ campaign_id: 'YOUR_CAMPAIGN_ID', campaign_name: 'My campaign', channel_type: 'SEARCH', status: 'ENABLED', network: 'Search', category: 'Stoves', parsed: true }],
   });
   if (dim.error) throw new Error(dim.error.message);

   const facts = await db.rpc('publish_daily_facts', {
     p_table: 'ads_campaign_daily',
     p_account_id: accountId,
     p_start_date: '2026-10-01',
     p_end_date: '2026-10-31',
     p_sync_run_id: null,
     p_rows: rows,   // fact_date, campaign_id, impressions, clicks, cost, ...
     p_complete_run: false,
     p_platform: 'google',
   });
   if (facts.error) throw new Error(facts.error.message);
   ```

5. **Convert the units.** Cost is in currency units, shares are fractions, and dates are `YYYY-MM-DD` in the account's time zone. Check the details per table in the contract.

6. **Record the run,** so the Status page shows it. Insert into `sync_runs` with a `source` the check constraint allows (`google_ads` is fine), a `dataset` such as `campaign`, and status `complete`. `src/lib/sync/runs.ts` shows the fields.

7. **Stop the API sync.** Remove the replaced datasets from `FACTS` in `src/lib/sync/dailyPlan.ts` and update `dailyPlan.test.ts`. If you remove them all, also remove the Google Ads section from `scripts/doctor.mjs`.

8. **Keep re-reading a window.** Conversions settle after the click, so reload recent weeks on each run. A single load of yesterday leaves recent conversions too low forever.

## Check it worked

- The Status page shows the runs, and coverage for each dataset.
- For one closed month, spend and conversions on the Overview match the source.
- Campaigns show names and categories, not bare IDs and Other.
- Rerunning the loader for the same range does not change the totals.
