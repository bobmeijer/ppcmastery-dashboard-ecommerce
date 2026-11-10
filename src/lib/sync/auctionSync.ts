import { serverAccountSettings } from '../../../dashboard.server';
import 'server-only';
import type { Account } from '@/lib/accounts';
import { listFolderSpreadsheets, readSheetRange } from '@/lib/sheets/client';
import { AuctionNetwork, ParsedAuctionReport, ParsedAuctionRow, parseAuctionReport } from '@/lib/auctionParse';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { completeRun, failRun, skipRun, startRun } from './runs';

// Auction insights per account. Google Ads writes a scheduled report (Report
// Editor: campaign x day x competitor, last 7 days) as a Google Sheet into a
// Drive folder every night at 01:00 (a new file each night, same name). The
// sync reads every sheet changed in the last LOOKBACK_DAYS, oldest first, and
// lets each replace its own date range, so the newest report wins and late
// corrections come through.
const folderFor = (account: Account) => serverAccountSettings(account.label).auctionFolderId;
const LOOKBACK_DAYS = 3;
const BATCH = 5000;

export const hasAuctionFolder = (account: Account) => Boolean(folderFor(account));

export interface AuctionFileResult { file: string; network: AuctionNetwork; start: string | null; end: string | null; rows: number; skipped: number; duplicates: number }

export interface AuctionSyncResult {
  accountId: string;
  dataset: 'auction';
  status: 'complete' | 'skipped';
  rows: number;
  files: AuctionFileResult[];
  durationMs: number;
  runId: string;
}

// Publish one parsed report. The first batch replaces the report's date range,
// later batches of the same report only add (they fall inside that range).
export async function publishAuctionReport(accountId: string, report: ParsedAuctionReport, source: 'sheet' | 'csv', replace: boolean): Promise<number> {
  const supabase = getSupabaseAdmin();
  let written = 0;
  const batches: ParsedAuctionRow[][] = [];
  for (let i = 0; i < report.rows.length; i += BATCH) batches.push(report.rows.slice(i, i + BATCH));
  if (batches.length === 0 && replace && report.span) batches.push([]);
  for (const [i, rows] of batches.entries()) {
    const span = replace && i === 0 && report.span ? report.span : null;
    const { data, error } = await supabase.rpc('publish_auction_insights', {
      p_account_id: accountId, p_network: report.network, p_rows: rows, p_source: source,
      p_replace_from: span?.start ?? null, p_replace_to: span?.end ?? null,
    });
    assertOk(error, 'Unable to publish auction insights');
    written += Number(data ?? rows.length);
  }
  return written;
}

export async function syncAuctionInsights(account: Account, options: { lookbackDays?: number } = {}): Promise<AuctionSyncResult> {
  const startedAt = Date.now();
  const folderId = folderFor(account);
  const runId = await startRun({
    source: 'sheets', dataset: 'auction', accountId: account.id, startDate: null, endDate: null,
    metadata: folderId ? { folderId } : {},
  });
  const base = { accountId: account.id, dataset: 'auction' as const, runId };
  if (!folderId) {
    const durationMs = Date.now() - startedAt;
    await skipRun(runId, 'No auction insights folder configured for this account', durationMs);
    return { ...base, status: 'skipped', rows: 0, files: [], durationMs };
  }
  try {
    const since = new Date(Date.now() - (options.lookbackDays ?? LOOKBACK_DAYS) * 86_400_000).toISOString();
    const files = await listFolderSpreadsheets(folderId, since);
    const results: AuctionFileResult[] = [];
    let total = 0;
    for (const file of files) {
      const report = parseAuctionReport(await readSheetRange(file.id, 'A1:Z'));
      const rows = await publishAuctionReport(account.id, report, 'sheet', true);
      total += rows;
      results.push({ file: file.name, network: report.network, start: report.span?.start ?? null, end: report.span?.end ?? null, rows, skipped: report.skipped, duplicates: report.duplicates });
    }
    const durationMs = Date.now() - startedAt;
    if (files.length === 0) {
      await skipRun(runId, `No sheets changed in the folder in the last ${options.lookbackDays ?? LOOKBACK_DAYS} days`, durationMs);
      return { ...base, status: 'skipped', rows: 0, files: [], durationMs };
    }
    await completeRun(runId, total, durationMs, { files: results });
    return { ...base, status: 'complete', rows: total, files: results, durationMs };
  } catch (error) {
    await failRun(runId, error, Date.now() - startedAt);
    throw error;
  }
}
