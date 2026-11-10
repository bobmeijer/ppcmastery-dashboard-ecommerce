import { NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/requestGuards';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { DATASETS, Dataset } from '@/lib/googleAds/datasets';
import { defaultWindow, previousMonths, syncDataset, Grain } from '@/lib/sync/googleAdsSync';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/cron/google-ads?dataset=campaign[&startDate=&endDate=&accounts=label,label&grain=month&days=N&months=N]
// Vercel cron and operational callers authenticate with CRON_SECRET.
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const dataset = (url.searchParams.get('dataset') || 'campaign') as Dataset;
  if (!DATASETS.includes(dataset)) {
    return NextResponse.json({ error: `Unknown dataset ${dataset}` }, { status: 400 });
  }
  const grain: Grain = url.searchParams.get('grain') === 'month' ? 'month' : 'day';
  const explicitStart = url.searchParams.get('startDate');
  const explicitEnd = url.searchParams.get('endDate');
  // ?days=N widens the default window, ?months=N the monthly product refresh: a wider
  // re-sync (docs/recipes/faster-sync.md) can re-read 120 days because conversions keep settling for
  // about 90 to 107 days after the click.
  const days = Number(url.searchParams.get('days')) || undefined;
  const months = Math.min(12, Number(url.searchParams.get('months')) || 2);
  const window = defaultWindow(dataset, days);
  const start = explicitStart && DATE.test(explicitStart) ? explicitStart : window.start;
  const end = explicitEnd && DATE.test(explicitEnd) ? explicitEnd : window.end;
  if (start > end) return NextResponse.json({ error: 'startDate is after endDate' }, { status: 400 });

  const all = await listAccounts();
  const scope = url.searchParams.get('accounts');
  const accounts = scope ? scope.split(',').flatMap(s => resolveScope(all, s.trim())) : all;
  if (accounts.length === 0) return NextResponse.json({ error: 'No matching accounts' }, { status: 400 });

  const results: unknown[] = [];
  const errors: { account: string; error: string }[] = [];
  for (const account of accounts) {
    try {
      results.push(await syncDataset(account, dataset, start, end, grain));
      // The daily product cron also refreshes the monthly rollup for the
      // current and previous month so the retention prune has something to
      // fall back on.
      if (dataset === 'product' && grain === 'day' && !explicitStart) {
        for (const month of previousMonths(months)) {
          results.push(await syncDataset(account, 'product', month.start, month.end, 'month'));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Google Ads ${dataset} sync failed for ${account.label} ${start}..${end}: ${message}`);
      errors.push({ account: account.label, error: message });
    }
  }
  const ok = errors.length === 0;
  return NextResponse.json({ dataset, grain, start, end, ok, results, errors }, { status: ok ? 200 : 500 });
}
