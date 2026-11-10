import 'server-only';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';

export type SyncSource = 'google_ads' | 'microsoft_ads' | 'merchant' | 'sheets' | 'meetings';

export interface RunDescriptor {
  source: SyncSource;
  dataset: string;
  accountId: string | null;
  startDate: string | null;
  endDate: string | null;
  metadata?: Record<string, unknown>;
}

const STALE_RUN_MINUTES = 20;

export async function startRun(descriptor: RunDescriptor): Promise<string> {
  const supabase = getSupabaseAdmin();
  // A worker that died mid-run leaves a 'running' row behind; expire it so the
  // status page does not show a sync that is never going to finish.
  const staleBefore = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
  await supabase.from('sync_runs').update({
    status: 'failed', error_message: 'Sync worker ended before completion', completed_at: new Date().toISOString(),
  }).eq('source', descriptor.source).eq('dataset', descriptor.dataset).eq('status', 'running').lt('started_at', staleBefore);

  const { data, error } = await supabase.from('sync_runs').insert({
    source: descriptor.source, dataset: descriptor.dataset, account_id: descriptor.accountId,
    start_date: descriptor.startDate, end_date: descriptor.endDate, status: 'running',
    metadata: descriptor.metadata || {},
  }).select('id').single();
  assertOk(error, 'Unable to start sync run');
  return data!.id as string;
}

export async function failRun(runId: string, error: unknown, durationMs: number) {
  const message = error instanceof Error ? error.message : String(error);
  await getSupabaseAdmin().from('sync_runs').update({
    status: 'failed', error_message: message.slice(0, 4000), duration_ms: durationMs, completed_at: new Date().toISOString(),
  }).eq('id', runId);
}

export async function completeRun(runId: string, rowCount: number, durationMs: number, metadata: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from('sync_runs').select('metadata').eq('id', runId).maybeSingle();
  await supabase.from('sync_runs').update({
    status: 'complete', row_count: rowCount, duration_ms: durationMs, completed_at: new Date().toISOString(),
    metadata: { ...(data?.metadata || {}), ...metadata },
  }).eq('id', runId);
}

export async function skipRun(runId: string, reason: string, durationMs: number) {
  await getSupabaseAdmin().from('sync_runs').update({
    status: 'skipped', error_message: reason, duration_ms: durationMs, completed_at: new Date().toISOString(),
  }).eq('id', runId);
}
