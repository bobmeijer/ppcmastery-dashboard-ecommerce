# Faster sync

## When to use it

Once a day is not fresh enough, the daily job runs out of time, or conversions keep arriving after the default window has passed.

## Files to change

| File | Why |
|---|---|
| `vercel.json` | The schedules |
| `src/lib/sync/dailyPlan.ts` | Which steps the daily job runs, and `TIME_BUDGET_MS` |
| `src/lib/sync/googleAdsSync.ts` | `defaultWindow`, if you want other default windows |

## How it works now

One schedule calls `/api/cron/daily` at 05:00 UTC. Each run re-reads a window and replaces it:

| Dataset | Default window |
|---|---|
| `campaign`, `conversions`, `geo`, `device` | 56 days |
| `product` | 35 days, plus the monthly table for 2 months |
| `quality` | 14 days |
| `changes` | 2 days |

`/api/cron/google-ads` accepts `?dataset=`, `?days=N`, `?months=N` (at most 12), `?startDate=`, `?endDate=` and `?accounts=label,label`.

## Steps

### Run more often

Add a schedule, or change the existing one. For a light refresh every 6 hours, re-read only the last few days:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "schedules": {
    "daily-sync": { "schedule": "0 5 * * *", "path": "/api/cron/daily", "requestMethod": "GET" },
    "refresh-campaign": { "schedule": "0 */6 * * *", "path": "/api/cron/google-ads?dataset=campaign&days=3", "requestMethod": "GET" }
  }
}
```

Today's data is left out on purpose, because `defaultWindow` ends yesterday. To include it, pass an explicit `endDate`, and expect partial numbers.

### Add a wider weekly re-sync

The default window is 56 days, and conversions can settle later than that: in slow accounts, about 90 days or more after the click. Add one schedule per dataset, so each gets its own time limit:

```json
"weekly-campaign": { "schedule": "0 2 * * 0", "path": "/api/cron/google-ads?dataset=campaign&days=120", "requestMethod": "GET" },
"weekly-conversions": { "schedule": "20 2 * * 0", "path": "/api/cron/google-ads?dataset=conversions&days=120", "requestMethod": "GET" },
"weekly-geo": { "schedule": "40 2 * * 0", "path": "/api/cron/google-ads?dataset=geo&days=120", "requestMethod": "GET" },
"weekly-device": { "schedule": "0 3 * * 0", "path": "/api/cron/google-ads?dataset=device&days=120", "requestMethod": "GET" }
```

Do the same for `/api/cron/microsoft-ads` if you use it. Pick the number of days from how long your own conversions take to settle.

For a one-off, run the backfill over the months you want to refresh: `npm run backfill -- --from YYYY-MM-DD`.

### When the daily job runs out of time

The job starts a step only while less than `TIME_BUDGET_MS` (240 seconds) has passed. Steps that did not start are listed under `skipped`, and the response is a 500. The order is fixed, so if the early steps always take that long, the same late steps are skipped every day.

Fix it by moving slow steps to their own schedule. For example, remove `product` from `FACTS` in `src/lib/sync/dailyPlan.ts`, update the test in `dailyPlan.test.ts`, and add a schedule for `/api/cron/google-ads?dataset=product`.

### Before you deploy

- Check your hosting plan: how many schedules it allows, how often they may run, and how long a function may run. The routes ask for 300 seconds with `maxDuration`. The limits per Vercel plan have not been verified for this project, and neither has a schedule path with a query string. If yours refuses one, add a small route per dataset that calls the handler.
- Each run uses Google Ads API quota. A short window on a frequent schedule costs little. A long window on a frequent schedule does not.

## Check it worked

- Call a schedule's path by hand, and look for `"ok": true` and row counts:

  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" "https://your-dashboard.example.com/api/cron/google-ads?dataset=campaign&days=120"
  ```

- The Status page shows the run, with the wider date range.
- After a weekly re-sync, conversions for dates 60 to 120 days back match Google Ads.
- In the response of `/api/cron/daily`, `skipped` is empty.
