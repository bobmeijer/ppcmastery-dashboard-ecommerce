import 'server-only';
import { assertOk, getSupabaseAdmin } from './supabaseAdmin';
import type { Grain } from './reports';
import type { DeviceFactRow } from './devicesShaping';

// Device facts (campaign x period x device) joined to campaign_dim for category and network.
export async function readDeviceFacts(accountIds: string[], start: string, end: string, grain: Grain, platforms: string[] | null = null): Promise<DeviceFactRow[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await getSupabaseAdmin().rpc('read_device_facts_json', {
    p_account_ids: accountIds, p_start_date: start, p_end_date: end, p_grain: grain, p_platforms: platforms,
  });
  assertOk(error, 'Unable to read device facts');
  return (data || []) as DeviceFactRow[];
}
