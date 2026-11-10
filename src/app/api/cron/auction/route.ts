import { NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/requestGuards';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { hasAuctionFolder, syncAuctionInsights } from '@/lib/sync/auctionSync';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// GET /api/cron/auction[?accounts=label,label][&lookback=N]
// Daily Vercel cron: reads the auction insights sheets Google Ads dropped in
// the account's Drive folder (scheduled report, 01:00) and replaces each
// report's date range. Same Bearer auth as the other crons. Accounts without a
// folder are left out unless named explicitly (then they log a skip).
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const all = await listAccounts();
  const scope = url.searchParams.get('accounts');
  const lookback = Number(url.searchParams.get('lookback'));
  const accounts = scope ? scope.split(',').flatMap(s => resolveScope(all, s.trim())) : all.filter(hasAuctionFolder);
  if (accounts.length === 0) return NextResponse.json({ error: 'No matching accounts' }, { status: 400 });

  const results: unknown[] = [];
  const errors: { account: string; error: string }[] = [];
  for (const account of accounts) {
    try {
      results.push(await syncAuctionInsights(account, lookback > 0 ? { lookbackDays: lookback } : {}));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Auction sync failed for ${account.label}: ${message}`);
      errors.push({ account: account.label, error: message });
    }
  }
  const ok = errors.length === 0;
  return NextResponse.json({ dataset: 'auction', ok, results, errors }, { status: ok ? 200 : 500 });
}
