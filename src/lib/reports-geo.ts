import 'server-only';
import { assertOk, getSupabaseAdmin } from './supabaseAdmin';
import type { Grain } from './reports';
import type { GeoRow } from './geoShaping';

// Geo facts: user-location country per campaign and period (RPC read_geo_facts_json).
export async function readGeoFacts(accountIds: string[], start: string, end: string, grain: Grain, platforms: string[] | null = null): Promise<GeoRow[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await getSupabaseAdmin().rpc('read_geo_facts_json', {
    p_account_ids: accountIds, p_start_date: start, p_end_date: end, p_grain: grain, p_platforms: platforms,
  });
  assertOk(error, 'Unable to read geo facts');
  return (data || []) as GeoRow[];
}

// Latest geo fact date per account; the geo dataset syncs daily and can trail the campaign facts.
export async function readGeoFreshness(accountIds: string[], platforms: string[] | null = null) {
  const supabase = getSupabaseAdmin();
  const result: Record<string, string | null> = {};
  for (const id of accountIds) {
    let query = supabase.from('ads_geo_daily').select('fact_date').eq('account_id', id);
    if (platforms) query = query.in('platform', platforms);
    const { data } = await query.order('fact_date', { ascending: false }).limit(1).maybeSingle();
    result[id] = data?.fact_date || null;
  }
  return result;
}
