// The data view the AI analysis and the chat work on: one account, the period, the
// comparison and the top-bar filters, read from the same query string the pages use.
import 'server-only';
import { createHash } from 'node:crypto';
import { listAccounts, resolveScope, type Account } from './accounts';
import { addDays, accountToday, isoDate, type DateRange } from './metrics';
import { resolveCompareRange } from './compareRange';
import type { FilterState } from './filters';
import { buildBrief } from './insightAgent';
import { getSupabaseAdmin } from './supabaseAdmin';
import { parsePlatform, targetsApply, type Platform } from './platform';
import { applyFilters } from './filters';
import { goalsFor } from './goals';
import { readCampaignFacts, readTargets } from './reports';
import { overviewSignals } from './insightSignals';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 731;
const spanDays = (r: DateRange) => (Date.parse(r.end) - Date.parse(r.start)) / 86_400_000 + 1;

export interface View {
  account: Account;
  range: DateRange;
  compareRange: DateRange | null;
  filters: FilterState & { categories: string[]; status: string };
  platform: Platform;   // one platform per view, Google by default (platform.ts)
  today: string;
  maturedEnd: string;   // last day whose revenue is complete (outside lag_days)
}

export async function readView(params: URLSearchParams): Promise<View | { error: string }> {
  const start = params.get('start') || '';
  const end = params.get('end') || '';
  if (!DATE.test(start) || !DATE.test(end) || start > end) return { error: 'start and end (YYYY-MM-DD) are required' };
  const accounts = resolveScope(await listAccounts(), params.get('scope'));
  if (accounts.length !== 1) return { error: 'One account per analysis' };
  const list = (key: string) => (params.get(key) || '').split(',').filter(Boolean);
  const range = { start, end };
  const compareRange = resolveCompareRange(params, range);
  // Every analysis and chat answer reads facts for these ranges: two years at most each,
  // so one request cannot make the agent pull the whole history.
  if (spanDays(range) > MAX_SPAN_DAYS || (compareRange && spanDays(compareRange) > MAX_SPAN_DAYS)) {
    return { error: `A period can span at most ${MAX_SPAN_DAYS} days` };
  }
  const today = isoDate(accountToday());
  return {
    account: accounts[0],
    range,
    compareRange,
    filters: { campaigns: list('campaigns'), networks: list('networks'), categories: list('categories'), excludeBrand: params.get('brand') === '0', status: params.get('status') || '' },
    platform: parsePlatform(params.get('platform')),
    today,
    maturedEnd: addDays(today, -accounts[0].lag_days - 1),
  };
}

export const narrowed = (v: View) => v.filters.campaigns.length > 0 || v.filters.networks.length > 0 || v.filters.categories.length > 0 || v.filters.excludeBrand || v.filters.status !== '';

// The view in words for the model; campaign ids become names where the facts know them.
export function viewBrief(v: View, campaignNames: Map<string, string> = new Map()) {
  const f = v.filters;
  return buildBrief({
    accountLabel: v.account.display_name, range: v.range, compareRange: v.compareRange, maturedEnd: v.maturedEnd, today: v.today,
    filters: [
      ...(v.platform === 'microsoft' ? ['platform Microsoft Ads (no Google Ads data)'] : []),
      ...(f.networks.length ? [`networks ${f.networks.join(', ')}`] : []),
      ...(f.categories.length ? [`categories ${f.categories.join(', ')}`] : []),
      ...(f.campaigns.length ? [`campaigns ${f.campaigns.map(id => campaignNames.get(id) ?? id).join(', ')}`] : []),
      ...(f.excludeBrand ? ['excluding brand campaigns'] : []),
      ...(f.status ? [`status ${f.status}`] : []),
    ],
  });
}

// When the account context last changed: the newest published finding for this account
// or for both. Part of the analysis cache key, so a cached story is redone once new audit
// findings or notes land instead of waiting for the next day.
// Hidden communications are part of it too: hiding an item makes a new key, so a stored
// analysis that cited it is never served again (the new run cannot see the item). With
// nothing hidden the key is unchanged, so existing analyses and the account manager's edits keep their key.
export async function contextVersion(label: string): Promise<string> {
  const db = getSupabaseAdmin();
  const [findings, hidden] = await Promise.all([
    db.from('context_findings').select('synced_at')
      .or(`account_label.eq.${label},account_label.is.null`).order('synced_at', { ascending: false }).limit(1),
    db.from('communications').select('id').eq('hidden', true).order('id'),
  ]);
  if (findings.error) return '';
  const synced = (findings.data?.[0] as { synced_at: string } | undefined)?.synced_at ?? '';
  // Unreadable hidden set: a separate key, so no analysis stored under a known set is served.
  if (hidden.error) return `${synced}|hidden:unknown`;
  const ids = (hidden.data ?? []).map(r => (r as { id: string }).id);
  return ids.length ? `${synced}|hidden:${createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 16)}` : synced;
}

// The computed signals of the view (goal pace on matured days, shifts, mix, budget-lost
// IS): the starting point of the analysis and the chat. Also returns campaign names for
// the brief.
export async function viewSignals(v: View) {
  const { account, range, compareRange, filters, today } = v;
  const [current, compare, targets] = await Promise.all([
    readCampaignFacts([account.id], range.start, range.end, 'day', [v.platform]),
    compareRange ? readCampaignFacts([account.id], compareRange.start, compareRange.end, 'day', [v.platform]) : Promise.resolve([]),
    readTargets([account.id]),
  ]);
  // Goals only when no filter narrows the campaigns (a goal is for the whole account) and only for Google Ads.
  const goals = narrowed(v) || !targetsApply(v.platform) ? null : goalsFor(targets, account.id, range.end);
  const facts = overviewSignals({ rows: applyFilters(current, filters), compareRows: applyFilters(compare, filters), range, compareRange, today, lagDays: account.lag_days, goals });
  return { facts, goals, names: new Map(current.map(r => [r.campaign_id, r.campaign_name])) };
}
