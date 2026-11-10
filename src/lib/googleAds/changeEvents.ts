import { TIME_ZONE } from '@/lib/config';
// Pure mapping of Google Ads change_event rows to table rows with a short
// English summary. Kept free of 'server-only' so it can be unit tested.

export const CHANGE_EVENT_LIMIT = 10_000;
// Google only serves change_event rows from the last 30 days; the GAQL window
// is clamped to this many days back (inclusive of today).
export const CHANGE_EVENT_REACH_DAYS = 29;
// change_date_time is account-local wall-clock time without an offset. All
// accounts run in the time zone from dashboard.config.ts.
export const ACCOUNT_TIME_ZONE = TIME_ZONE;

const RESOURCE_TYPE_NAMES: Record<string, string> = {
  '2': 'AD', '3': 'AD_GROUP', '4': 'AD_GROUP_CRITERION', '5': 'CAMPAIGN', '6': 'CAMPAIGN_BUDGET', '7': 'AD_GROUP_BID_MODIFIER',
  '8': 'CAMPAIGN_CRITERION', '9': 'FEED', '10': 'FEED_ITEM', '11': 'CAMPAIGN_FEED', '12': 'AD_GROUP_FEED', '13': 'AD_GROUP_AD',
  '14': 'ASSET', '15': 'CUSTOMER_ASSET', '16': 'CAMPAIGN_ASSET', '17': 'AD_GROUP_ASSET', '18': 'ASSET_SET',
  '19': 'ASSET_SET_ASSET', '20': 'CAMPAIGN_ASSET_SET',
};
const OPERATION_NAMES: Record<string, string> = { '2': 'CREATE', '3': 'UPDATE', '4': 'REMOVE' };
const CLIENT_TYPE_NAMES: Record<string, string> = {
  '2': 'GOOGLE_ADS_WEB_CLIENT', '3': 'GOOGLE_ADS_AUTOMATED_RULE', '4': 'GOOGLE_ADS_SCRIPTS', '5': 'GOOGLE_ADS_BULK_UPLOAD',
  '6': 'GOOGLE_ADS_API', '7': 'GOOGLE_ADS_EDITOR', '8': 'GOOGLE_ADS_MOBILE_APP', '9': 'GOOGLE_ADS_RECOMMENDATIONS',
  '10': 'SEARCH_ADS_360_SYNC', '11': 'SEARCH_ADS_360_POST', '12': 'INTERNAL_TOOL', '13': 'OTHER',
  '14': 'GOOGLE_ADS_RECOMMENDATIONS_SUBSCRIPTION',
};
const STATUS_NAMES: Record<string, string> = {
  '2': 'ENABLED', '3': 'PAUSED', '4': 'REMOVED', ENABLED: 'ENABLED', PAUSED: 'PAUSED', REMOVED: 'REMOVED',
};
const STATUS_WORDS: Record<string, string> = { ENABLED: 'enabled', PAUSED: 'paused', REMOVED: 'removed' };
export const BIDDING_NAMES: Record<string, string> = {
  '2': 'COMMISSION', '3': 'ENHANCED_CPC', '4': 'INVALID', '5': 'MANUAL_CPA', '6': 'MANUAL_CPC', '7': 'MANUAL_CPM', '8': 'MANUAL_CPV',
  '9': 'MAXIMIZE_CONVERSIONS', '10': 'MAXIMIZE_CONVERSION_VALUE', '11': 'PAGE_ONE_PROMOTED', '12': 'PERCENT_CPC',
  '13': 'TARGET_CPA', '14': 'TARGET_CPM', '15': 'TARGET_IMPRESSION_SHARE', '16': 'TARGET_OUTRANK_SHARE', '17': 'TARGET_ROAS',
  '18': 'TARGET_SPEND',
};

// Noun per resource type, used in summaries and as the fallback label.
const RESOURCE_WORDS: Record<string, string> = {
  AD: 'Ad', AD_GROUP: 'Ad group', AD_GROUP_CRITERION: 'Ad group criterion', CAMPAIGN: 'Campaign',
  CAMPAIGN_BUDGET: 'Campaign budget', AD_GROUP_BID_MODIFIER: 'Bid adjustment', CAMPAIGN_CRITERION: 'Campaign criterion',
  FEED: 'Feed', FEED_ITEM: 'Feed item', CAMPAIGN_FEED: 'Campaign feed', AD_GROUP_FEED: 'Ad group feed',
  AD_GROUP_AD: 'Ad', ASSET: 'Asset', CUSTOMER_ASSET: 'Account asset', CAMPAIGN_ASSET: 'Campaign asset',
  AD_GROUP_ASSET: 'Ad group asset', ASSET_SET: 'Asset set', ASSET_SET_ASSET: 'Asset set item',
  CAMPAIGN_ASSET_SET: 'Campaign asset set',
};
const OPERATION_WORDS: Record<string, string> = { CREATE: 'added', UPDATE: 'changed', REMOVE: 'removed' };

const enumName = (table: Record<string, string>, value: unknown) => {
  const key = String(value ?? '');
  return table[key] || key || 'UNKNOWN';
};

export interface ChangeEventRow {
  change_time: string;        // ISO 8601, UTC
  resource_name: string;
  resource_type: string;
  operation: string;
  campaign_id: string | null;
  campaign_name: string | null;
  changed_fields: string[];
  summary: string;
  user_email: string;
  client_type: string;
}

// --- time ------------------------------------------------------------------

const tzOffsetMs = (utcMs: number, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value || 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - Math.floor(utcMs / 1000) * 1000;
};

// 'YYYY-MM-DD HH:MM:SS[.ffffff]' in the account time zone -> ISO UTC string.
export function localDateTimeToIso(local: string, timeZone = ACCOUNT_TIME_ZONE): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?/.exec(String(local || ''));
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const millis = match[7] ? Math.floor(Number(match[7].padEnd(6, '0')) / 1000) : 0;
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = wall - tzOffsetMs(wall, timeZone);
  const secondPass = tzOffsetMs(utc, timeZone);
  if (wall - secondPass !== utc) utc = wall - secondPass;
  return new Date(utc + millis).toISOString();
}

// --- value helpers ---------------------------------------------------------

const get = (obj: unknown, path: string): unknown => {
  let current: any = obj;
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
};

const fmtAmount = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '');
};
const microsToText = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? fmtAmount(n / 1_000_000) : null;
};
const roasToText = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : null;
};

const fieldPaths = (changedFields: unknown): string[] => {
  if (Array.isArray(changedFields)) return changedFields.map(String);
  if (changedFields && typeof changedFields === 'object' && Array.isArray((changedFields as any).paths)) {
    return (changedFields as any).paths.map(String);
  }
  if (typeof changedFields === 'string' && changedFields) return changedFields.split(',').map(s => s.trim()).filter(Boolean);
  return [];
};

const transition = (label: string, before: string | null, after: string | null, suffix = '') => {
  if (before !== null && after !== null && before !== after) return `${label}: ${before} -> ${after}${suffix}`;
  if (after !== null) return `${label}: ${after}${suffix}`;
  if (before !== null) return `${label}: ${before}${suffix}`;
  return null;
};

const firstOf = (resource: unknown, paths: string[]): unknown => {
  for (const path of paths) {
    const value = get(resource, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const shortFields = (fields: string[]) => {
  if (fields.length === 0) return '';
  const names = fields.slice(0, 4).map(f => f.split('.').pop() || f);
  return ` (${names.join(', ')}${fields.length > 4 ? ', ...' : ''})`;
};

// --- summary ---------------------------------------------------------------

interface SummaryInput {
  resourceType: string;
  operation: string;
  fields: string[];
  oldResource: unknown;
  newResource: unknown;
}

export function buildSummary(input: SummaryInput): string {
  const { resourceType, operation, fields, oldResource, newResource } = input;
  const noun = RESOURCE_WORDS[resourceType] || resourceType || 'Change';
  const verb = OPERATION_WORDS[operation] || operation.toLowerCase();
  const has = (needle: string) => fields.some(f => f.includes(needle));

  if (resourceType === 'CAMPAIGN_BUDGET') {
    const before = microsToText(get(oldResource, 'campaign_budget.amount_micros'));
    const after = microsToText(get(newResource, 'campaign_budget.amount_micros'));
    const line = transition('Campaign budget', before, after, ' per day');
    if (line && (operation !== 'UPDATE' || has('amount_micros') || before !== after)) return line;
    if (operation === 'UPDATE') return `Campaign budget changed${shortFields(fields)}`;
    return `Campaign budget ${verb}`;
  }

  if (resourceType === 'CAMPAIGN') {
    const parts: string[] = [];
    const oldStatus = get(oldResource, 'campaign.status');
    const newStatus = get(newResource, 'campaign.status');
    if (operation === 'CREATE') parts.push('Campaign created');
    else if (operation === 'REMOVE') parts.push('Campaign removed');
    else if (newStatus !== undefined && (has('status') || oldStatus !== newStatus)) {
      const name = enumName(STATUS_NAMES, newStatus);
      parts.push(`Campaign ${STATUS_WORDS[name] || `status ${name}`}`);
    }
    const roasPaths = ['campaign.maximize_conversion_value.target_roas', 'campaign.target_roas.target_roas'];
    const roasLine = transition('tROAS', roasToText(firstOf(oldResource, roasPaths)), roasToText(firstOf(newResource, roasPaths)));
    if (roasLine && (has('target_roas') || operation === 'CREATE')) parts.push(roasLine);
    const cpaPaths = ['campaign.maximize_conversions.target_cpa_micros', 'campaign.target_cpa.target_cpa_micros'];
    const cpaLine = transition('tCPA', microsToText(firstOf(oldResource, cpaPaths)), microsToText(firstOf(newResource, cpaPaths)));
    if (cpaLine && (has('target_cpa') || operation === 'CREATE')) parts.push(cpaLine);
    if (has('bidding_strategy_type') && operation === 'UPDATE') {
      const strategy = (resource: unknown) => {
        const value = get(resource, 'campaign.bidding_strategy_type');
        return value === undefined || value === null || value === '' ? null : enumName(BIDDING_NAMES, value);
      };
      const line = transition('Bid strategy', strategy(oldResource), strategy(newResource));
      if (line) parts.push(line);
    }
    if (has('name') && operation === 'UPDATE') {
      const line = transition('Campaign name', String(get(oldResource, 'campaign.name') ?? '') || null,
        String(get(newResource, 'campaign.name') ?? '') || null);
      if (line) parts.push(line);
    }
    if (parts.length > 0) return parts.join('; ');
    return `Campaign changed${shortFields(fields)}`;
  }

  if (resourceType === 'AD_GROUP_AD' || resourceType === 'AD') {
    if (operation === 'CREATE') return 'Ad added';
    if (operation === 'REMOVE') return 'Ad removed';
    const status = get(newResource, 'ad_group_ad.status');
    if (status !== undefined && has('status')) {
      const name = enumName(STATUS_NAMES, status);
      return `Ad ${STATUS_WORDS[name] || `status ${name}`}`;
    }
    return `Ad changed${shortFields(fields)}`;
  }

  if (resourceType === 'AD_GROUP_CRITERION' || resourceType === 'CAMPAIGN_CRITERION') {
    const base = resourceType === 'AD_GROUP_CRITERION' ? 'ad_group_criterion' : 'campaign_criterion';
    const resource = operation === 'REMOVE' ? oldResource : newResource;
    const either = (path: string) => get(resource, `${base}.${path}`) ?? get(oldResource, `${base}.${path}`) ?? get(newResource, `${base}.${path}`);
    const keyword = either('keyword.text');
    const negative = Boolean(either('negative'));
    const scope = resourceType === 'CAMPAIGN_CRITERION' ? ' (campaign)' : '';
    if (keyword !== undefined || has('keyword')) {
      const label = negative ? 'Negative keyword' : 'Keyword';
      const text = keyword !== undefined ? `: ${String(keyword)}` : '';
      return `${label}${scope} ${verb}${text}`;
    }
    // The criterion kind decides the noun: Shopping product partitions,
    // locations and languages are the usual non-keyword criteria here.
    const kind = has('listing_group') || either('listing_group') !== undefined ? 'Product group'
      : has('location') || either('location') !== undefined ? 'Location'
      : has('language') || either('language') !== undefined ? 'Language'
      : has('placement') || either('placement') !== undefined ? 'Placement'
      : has('user_list') || either('user_list') !== undefined ? 'Audience'
      : noun;
    const kindLabel = negative && kind !== noun ? `${kind} (exclusion)` : kind;
    if (operation === 'UPDATE' && has('status')) {
      const name = enumName(STATUS_NAMES, get(newResource, `${base}.status`));
      return `${kindLabel} ${STATUS_WORDS[name] || `status ${name}`}`;
    }
    if (operation === 'UPDATE' && has('cpc_bid_micros')) {
      const line = transition(`${kindLabel} bid`, microsToText(get(oldResource, `${base}.cpc_bid_micros`)), microsToText(get(newResource, `${base}.cpc_bid_micros`)));
      if (line) return line;
    }
    return `${kindLabel} ${verb}${operation === 'UPDATE' ? shortFields(fields) : ''}`;
  }

  if (resourceType === 'AD_GROUP') {
    if (operation === 'CREATE') return 'Ad group created';
    if (operation === 'REMOVE') return 'Ad group removed';
    const status = get(newResource, 'ad_group.status');
    if (status !== undefined && has('status')) {
      const name = enumName(STATUS_NAMES, status);
      return `Ad group ${STATUS_WORDS[name] || `status ${name}`}`;
    }
    return `Ad group changed${shortFields(fields)}`;
  }

  return `${noun} ${verb}${operation === 'UPDATE' ? shortFields(fields) : ''}`;
}

// --- row mapping -------------------------------------------------------------

export function mapChangeEvent(row: any): ChangeEventRow | null {
  const event = row?.change_event || {};
  const changeTime = localDateTimeToIso(event.change_date_time);
  const resourceName = String(event.change_resource_name || '');
  if (!changeTime || !resourceName) return null;
  const resourceType = enumName(RESOURCE_TYPE_NAMES, event.change_resource_type);
  const operation = enumName(OPERATION_NAMES, event.resource_change_operation);
  const fields = fieldPaths(event.changed_fields);
  const campaignId = row?.campaign?.id !== undefined && row?.campaign?.id !== null ? String(row.campaign.id) : null;
  return {
    change_time: changeTime,
    resource_name: resourceName,
    resource_type: resourceType,
    operation,
    campaign_id: campaignId && campaignId !== '0' ? campaignId : null,
    campaign_name: row?.campaign?.name ? String(row.campaign.name) : null,
    changed_fields: fields,
    summary: buildSummary({ resourceType, operation, fields, oldResource: event.old_resource, newResource: event.new_resource }),
    user_email: String(event.user_email || ''),
    client_type: enumName(CLIENT_TYPE_NAMES, event.client_type),
  };
}

// The table key is (account, resource, time). Two operations on the same
// resource inside the same second collapse into one row: fields are unioned and
// distinct summaries joined, so a single publish batch never hits its own key twice.
export function dedupeChangeEvents(rows: ChangeEventRow[]): ChangeEventRow[] {
  const merged = new Map<string, ChangeEventRow>();
  for (const row of rows) {
    const key = `${row.resource_name}|${row.change_time}`;
    const current = merged.get(key);
    if (!current) { merged.set(key, { ...row, changed_fields: [...row.changed_fields] }); continue; }
    for (const field of row.changed_fields) if (!current.changed_fields.includes(field)) current.changed_fields.push(field);
    if (row.summary && !current.summary.split('; ').includes(row.summary)) current.summary = `${current.summary}; ${row.summary}`;
    if (!current.campaign_name && row.campaign_name) { current.campaign_name = row.campaign_name; current.campaign_id = row.campaign_id; }
  }
  return [...merged.values()];
}

// Google rejects change_event queries older than 30 days: clamp the start and
// carry on. Returns null when the whole window lies before the reach.
export function clampChangeWindow(start: string, end: string, today = new Date()): { start: string; end: string } | null {
  const floor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - CHANGE_EVENT_REACH_DAYS));
  const floorDate = floor.toISOString().slice(0, 10);
  const clampedStart = start < floorDate ? floorDate : start;
  if (clampedStart > end) return null;
  return { start: clampedStart, end };
}
