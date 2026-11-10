import 'server-only';
import type { Customer } from 'google-ads-api';
import { classifyCampaign } from '@/lib/campaignParser';
import { micros, num, queryWithRetry, resourceId } from './client';
import { BIDDING_NAMES, CHANGE_EVENT_LIMIT, ChangeEventRow, clampChangeWindow, dedupeChangeEvents, mapChangeEvent } from './changeEvents';

export type Dataset = 'campaign' | 'conversions' | 'geo' | 'device' | 'product' | 'changes' | 'quality';
export const DATASETS: Dataset[] = ['campaign', 'conversions', 'geo', 'device', 'product', 'changes', 'quality'];

// 'changes' is not a daily fact table: it accumulates through
// publish_change_events (upsert) and is never range-replaced.
export const FACT_TABLE: Record<Dataset, string> = {
  campaign: 'ads_campaign_daily',
  conversions: 'ads_conversions_daily',
  geo: 'ads_geo_daily',
  device: 'ads_device_daily',
  product: 'ads_product_daily',
  changes: 'ads_change_events',
  quality: 'ads_keyword_quality_daily',
};

const COUNTRY_BY_CRITERION: Record<string, string> = {
  '2528': 'NL', '2056': 'BE', '2276': 'DE', '2442': 'LU', '2250': 'FR', '2826': 'GB', '2040': 'AT', '2756': 'CH',
};
export const countryCode = (criterionId: string): string => COUNTRY_BY_CRITERION[criterionId] || 'Other';

const DEVICE_NAMES: Record<string, string> = {
  '2': 'MOBILE', '3': 'TABLET', '4': 'DESKTOP', '5': 'OTHER', '6': 'CONNECTED_TV',
  MOBILE: 'MOBILE', TABLET: 'TABLET', DESKTOP: 'DESKTOP', OTHER: 'OTHER', CONNECTED_TV: 'CONNECTED_TV',
};
const CHANNEL_NAMES: Record<string, string> = {
  '2': 'SEARCH', '3': 'DISPLAY', '4': 'SHOPPING', '6': 'VIDEO', '10': 'PERFORMANCE_MAX', '12': 'DISCOVERY', '14': 'DEMAND_GEN',
};
const STATUS_NAMES: Record<string, string> = { '2': 'ENABLED', '3': 'PAUSED', '4': 'REMOVED' };
const enumName = (table: Record<string, string>, value: unknown) => {
  const key = String(value ?? '');
  return table[key] || key;
};

const dateClause = (start: string, end: string) => `segments.date BETWEEN '${start}' AND '${end}'`;

// --- campaign state (every campaign incl. removed, no date range) -------------

export interface CampaignDimRow {
  campaign_id: string; campaign_name: string; channel_type: string; status: string; bidding_strategy_type: string;
  target_roas: number | null; target_cpa: number | null; budget_amount: number | null;
  network: string; category: string; bucket: string; parsed: boolean;
}

export async function fetchCampaignDim(customer: Customer, label: string): Promise<CampaignDimRow[]> {
  const rows = await queryWithRetry(() => customer.query(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
      campaign.bidding_strategy_type, campaign.maximize_conversion_value.target_roas,
      campaign.target_roas.target_roas, campaign.maximize_conversions.target_cpa_micros,
      campaign.target_cpa.target_cpa_micros, campaign_budget.amount_micros
    FROM campaign
  `), `${label} campaign state`);
  // Removed campaigns stay in: their history keeps a name,
  // category and the REMOVED status, so the status filter can show or hide them.
  return rows.map((row: any) => {
    const channel = enumName(CHANNEL_NAMES, row.campaign.advertising_channel_type);
    const classification = classifyCampaign(row.campaign.name, channel);
    const tRoas = row.campaign.maximize_conversion_value?.target_roas || row.campaign.target_roas?.target_roas || null;
    const tCpaMicros = row.campaign.maximize_conversions?.target_cpa_micros || row.campaign.target_cpa?.target_cpa_micros || null;
    return {
      campaign_id: String(row.campaign.id),
      campaign_name: row.campaign.name,
      channel_type: channel,
      status: enumName(STATUS_NAMES, row.campaign.status),
      bidding_strategy_type: enumName(BIDDING_NAMES, row.campaign.bidding_strategy_type),
      target_roas: tRoas ? num(tRoas) : null,
      target_cpa: tCpaMicros ? micros(tCpaMicros) : null,
      budget_amount: row.campaign_budget?.amount_micros ? micros(row.campaign_budget.amount_micros) : null,
      ...classification,
    };
  });
}

// --- daily fact datasets -------------------------------------------------------

export async function fetchCampaignDaily(customer: Customer, label: string, start: string, end: string) {
  const rows = await queryWithRetry(() => customer.query(`
    SELECT campaign.id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value,
      metrics.search_impression_share, metrics.search_budget_lost_impression_share,
      metrics.search_rank_lost_impression_share, metrics.top_impression_percentage,
      metrics.absolute_top_impression_percentage
    FROM campaign
    WHERE ${dateClause(start, end)} AND metrics.impressions > 0
  `), `${label} campaign ${start}..${end}`);
  const share = (v: unknown) => (v === null || v === undefined ? null : num(v));
  return rows.map((row: any) => ({
    fact_date: row.segments.date,
    campaign_id: String(row.campaign.id),
    impressions: num(row.metrics.impressions),
    clicks: num(row.metrics.clicks),
    cost: micros(row.metrics.cost_micros),
    conversions: num(row.metrics.conversions),
    conversions_value: num(row.metrics.conversions_value),
    all_conversions: num(row.metrics.all_conversions),
    all_conversions_value: num(row.metrics.all_conversions_value),
    search_impression_share: share(row.metrics.search_impression_share),
    search_budget_lost_is: share(row.metrics.search_budget_lost_impression_share),
    search_rank_lost_is: share(row.metrics.search_rank_lost_impression_share),
    top_impression_pct: share(row.metrics.top_impression_percentage),
    abs_top_impression_pct: share(row.metrics.absolute_top_impression_percentage),
  }));
}

export async function fetchConversionsDaily(customer: Customer, label: string, start: string, end: string) {
  const rows = await queryWithRetry(() => customer.query(`
    SELECT campaign.id, segments.date, segments.conversion_action, segments.conversion_action_name,
      metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value
    FROM campaign
    WHERE ${dateClause(start, end)} AND metrics.all_conversions > 0
  `), `${label} conversions ${start}..${end}`);
  return rows.map((row: any) => ({
    fact_date: row.segments.date,
    campaign_id: String(row.campaign.id),
    conversion_action_id: resourceId(row.segments.conversion_action),
    conversion_action_name: row.segments.conversion_action_name || '',
    conversions: num(row.metrics.conversions),
    conversions_value: num(row.metrics.conversions_value),
    all_conversions: num(row.metrics.all_conversions),
    all_conversions_value: num(row.metrics.all_conversions_value),
  }));
}

export async function fetchGeoDaily(customer: Customer, label: string, start: string, end: string) {
  const rows = await queryWithRetry(() => customer.query(`
    SELECT campaign.id, segments.date, geographic_view.country_criterion_id,
      metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
    FROM geographic_view
    WHERE ${dateClause(start, end)} AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'
      AND metrics.impressions > 0
  `), `${label} geo ${start}..${end}`);
  // The view is keyed by country; several rows per campaign/date can appear
  // (one per geo target constant). Sum them on the country.
  const merged = new Map<string, any>();
  for (const row of rows as any[]) {
    const criterion = String(row.geographic_view.country_criterion_id || '0');
    const key = `${row.segments.date}|${row.campaign.id}|${criterion}`;
    const current = merged.get(key) || {
      fact_date: row.segments.date, campaign_id: String(row.campaign.id), country_criterion_id: criterion,
      country_code: countryCode(criterion), impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0,
    };
    current.impressions += num(row.metrics.impressions);
    current.clicks += num(row.metrics.clicks);
    current.cost += micros(row.metrics.cost_micros);
    current.conversions += num(row.metrics.conversions);
    current.conversions_value += num(row.metrics.conversions_value);
    merged.set(key, current);
  }
  return [...merged.values()];
}

export async function fetchDeviceDaily(customer: Customer, label: string, start: string, end: string) {
  const rows = await queryWithRetry(() => customer.query(`
    SELECT campaign.id, segments.date, segments.device,
      metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE ${dateClause(start, end)} AND metrics.impressions > 0
  `), `${label} device ${start}..${end}`);
  return rows.map((row: any) => ({
    fact_date: row.segments.date,
    campaign_id: String(row.campaign.id),
    device: enumName(DEVICE_NAMES, row.segments.device),
    impressions: num(row.metrics.impressions),
    clicks: num(row.metrics.clicks),
    cost: micros(row.metrics.cost_micros),
    conversions: num(row.metrics.conversions),
    conversions_value: num(row.metrics.conversions_value),
  }));
}

const productFields = `
  campaign.id, segments.product_item_id, segments.product_title, segments.product_type_l1,
  segments.product_type_l2, segments.product_type_l3, segments.product_brand,
  segments.product_custom_attribute0, segments.product_custom_attribute1, segments.product_custom_attribute2,
  segments.product_custom_attribute3, segments.product_custom_attribute4, segments.product_country,
  metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value`;

const mapProduct = (row: any) => ({
  campaign_id: String(row.campaign.id),
  product_item_id: String(row.segments.product_item_id || ''),
  product_title: row.segments.product_title || '',
  product_type: [row.segments.product_type_l1, row.segments.product_type_l2, row.segments.product_type_l3]
    .filter(Boolean).join(' > '),
  brand: row.segments.product_brand || '',
  custom_label_0: row.segments.product_custom_attribute0 || '',
  custom_label_1: row.segments.product_custom_attribute1 || '',
  custom_label_2: row.segments.product_custom_attribute2 || '',
  custom_label_3: row.segments.product_custom_attribute3 || '',
  custom_label_4: row.segments.product_custom_attribute4 || '',
  country_code: countryCode(resourceId(row.segments.product_country)),
  impressions: num(row.metrics.impressions),
  clicks: num(row.metrics.clicks),
  cost: micros(row.metrics.cost_micros),
  conversions: num(row.metrics.conversions),
  conversions_value: num(row.metrics.conversions_value),
});

// Google returns one row per distinct attribute combination: when a title,
// product type or custom label changes inside the period the same product
// appears twice. The fact tables are keyed on product and country only, so
// rows are merged on that key; metrics are summed and the attributes of the
// last row win.
type ProductRow = ReturnType<typeof mapProduct>;
const METRIC_KEYS = ['impressions', 'clicks', 'cost', 'conversions', 'conversions_value'] as const;

function mergeProducts<T extends ProductRow & Record<string, unknown>>(rows: T[], periodKey: 'fact_date' | 'fact_month'): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    const key = `${row[periodKey]}|${row.campaign_id}|${row.product_item_id}|${row.country_code}`;
    const current = merged.get(key);
    if (!current) { merged.set(key, { ...row }); continue; }
    const next = { ...current, ...row } as T;
    for (const metric of METRIC_KEYS) (next as any)[metric] = Number(current[metric]) + Number(row[metric]);
    merged.set(key, next);
  }
  return [...merged.values()];
}

export async function fetchProductDaily(customer: Customer, label: string, start: string, end: string) {
  const rows = await queryWithRetry(() => customer.query(`
    SELECT segments.date, ${productFields}
    FROM shopping_performance_view
    WHERE ${dateClause(start, end)} AND metrics.impressions > 0
  `), `${label} product ${start}..${end}`);
  return mergeProducts(rows.map((row: any) => ({ fact_date: row.segments.date as string, ...mapProduct(row) })), 'fact_date');
}

// --- account change history ----------------------------------------------------

// change_event reaches back 30 days and demands a LIMIT; the window is clamped
// so a backfill request older than that still returns what Google has.
export async function fetchChangeEvents(customer: Customer, label: string, start: string, end: string): Promise<ChangeEventRow[]> {
  const window = clampChangeWindow(start, end);
  if (!window) return [];
  const rows = await queryWithRetry(() => customer.query(`
    SELECT change_event.change_date_time, change_event.change_resource_type, change_event.change_resource_name,
      change_event.resource_change_operation, change_event.changed_fields, change_event.client_type,
      change_event.user_email, change_event.old_resource, change_event.new_resource, campaign.id, campaign.name
    FROM change_event
    WHERE change_event.change_date_time >= '${window.start} 00:00:00'
      AND change_event.change_date_time <= '${window.end} 23:59:59'
    ORDER BY change_event.change_date_time
    LIMIT ${CHANGE_EVENT_LIMIT}
  `), `${label} changes ${window.start}..${window.end}`);
  if (rows.length >= CHANGE_EVENT_LIMIT) {
    console.warn(`${label} changes ${window.start}..${window.end}: hit the ${CHANGE_EVENT_LIMIT} row limit, split the window`);
  }
  const mapped: ChangeEventRow[] = [];
  for (const row of rows as any[]) {
    const event = mapChangeEvent(row);
    if (event) mapped.push(event);
  }
  return dedupeChangeEvents(mapped);
}

export async function fetchProductMonthly(customer: Customer, label: string, start: string, end: string) {
  const rows = await queryWithRetry(() => customer.query(`
    SELECT segments.month, ${productFields}
    FROM shopping_performance_view
    WHERE ${dateClause(start, end)} AND metrics.impressions > 0
  `), `${label} product monthly ${start}..${end}`);
  return mergeProducts(rows.map((row: any) => ({ fact_month: row.segments.month as string, ...mapProduct(row) })), 'fact_month');
}
