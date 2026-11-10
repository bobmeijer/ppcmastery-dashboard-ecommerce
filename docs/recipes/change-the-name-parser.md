# Change the name parser

## When to use it

Categories show as Other, or your campaign names look nothing like the example scheme `08 | Category [H+S]`.

## Files to change

| File | Why |
|---|---|
| `dashboard.config.ts` | `campaignNames`: `pattern`, `prefixNetwork`, `categoryAliases`, `bucketTokens` |
| `src/lib/campaignParser.ts` | Only if a pattern cannot express your scheme |
| `src/lib/campaignParser.test.ts` | Its cases use the example scheme, so replace them with your names |
| `src/lib/demo/world.ts`, `src/lib/demo/demo.test.ts` | Demo campaign names go through the same parser |

## Steps

1. Collect real campaign names. Five is enough to start, and include the odd ones.

2. Write a `pattern` in `dashboard.config.ts`. The groups must be in this order: 1 network prefix, 2 category, 3 bucket. For names such as `SEA_Stoves_H+S`:

   ```ts
   campaignNames: {
     pattern: /^(SEA|SHOP|PMAX)_([^_]+)(?:_([A-Z+]+))?$/,
     prefixNetwork: { SEA: 'Search', SHOP: 'Shopping', PMAX: 'PMax' },
     categoryAliases: { brand: 'Brand', stoves: 'Stoves' },
     bucketTokens: ['H', 'S', 'V', 'Z', 'ALL', 'BOOST', 'FEEDER'],
   },
   ```

   Keep the group order even if you do not use buckets. An unused third group is fine.

3. Know the rules in `classifyCampaign`:
   - A name that does not match gets the network from its channel type, the category `Other`, and `parsed: false`.
   - Display, Video and Demand Gen channel types win over the prefix.
   - `categoryAliases` keys are lower case, and map spellings to one label.
   - The category must be exactly `Brand` for branded campaigns, because `isBrand` in `src/lib/filters.ts` and the network split depend on it.

4. If there is no pattern at all, rewrite the body of `classifyCampaign`. Keep its return shape: `{ network, category, bucket, parsed }`.

5. Fix single campaigns by hand with an override, which wins over the parser:

   ```sql
   insert into campaign_overrides (account_id, campaign_id, category, note)
   values ('YOUR_ACCOUNT_ID', 'YOUR_CAMPAIGN_ID', 'Stoves', 'Set by hand');
   ```

6. Update `src/lib/campaignParser.test.ts` with your names.

7. Keep the demo working. If you changed the `pattern`, tests in `campaignParser.test.ts` and `demo.test.ts` fail until you finish this step. Rename the demo campaigns in `SHOP_CAMPAIGNS` in `src/lib/demo/world.ts` to your scheme, so they still get categories such as `Stoves` and networks such as `PMax`. Then update the names `demo.test.ts` looks for, such as `03 | Fire pits`.

8. Apply it to real data. One campaign sync is enough, because category and network are joined at read time:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/google-ads?dataset=campaign&days=1"
   ```

## Check it worked

- `npm test` passes.
- `npm run doctor` reports how many campaign names match.
- The Status page lists the campaigns that are still unrecognised.
- The Categories page shows your categories.
