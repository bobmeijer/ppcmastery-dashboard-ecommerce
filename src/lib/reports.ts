import 'server-only';
import { assertOk, getSupabaseAdmin } from './supabaseAdmin';
import type { FactRow } from './metrics';

export type Grain = 'day' | 'week' | 'month';

export async function readCampaignFacts(accountIds: string[], start: string, end: string, grain: Grain, platforms: string[] | null = null): Promise<FactRow[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await getSupabaseAdmin().rpc('read_campaign_facts_json', {
    p_account_ids: accountIds, p_start_date: start, p_end_date: end, p_grain: grain, p_platforms: platforms,
  });
  assertOk(error, 'Unable to read campaign facts');
  return (data || []) as FactRow[];
}

export interface RoleRow {
  account_id: string; period: string; campaign_id: string; role: string;
  conversion_action_id: string; conversion_action_name: string; conversions: number; conversions_value: number;
}

export async function readConversionRoles(accountIds: string[], start: string, end: string, grain: Grain, platforms: string[] | null = null): Promise<RoleRow[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await getSupabaseAdmin().rpc('read_conversion_roles_json', {
    p_account_ids: accountIds, p_start_date: start, p_end_date: end, p_grain: grain, p_platforms: platforms,
  });
  assertOk(error, 'Unable to read conversion roles');
  return (data || []) as RoleRow[];
}

export interface TargetRow {
  id: number; account_id: string; metric: string; value: number; kind: string; phase: string | null;
  valid_from: string; valid_to: string | null; note: string | null;
}

export async function readTargets(accountIds: string[]): Promise<TargetRow[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await getSupabaseAdmin().from('targets').select('*').in('account_id', accountIds).order('valid_from');
  assertOk(error, 'Unable to read targets');
  return (data || []) as TargetRow[];
}

export interface SyncStatusRow {
  source: string; dataset: string; account_id: string | null; status: string; start_date: string | null;
  end_date: string | null; row_count: number | null; duration_ms: number | null; error_message: string | null;
  started_at: string; completed_at: string | null;
}

export async function readSyncStatus(): Promise<SyncStatusRow[]> {
  const { data, error } = await getSupabaseAdmin().rpc('read_sync_status_json');
  assertOk(error, 'Unable to read sync status');
  return (data || []) as SyncStatusRow[];
}

export interface CoverageRow { dataset: string; account_id: string; platform: string; first_date: string | null; last_date: string | null; rows: number }

// First and last data day per dataset, account and platform (Status page).
export async function readDataCoverage(): Promise<CoverageRow[]> {
  const { data, error } = await getSupabaseAdmin().rpc('read_data_coverage_json');
  assertOk(error, 'Unable to read data coverage');
  return (data || []) as CoverageRow[];
}

export async function readUnparsedCampaigns() {
  const { data, error } = await getSupabaseAdmin().from('campaign_dim')
    .select('account_id,campaign_id,campaign_name,channel_type,status,network,category,bucket')
    .eq('parsed', false).eq('overridden', false).neq('status', 'REMOVED').order('campaign_name');
  assertOk(error, 'Unable to read campaign dimension');
  return data || [];
}

// Latest fact date per account: tells the UI how fresh the data is.
export async function readFreshness(accountIds: string[], platforms: string[] | null = null) {
  const supabase = getSupabaseAdmin();
  const result: Record<string, string | null> = {};
  for (const id of accountIds) {
    let query = supabase.from('ads_campaign_daily').select('fact_date').eq('account_id', id);
    if (platforms) query = query.in('platform', platforms);
    const { data } = await query.order('fact_date', { ascending: false }).limit(1).maybeSingle();
    result[id] = data?.fact_date || null;
  }
  return result;
}
