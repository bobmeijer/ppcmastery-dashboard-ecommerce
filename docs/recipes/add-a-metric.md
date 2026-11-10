# Add a metric

## When to use it

You want a number the dashboard does not show yet, as a tile, a table column or a trend line.

## Files to change

A metric computed from existing totals:

| File | Why |
|---|---|
| `src/lib/metrics.ts` | The definition: `Derived`, `derive`, `METRICS` |
| `src/lib/metrics.test.ts` | The test |
| `src/components/overview/shared.tsx` | `KPI_SET` drives the Overview tiles and tables. `Delta` has its own list of lower-is-better metrics |
| `src/app/(dashboard)/trends/page.tsx` | `TREND_METRICS`, the metric buttons on Trends |
| `src/components/pages/shared/metricColumns.tsx` | `HIDDEN_BY_DEFAULT` and `MOBILE_KEPT` |
| `src/components/overview/BreakdownTables.tsx` | A second `HIDDEN_BY_DEFAULT`, for the Overview tables |
| `src/components/pages/categories/columns.tsx` | Categories has its own column list |
| `src/components/pages/devices/DeviceTiles.tsx`, `src/components/pages/countries/CountryTiles.tsx` | `TILE_METRICS`, if you want it there |

A metric that needs a new column from Google also touches:

| File | Why |
|---|---|
| A new file in `supabase/migrations/` | The column, plus new versions of `publish_daily_facts` and `read_campaign_facts_json` |
| `src/lib/googleAds/datasets.ts` | The GAQL and the mapper in `fetchCampaignDaily` |
| `src/lib/metrics.ts` | `FactRow`, `Totals`, `emptyTotals` |
| `src/lib/microsoftAds/mapping.ts` | `mapCampaignDaily`, if you use Microsoft Ads |
| `src/lib/demo/reads.ts`, `src/lib/demo/demo.test.ts` | `campaignFacts` and the key list for "campaign facts", so the demo keeps working |

## Steps

This example adds value per click, computed from existing totals.

1. In `src/lib/metrics.ts`, add the field to `Derived`, compute it in `derive`, and add it to `METRICS`:

   ```ts
   // in Derived
   value_per_click: number | null;

   // in derive()
   value_per_click: safeDiv(totals.conversions_value, totals.clicks),

   // in METRICS
   { key: 'value_per_click', label: 'Value per click', format: 'currency', higherIsBetter: true, lagging: true, clientVisible: true },
   ```

   `label` is the button text on Trends. `lagging` is true when the metric depends on conversions. `formatMetric` shows two decimals only for `cpc`, so add your key there if you want cents.

2. Add a test in `src/lib/metrics.test.ts`. Always compute ratios from totals, as `derive` does. Never average ratios.

3. Add the key to `KPI_SET` to show it on the Overview and in the grouped tables. Add it to `TREND_METRICS` for Trends. If lower is better, also add it to the list in `Delta`.

For a new column from Google, do these as well:

4. Write a migration. Add the column with `default 0 not null`, then `create or replace` both functions with the column added to the insert, the record definition and the select. Replacing a function with the same arguments keeps its grants.

5. Add the field to the query and the mapper, then to `FactRow`, `Totals` and `emptyTotals`. `addRow` and the groupings pick it up from `emptyTotals`.

6. Add the field to `campaignFacts` in `src/lib/demo/reads.ts` and to the key list in `src/lib/demo/demo.test.ts`.

7. Run the backfill to fill the history: `npm run backfill -- --from YYYY-MM-DD --datasets campaign`.

## Check it worked

- `npm run typecheck` and `npm test` pass.
- `npm run dev` with no environment variables shows the metric on the demo.
- Work out one value by hand from the numbers on the same page, and compare.
