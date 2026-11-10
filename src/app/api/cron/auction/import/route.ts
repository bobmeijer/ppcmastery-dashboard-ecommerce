import { NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/requestGuards';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { parseAuctionReport, parseCsv } from '@/lib/auctionParse';
import { publishAuctionReport } from '@/lib/sync/auctionSync';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// POST /api/cron/auction/import?account=<label>   (body: CSV text)
// Backfill of a Google Ads auction insights CSV export, sent in chunks by
// scripts/import-auction.mjs. Every chunk starts with the report's header row.
// Chunks are upserted, never replace a range: a chunk holds a slice of rows,
// not complete days. Bearer CRON_SECRET.
export async function POST(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const [account] = resolveScope(await listAccounts(), url.searchParams.get('account'));
  if (!account) return NextResponse.json({ error: 'Unknown account' }, { status: 400 });

  try {
    const report = parseAuctionReport(parseCsv(await request.text()));
    const rows = await publishAuctionReport(account.id, report, 'csv', false);
    return NextResponse.json({ ok: true, network: report.network, rows, skipped: report.skipped, duplicates: report.duplicates });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
