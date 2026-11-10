import { NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/requestGuards';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { syncFeed } from '@/lib/sync/feedSync';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// GET /api/cron/feed[?accounts=label,label]
// Daily Vercel cron: the latest product state per account (Google Ads
// shopping_product + Merchant API) for Feed status, thumbnails and the
// zero-impression products. Same Bearer auth as the other crons.
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const all = await listAccounts();
  const scope = url.searchParams.get('accounts');
  const accounts = scope ? scope.split(',').flatMap(s => resolveScope(all, s.trim())) : all;
  if (accounts.length === 0) return NextResponse.json({ error: 'No matching accounts' }, { status: 400 });

  const results: unknown[] = [];
  const errors: { account: string; error: string }[] = [];
  for (const account of accounts) {
    try {
      results.push(await syncFeed(account));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Feed sync failed for ${account.label}: ${message}`);
      errors.push({ account: account.label, error: message });
    }
  }
  const ok = errors.length === 0;
  return NextResponse.json({ dataset: 'feed', ok, results, errors }, { status: ok ? 200 : 500 });
}
