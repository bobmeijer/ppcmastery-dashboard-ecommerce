# Lead generation accounts

## When to use it

The account generates leads, sign-ups or demos instead of online orders. The dashboard was built for ecommerce. A real end-to-end test on a B2B lead-gen account worked, with four visible problems:

| What you see | Why |
|---|---|
| Revenue and ROAS show 0 | They come from `conversions_value`, and the conversion actions have no value |
| Conversions are labelled "Purchases" | The label is fixed in the code |
| Products and Buckets are empty | There is no Shopping or Performance Max product data |
| Goal meters are empty or make no sense | They are based on revenue and ROAS |

## Files to change

| File | Why |
|---|---|
| `src/lib/metrics.ts` | Labels in `METRICS` |
| `src/components/overview/shared.tsx` | `KPI_SET`, the tiles and tables |
| `src/app/(dashboard)/trends/page.tsx` | `TREND_METRICS` and the default metric |
| `src/app/(dashboard)/page.tsx` | Removes `GoalMeters` |
| `src/components/pages/shared/metricColumns.tsx`, `src/components/overview/BreakdownTables.tsx` | Mobile columns and the "Revenue share" label |
| `src/components/pages/categories/columns.tsx`, `src/components/pages/categories/CategoryTrend.tsx` | Their own label lists |
| `src/components/pages/devices/DeviceTiles.tsx`, `src/components/pages/countries/CountryTiles.tsx`, `src/lib/geoShaping.ts` | `TILE_METRICS`, `STACK_METRICS` |
| `src/app/(dashboard)/devices/page.tsx` | The ROAS card |
| `src/components/nav.ts`, `dashboard.config.ts` | Hide pages |
| `src/lib/sync/dailyPlan.ts`, `src/lib/sync/dailyPlan.test.ts` | Skip the product sync |
| `src/lib/insightAgent.ts`, `src/lib/chatAgent.ts`, `src/lib/insightSignals.ts`, `src/lib/insightTools.ts`, `src/components/ai/suggestions.ts` | AI wording, if the `ai` module is on |

## Steps

1. **Decide about value first.** This choice sets how much work follows.
   - Give each lead a value in Google Ads, even an estimate. Revenue and ROAS then show lead value and start working. You only need to relabel, in step 2.
   - Keep values out and steer on CPA. Do steps 2 to 7.

2. **Change the labels.** In `METRICS` in `src/lib/metrics.ts`, change the labels:

   ```ts
   { key: 'conversions_value', label: 'Lead value', format: 'currency', higherIsBetter: true, lagging: true, clientVisible: true },
   { key: 'conversions', label: 'Leads', format: 'decimal', higherIsBetter: true, lagging: true, clientVisible: true },
   ```

   These labels are also written out in other places, so search for the word and change what you find:

   ```bash
   grep -rnE "Purchases|Revenue|AOV|order value" src --include=*.ts --include=*.tsx
   ```

   Rename what readers see. Leave the keys, such as `conversions_value`, alone.

3. **Remove the metrics that mean nothing,** if you did not give leads a value.
   - Take `conversions_value`, `roas` and `aov` out of `KPI_SET`, `TREND_METRICS` and the `TILE_METRICS` lists.
   - In the Trends page, change the default in `useState<MetricKey>('conversions_value')` to `'conversions'`. Do the same for `useState<StackMetric>` on the Countries page.
   - Change `MOBILE_KEPT` in `metricColumns.tsx`, and remove the "ROAS by device" card from the Devices page.
   - Categories has its own lists, in `columns.tsx` and `CategoryTrend.tsx`. The matrices in `DeviceMatrix.tsx` and `CountryMatrix.tsx` print ROAS in each cell.
   - The "Revenue share" column on the Overview and in the grouped tables disappears by itself once `conversions_value` leaves `KPI_SET`.

4. **Replace the goals.** Remove `GoalMeters` from `src/app/(dashboard)/page.tsx`. It needs revenue and ROAS targets, and without them it shows a notice. Hide `/metric-tree` as well, because the tree is built around order value. Put your CPA target in the `targets` table with the metric `cpa`.

5. **Hide Products and Buckets.**

   - **All accounts are lead-gen:** delete the `/products` and `/buckets` entries from `ALL_PAGES` in `src/components/nav.ts`. The URLs still exist but nothing links to them. Remove `products` from `LINK_PAGES` in `src/lib/insightAgent.ts` too, so the AI does not link to it.
   - **Only some accounts are:** for Buckets, add `hiddenPages: ['/buckets']` to the account in `dashboard.config.ts`. Products has no such switch yet. Add `'/products'` to `OptionalPage` in `dashboard.config.ts`, include it in `pageAvailable` in `src/components/nav.ts`, and copy the redirect from `src/app/(dashboard)/buckets/page.tsx` into the Products page, sending people to `/`. That Buckets redirect goes to `/products`, so change it to `/` as well.

6. **Skip the product sync,** if all accounts are lead-gen. Remove `'product'` from `FACTS` in `src/lib/sync/dailyPlan.ts` and update `dailyPlan.test.ts`. The query returns nothing for these accounts anyway, and takes time.

7. **Adjust the AI,** if it is on. The prompts talk about revenue, order value and "basket". Rewrite the `SYSTEM` text in `src/lib/insightAgent.ts` and `src/lib/chatAgent.ts` around leads and CPA, and change `suggestions.ts`.

8. **Check the conversions themselves.** `conversions` is whatever the account has as primary. Make sure that is the lead you steer on, not a page view or a form start. Set `lagDays` to how long your leads take to report, both in the config and in `accounts.lag_days`.

9. **Set your campaign categories.** Lead-gen accounts often group by service or audience. See `change-the-name-parser.md`.

The demo is an ecommerce story and will show your new labels on its fictional shops. That is fine. It only has to keep working.

## Check it worked

- `npm run typecheck` and `npm test` pass, and the demo still opens with no environment variables.
- The Overview shows leads and CPA, and no zero Revenue or ROAS tiles.
- Products and Buckets are gone from the sidebar.
- Leads and CPA for a closed month match Google Ads.
- Search the UI for the words Revenue, Purchases and order: only intended ones are left.
