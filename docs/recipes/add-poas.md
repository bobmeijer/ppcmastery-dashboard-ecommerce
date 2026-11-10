# Add POAS

## When to use it

You have margin data per product and want profit on ad spend next to ROAS. This repo ships no margin source and no POAS columns. This recipe is one way to add them, at product level.

POAS here is the margin earned from ads divided by ad cost: `sum(conversions_value * margin_rate) / sum(cost)`.

## Files to change

| File | Why |
|---|---|
| A new file in `supabase/migrations/` | The margin table, and a new `read_product_facts_json` |
| A script in `scripts/`, modelled on `scripts/add-account.mjs` | Loads the margins |
| `src/lib/bucketsShaping.ts` | `ProductFactRow` |
| `src/lib/productsShaping.ts` | Totals and derived values per product |
| `src/components/pages/products/ProductColumns.tsx` | The columns |
| `src/app/api/report/products/route.ts` | Remove margin for the `client` role, if it should stay private |
| `src/lib/demo/reads.ts`, `src/lib/demo/demo.test.ts` | Fake margin and the key list for "product facts" |
| `src/lib/insightAgent.ts`, `src/lib/chatAgent.ts` | The prompts forbid profit, margin and POAS. Remove that rule if you want the AI to use them |

## Steps

1. **Choose a margin source.** Options:
   - A custom label in the feed. `custom_label_0` to `custom_label_4` are already synced, so margin bands need no new table.
   - A spreadsheet or CSV you import.
   - An API from your shop system or profit tool.

2. **Check what your conversion value contains.** If it includes tax or shipping, your margin must be measured against the same amount.

3. **Add the table.** New tables are open to `anon` until you close them:

   ```sql
   create table public.product_margins (
     account_id text not null references public.accounts(id),
     product_item_id text not null,
     margin_rate double precision not null check (margin_rate >= 0 and margin_rate <= 1),
     valid_from date not null,
     valid_to date,
     primary key (account_id, product_item_id, valid_from)
   );
   alter table public.product_margins enable row level security;
   revoke all on public.product_margins from public, anon, authenticated;
   grant all on public.product_margins to service_role;
   ```

   Do not add a policy.

4. **Load margins** with a script that upserts through the service role. Product IDs must match `product_item_id` in `ads_product_daily`.

5. **Extend the read function.** `read_product_facts_json` has two branches, daily and monthly. In both, compute `sum(f.conversions_value * coalesce(m.margin_rate, 0)) as margin_value`, with a lateral join to the margin valid on that date. Decide what a missing margin means. Showing 0 understates POAS, so also return the share of cost that has a margin.

6. **Add it to the shaping and the columns.** Add `margin_value` to `ProductFactRow`, sum it per product in `src/lib/productsShaping.ts`, and compute POAS from the totals. Add a test. Add columns in `ProductColumns.tsx`.

7. **Decide about campaign level.** `ads_product_daily` covers Shopping and Performance Max only. For Search there is no product data, so campaign or account POAS needs a blended margin as a fallback. Label it as an estimate.

8. **Update the demo.** Add a fake `margin_value` in `productFacts` in `src/lib/demo/reads.ts`, and the key in `src/lib/demo/demo.test.ts`.

## Check it worked

- `npm run typecheck` and `npm test` pass, and the demo shows the column.
- For one product and period, compute POAS by hand from Google Ads and your margin, and compare.
- A `client` login sees only what you meant it to see. Check the JSON response as well, because hiding a column does not hide the data.
