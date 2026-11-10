# Add a page

## When to use it

You want a new view, such as a report for a specific client question.

## Files to change

Every page needs:

| File | Why |
|---|---|
| `src/app/(dashboard)/your-page/page.tsx` | The page. `src/app/(dashboard)/devices/page.tsx` is a good one to copy |
| `src/components/nav.ts` | An entry in `ALL_PAGES` |
| `src/components/Icons.tsx` | Only if you need a new icon |
| `src/lib/yourShaping.ts`, `src/lib/yourShaping.test.ts` | Pure logic and its test |

A page with its own data also needs:

| File | Why |
|---|---|
| A new file in `supabase/migrations/` | The read function |
| `src/lib/reports-your.ts` | The server reader |
| `src/app/api/report/your/route.ts` | The endpoint |
| `src/hooks/useYour.ts` | The fetch |
| `src/lib/demo/fakeClient.ts`, `src/lib/demo/reads.ts` | The demo answer |
| `src/lib/modules.ts` | Only if the page belongs to an optional module |

## Steps

1. **Start from data you already have.** `useCampaignReport` returns campaign rows per period. If that is enough, you only need the page, the nav entry and a shaping function.

2. **Write the shaping as a pure function** with a test. No React and no server imports, so it can run anywhere.

3. **Build the page** as a client component. Use `useScope` for the account and period, `applyFilters` for the top bar, and `useSetFreshness` and `useSetFilterOptions` as the Devices page does. Client-facing copy goes in sentence case.

4. **Add the entry** to `ALL_PAGES` in `src/components/nav.ts`:

   ```ts
   { href: '/your-page', label: 'Your page', icon: 'overview', group: 'Analysis' },
   ```

   For an admin-only page, set `adminOnly: true` and add the path to `ADMIN_PATHS` in `src/middleware.ts`. The nav entry only hides the link. The middleware is what blocks it.

For new data, do these as well:

5. **Write a read function** in a new migration. New functions are open to `anon` until you close them:

   ```sql
   create function public.read_your_json(p_account_ids text[], p_start_date date, p_end_date date) returns jsonb
     language sql stable security definer
     set search_path to 'public'
     as $$
       select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
         select f.fact_date, sum(f.cost) as cost
         from public.ads_campaign_daily f
         where f.account_id = any(p_account_ids) and f.fact_date between p_start_date and p_end_date
         group by f.fact_date
       ) x;
     $$;

   revoke all on function public.read_your_json(text[], date, date) from public, anon, authenticated;
   grant execute on function public.read_your_json(text[], date, date) to service_role;
   ```

6. **Write the route.** Start with `requireSession('client')`, validate the dates, and resolve accounts with `resolveScope(await listAccounts(), scope)`. Never let a query parameter pick a table or a column. Copy `src/app/api/report/devices/route.ts`.

7. **Add it to the demo.** Add a `case 'read_your_json'` in `Store.rpc` in `src/lib/demo/fakeClient.ts`, and a reader in `src/lib/demo/reads.ts`. Without this, the demo page shows an error.

8. **If the page is optional,** add its page and API path to `PATHS` in `src/lib/modules.ts` and `module: 'yourKey'` to the nav entry.

## Check it worked

- `npm run typecheck` and `npm test` pass.
- `npm run dev` with no environment variables shows the page with data.
- With real data, sign in as a `client` user and confirm the page shows only what that role should see.
- Calling the API route without a session returns 401.
