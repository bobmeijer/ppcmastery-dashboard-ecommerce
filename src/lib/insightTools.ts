// Read-only data tools for the AI analysis agent.
// Every tool is scoped to the one account and the view's filters, returns compact text
// with numbers already formatted (en-GB) so the model copies them instead of computing,
// and never exposes the admin-only layer to `client` (change history, tROAS).
import { moduleEnabled } from '@/lib/config';
import type { ModuleKey } from '../../dashboard.config';
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { addDays, daysBetween, fmtCount, fmtCurrency, fmtNumber, fmtRatio, groupBy, type Derived, type Totals } from './metrics';
import { applyFilters, displayNetwork, type FilterState } from './filters';
import { readDeviceFacts } from './reports-devices';
import { readGeoFacts } from './reports-geo';
import { readProductFacts } from './reports-products';
import { readFeedSnapshot } from './reports-feed';
import { readAuctionInsights } from './reports-auction';
import { readChangeEvents } from './reports-changes';
import { assertOk, getSupabaseAdmin } from './supabaseAdmin';
import { readCampaignFacts, readDataCoverage } from './reports';
import { toRow, type QualityTuple } from './qualityShaping';
import type { Platform } from './platform';
import type { Account } from './accounts';

export interface ToolContext {
  account: Account;
  filters: FilterState;
  isAdmin: boolean;
  platform: Platform;   // one platform per view (platform.ts); feed and auction insights are Google only
  maturedEnd: string;   // last day whose revenue is complete (outside lag_days)
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EARLIEST = '2024-01-01';

const pct2 = (v: number | null) => (v === null ? '-' : `${fmtNumber(v * 100, 2)}%`);
export const kpiLine = (d: Derived) => [
  `cost ${fmtCurrency(d.cost)}`, `revenue ${fmtCurrency(d.conversions_value)}`, `ROAS ${fmtRatio(d.roas)}`, `conversions ${fmtCount(d.conversions)}`,
  `order value ${fmtCurrency(d.aov)}`, `clicks ${fmtNumber(d.clicks)}`, `CPC ${fmtCurrency(d.cpc, 2)}`, `CVR ${pct2(d.cvr)}`,
  `CTR ${pct2(d.ctr)}`, `impressions ${fmtNumber(d.impressions)}`,
  ...(d.eligible_impressions > 0 ? [`IS ${pct2(d.impression_share)}`, `IS lost to budget ${pct2(d.budget_lost_is)}`, `IS lost to rank ${pct2(d.rank_lost_is)}`] : []),
].join(' | ');

const weekStart = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

function lagNote(ctx: ToolContext, end: string) {
  return end > ctx.maturedEnd ? `\nNote: revenue after ${ctx.maturedEnd} has not matured yet (conversion lag ${ctx.account.lag_days} days), so it is incomplete.` : '';
}

function checkRange(input: { start?: unknown; end?: unknown }) {
  const start = String(input.start ?? ''), end = String(input.end ?? '');
  if (!DATE.test(start) || !DATE.test(end) || start > end) throw new Error('start and end must be YYYY-MM-DD, start <= end');
  if (start < EARLIEST) throw new Error(`data starts on ${EARLIEST}`);
  if (daysBetween(start, end) > 400) throw new Error('at most 400 days per request');
  return { start, end };
}

const campaign = { type: ['string', 'null'], description: 'Optional: (part of) a campaign name, such as "Stoves" or "Parasols"; only campaigns whose name contains it. null = all campaigns' } as const;
const range = { start: { type: 'string', description: 'YYYY-MM-DD' }, end: { type: 'string', description: 'YYYY-MM-DD' } } as const;
const network = { type: ['string', 'null'], description: 'Optional: a network such as "Branded Search", "Non-Branded Search", "Branded Shopping", "Non-Branded Shopping" (including Performance Max); null = everything' } as const;

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): Anthropic.Tool {
  return { name, description, strict: true, input_schema: { type: 'object', properties, required, additionalProperties: false } as Anthropic.Tool.InputSchema };
}

const TOOL_MODULE: Record<string, ModuleKey> = { feed_status: 'feedStatus', quality_scores: 'qualityScore', auction_insights: 'auctionInsights', change_history: 'changeHistory', communication: 'communications' };

const GOOGLE_ONLY_TOOLS = new Set(['feed_status', 'auction_insights', 'change_history']);

export function toolDefinitions(isAdmin: boolean, platform: Platform = 'google'): Anthropic.Tool[] {
  const tools = [
    tool('campaign_data', 'Key figures from the campaign data, grouped. Use group_by week or day to see when a change began, network or campaign to see where it sits. Any date from 2024-01-01, so also last year for seasonality.',
      { ...range, group_by: { type: 'string', enum: ['total', 'network', 'campaign', 'week', 'day'] }, network, campaign }, ['start', 'end', 'group_by', 'network', 'campaign']),
    tool('device_data', 'Key figures per device (mobile, desktop, tablet, TV).', { ...range, network, campaign }, ['start', 'end', 'network', 'campaign']),
    tool('country_data', 'Key figures per user country.', { ...range, network, campaign }, ['start', 'end', 'network', 'campaign']),
    tool('product_movers', 'Products (Shopping and Performance Max) with the largest revenue shift between two periods, plus products with cost but no revenue. Daily product data exists from 2026-01-01. Only the product part of Performance Max is visible.',
      { ...range, compare_start: { type: 'string' }, compare_end: { type: 'string' }, network, campaign, limit: { type: 'integer', description: '1-15' } }, ['start', 'end', 'compare_start', 'compare_end', 'network', 'campaign', 'limit']),
    tool('feed_status', 'Current Merchant Center status: eligible and blocked products, main issues and the history of the last 60 days.', {}, []),
    tool('quality_scores', 'Quality Score of keywords with impressions, weighted per campaign, with the share of keywords where a component is below average.', { ...range }, ['start', 'end']),
    tool('auction_insights', 'Auction insights: competitors with impression share, overlap and outranking. Only available for days with reports.',
      { ...range, network: { type: 'string', enum: ['Search', 'Shopping'] } }, ['start', 'end', 'network']),
  ];
  tools.push(
    tool('account_context', "Findings from this account's audits, the standing notes and the account manager's daily notes, as far as they cover this period. This is the source for the why: causes, outages, settings changes and agreements. Name the source and date when you use a finding.", { ...range }, ['start', 'end']),
    tool('communication', 'Meetings and emails between the account manager and the client in this period (summary, decisions) and the action items with their status. Use this to see what was agreed or done around a change.', { ...range }, ['start', 'end']),
  );
  if (isAdmin) {
    tools.push(tool('change_history', 'Changes in the Google Ads account (the account manager only): count per day and campaign and the main changes. Reaches about 30 days back from the first sync.', { ...range }, ['start', 'end']));
  }
  // A Microsoft Ads view has no Merchant feed, auction insights or Google change history.
  const enabled = tools.filter(t => !TOOL_MODULE[t.name] || moduleEnabled(TOOL_MODULE[t.name]));
  return platform === 'google' ? enabled : enabled.filter(t => !GOOGLE_ONLY_TOOLS.has(t.name));
}

type Input = Record<string, unknown>;
// Network and campaign arguments of a tool call, on top of the view filters.
const netFilter = <T extends { network: string; category: string; campaign_name?: string }>(rows: T[], net: unknown, campaign?: unknown) => {
  const name = typeof campaign === 'string' && campaign.trim() ? campaign.trim().toLowerCase() : null;
  return rows.filter(r => (!net || displayNetwork(r) === net) && (!name || (r.campaign_name ?? '').toLowerCase().includes(name)));
};

const EXECUTORS: Record<string, (ctx: ToolContext, input: Input) => Promise<string>> = {
  async campaign_data(ctx, input) {
    const { start, end } = checkRange(input);
    const rows = netFilter(applyFilters(await readCampaignFacts([ctx.account.id], start, end, 'day', [ctx.platform]), ctx.filters), input.network, input.campaign);
    const key = { total: () => 'Total', network: displayNetwork, campaign: (r: { campaign_name: string }) => r.campaign_name, week: (r: { period: string }) => `week of ${weekStart(r.period)}`, day: (r: { period: string }) => r.period }[String(input.group_by) as 'total'];
    const groups = [...groupBy(rows, key as (r: typeof rows[number]) => string)].sort(([a, x], [b, y]) => (input.group_by === 'week' || input.group_by === 'day' ? a.localeCompare(b) : y.cost - x.cost));
    const body = `${start} to ${end}${input.network ? `, ${input.network}` : ''}${input.campaign ? `, campaigns containing "${input.campaign}"` : ''}\n${groups.map(([k, d]) => `${k}: ${kpiLine(d)}`).join('\n') || 'No data.'}${lagNote(ctx, end)}`;
    // A range that runs past the matured date also gets the matured part, so revenue and
    // ROAS questions have a complete figure instead of a total with unmatured days in it.
    if (end <= ctx.maturedEnd || start > ctx.maturedEnd || input.group_by === 'week' || input.group_by === 'day') return body;
    const matured = [...groupBy(rows.filter(r => r.period <= ctx.maturedEnd), key as (r: typeof rows[number]) => string)].sort(([, x], [, y]) => y.cost - x.cost);
    return `${body}\nRevenue, ROAS and conversions above include unmatured days; use the matured part for those.\nMatured part ${start} to ${ctx.maturedEnd}:\n${matured.map(([k, d]) => `${k}: ${kpiLine(d)}`).join('\n') || 'No data.'}`;
  },
  async device_data(ctx, input) {
    const { start, end } = checkRange(input);
    const rows = netFilter(applyFilters(await readDeviceFacts([ctx.account.id], start, end, 'month', [ctx.platform]), ctx.filters), input.network, input.campaign);
    return `${start} to ${end}\n${[...groupBy(rows, r => r.device)].map(([k, d]) => `${k}: ${kpiLine(d)}`).join('\n') || 'No data.'}${lagNote(ctx, end)}`;
  },
  async country_data(ctx, input) {
    const { start, end } = checkRange(input);
    const rows = netFilter(applyFilters(await readGeoFacts([ctx.account.id], start, end, 'month', [ctx.platform]), ctx.filters), input.network, input.campaign);
    return `${start} to ${end}\n${[...groupBy(rows, r => r.country_code)].sort(([, a], [, b]) => b.cost - a.cost).map(([k, d]) => `${k}: ${kpiLine(d)}`).join('\n') || 'No data.'}${lagNote(ctx, end)}`;
  },
  async product_movers(ctx, input) {
    const cur = checkRange(input);
    const cmp = checkRange({ start: input.compare_start, end: input.compare_end });
    const limit = Math.min(15, Math.max(1, Number(input.limit) || 8));
    const [a, b] = await Promise.all([readProductFacts([ctx.account.id], cur.start, cur.end, [ctx.platform]), readProductFacts([ctx.account.id], cmp.start, cmp.end, [ctx.platform])]);
    const name = (r: { product_item_id: string; product_title: string | null }) => `${r.product_item_id} ${(r.product_title ?? '').slice(0, 50)}`.trim();
    // Product facts can carry numeric strings; addRow converts them with Number().
    type Numeric = (typeof a)[number] & Partial<Totals>;
    const ga = groupBy(netFilter(applyFilters(a, ctx.filters), input.network, input.campaign) as Numeric[], name);
    const gb = groupBy(netFilter(applyFilters(b, ctx.filters), input.network, input.campaign) as Numeric[], name);
    const all = [...new Set([...ga.keys(), ...gb.keys()])].map(k => ({ k, now: ga.get(k), was: gb.get(k) }));
    const delta = (x: (typeof all)[number]) => (x.now?.conversions_value ?? 0) - (x.was?.conversions_value ?? 0);
    const line = (x: (typeof all)[number]) => `${x.k}: revenue ${fmtCurrency(x.was?.conversions_value ?? 0)} to ${fmtCurrency(x.now?.conversions_value ?? 0)}, cost ${fmtCurrency(x.was?.cost ?? 0)} to ${fmtCurrency(x.now?.cost ?? 0)}`;
    const total = (g: Map<string, Derived>) => fmtCurrency([...g.values()].reduce((s, d) => s + d.conversions_value, 0));
    const noRevenue = all.filter(x => (x.now?.cost ?? 0) > 0 && (x.now?.conversions_value ?? 0) === 0).sort((x, y) => (y.now?.cost ?? 0) - (x.now?.cost ?? 0)).slice(0, 5);
    return [`Product revenue ${cmp.start} to ${cmp.end}: ${total(gb)}; ${cur.start} to ${cur.end}: ${total(ga)}`,
      'Biggest fallers:', ...[...all].sort((x, y) => delta(x) - delta(y)).slice(0, limit).filter(x => delta(x) < 0).map(line),
      'Biggest risers:', ...[...all].sort((x, y) => delta(y) - delta(x)).slice(0, Math.ceil(limit / 2)).filter(x => delta(x) > 0).map(line),
      'Cost without revenue (current period):', ...noRevenue.map(x => `${x.k}: cost ${fmtCurrency(x.now?.cost ?? 0)}`)].join('\n') + lagNote(ctx, cur.end);
  },
  async feed_status(ctx) {
    const s = await readFeedSnapshot(ctx.account);
    if (!s) return 'No Merchant Center feed for this account.';
    const history = s.history.filter(h => h.date >= addDays(s.snapshotDate, -60));
    return [`As of ${s.snapshotDate}: ${fmtNumber(s.totals.itemsInFeed)} products in the feed, ${fmtNumber(s.totals.eligible)} eligible, ${fmtNumber(s.totals.blocked)} blocked, ${fmtNumber(s.totals.pending)} pending.`,
      'Main issues:', ...s.issues.slice(0, 8).map(i => `${JSON.stringify(i)}`),
      'History (date: eligible / blocked):', ...history.map(h => `${h.date}: ${fmtNumber(h.eligible)} / ${fmtNumber(h.blocked)}`)].join('\n');
  },
  async quality_scores(ctx, input) {
    const { start, end } = checkRange(input);
    const { data, error } = await getSupabaseAdmin().rpc('read_keyword_quality_json', { p_account_ids: [ctx.account.id], p_start_date: start, p_end_date: end, p_platforms: [ctx.platform] });
    assertOk(error, 'Unable to read keyword quality');
    const rows = applyFilters(((data || []) as QualityTuple[]).map(toRow).map(r => ({ ...r, campaign_id: r.campaign_id })), ctx.filters).filter(r => r.qs !== null && r.impressions > 0);
    const byCampaign = new Map<string, typeof rows>();
    for (const r of rows) byCampaign.set(r.campaign_name, [...(byCampaign.get(r.campaign_name) ?? []), r]);
    // Google's component buckets: 2 below average, 3 average, 4 above (qualityShaping.ts).
    const below = (list: typeof rows, key: 'expected_ctr' | 'ad_relevance' | 'landing_page') => fmtNumber((list.filter(r => r[key] === 2).length / list.length) * 100, 0);
    return `${start} to ${end}\n${[...byCampaign].map(([name, list]) => {
      const imp = list.reduce((s, r) => s + r.impressions, 0);
      const qs = list.reduce((s, r) => s + (r.qs ?? 0) * r.impressions, 0) / (imp || 1);
      return `${name}: weighted QS ${fmtNumber(qs, 1)} across ${fmtNumber(new Set(list.map(r => r.criterion_id)).size)} keywords; below average: expected CTR ${below(list, 'expected_ctr')}%, relevance ${below(list, 'ad_relevance')}%, landing page ${below(list, 'landing_page')}%`;
    }).join('\n') || 'No Quality Score data.'}`;
  },
  async auction_insights(ctx, input) {
    const { start, end } = checkRange(input);
    const rows = await readAuctionInsights([ctx.account.id], start, end, 'all', input.network === 'Shopping' ? 'Shopping' : 'Search', null);
    if (rows.length === 0) return 'No auction insights for this period.';
    return `${start} to ${end}, ${input.network}\n${rows.slice(0, 12).map(r => `${r.competitor}: impression share ${r.is_capped ? '< 10%' : pct2(r.impression_share)}, overlap ${pct2(r.overlap_rate)}, position above ${pct2(r.position_above_rate)}, outranking ${pct2(r.outranking_share)}`).join('\n')}`;
  },
  async account_context(ctx, input) {
    const { start, end } = checkRange(input);
    const { data, error } = await getSupabaseAdmin().rpc('read_context_findings_json', { p_label: ctx.account.label, p_start: start, p_end: end, p_include_private: ctx.isAdmin });
    assertOk(error, 'Unable to read context findings');
    const rows = (data || []) as { kind: string; source: string; run_date: string; window_start: string | null; window_end: string | null; claim: string; evidence: string; severity: string }[];
    if (rows.length === 0) return 'No audit findings or notes for this period.';
    return rows.map(r => `[${r.source}, ${r.run_date}${r.window_start ? `, covering ${r.window_start} to ${r.window_end ?? r.run_date}` : ''}, ${r.severity}] ${r.claim}${r.evidence ? ` Evidence: ${r.evidence}` : ''}`).join('\n');
  },
  async communication(ctx, input) {
    const { start, end } = checkRange(input);
    const { data, error } = await getSupabaseAdmin().rpc('read_communications_json', { p_label: ctx.account.label, p_include_hidden: ctx.isAdmin });
    assertOk(error, 'Unable to read communications');
    const body = (data || { items: [], actions: [] }) as { items: { id: string; kind: string; title: string; date: string; summary_md: string; decisions: string[]; labels: string[] }[]; actions: { source_id: string; title: string; owner: string; status: string; created: string; due: string | null }[] };
    const items = body.items.filter(i => i.date >= start && i.date <= end && (i.labels.length === 0 || i.labels.includes(ctx.account.label)));
    const ids = new Set(items.map(i => i.id));
    const actions = body.actions.filter(a => ids.has(a.source_id));
    if (items.length === 0) return 'No meetings or email in this period.';
    return [...items.map(i => `${i.date} ${i.kind === 'meeting' ? 'meeting' : 'email'} "${i.title}": ${i.summary_md}${i.decisions.length ? ` Decisions: ${i.decisions.join('; ')}` : ''}`),
      ...(actions.length ? ['Action items:', ...actions.map(a => `${a.title} (${a.owner}, ${a.status}${a.due ? `, deadline ${a.due}` : ''})`)] : [])].join('\n');
  },
  async change_history(ctx, input) {
    if (!ctx.isAdmin) throw new Error('not available');
    const { start, end } = checkRange(input);
    const rows = await readChangeEvents([ctx.account.id], start, end);
    if (rows.length === 0) return `No changes recorded between ${start} and ${end}.`;
    const perDay = groupCount(rows.map(r => `${r.change_date} ${r.campaign_name ?? 'account'}`));
    const notable = rows.filter(r => !/negati/i.test(r.summary)).slice(0, 25);
    return [`${fmtNumber(rows.length)} changes ${start} to ${end}. Per day and campaign:`, ...perDay.slice(0, 30).map(([k, n]) => `${k}: ${fmtNumber(n)}`),
      'Changes other than negative keywords:', ...notable.map(r => `${r.change_date} ${r.campaign_name ?? ''}: ${r.summary}`)].join('\n');
  },
};

function groupCount(keys: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}

export const TOOL_STEP: Record<string, string> = {
  campaign_data: 'Checking campaigns', device_data: 'Checking devices', country_data: 'Checking countries', product_movers: 'Checking products',
  feed_status: 'Checking the feed', quality_scores: 'Checking Quality Score', auction_insights: 'Checking Auction insights', change_history: 'Checking changes',
  account_context: 'Reading audits and notes', communication: 'Reading meetings and email',
};

// Which dataset each tool reads, so its answer can say where the data starts: missing
// data is not evidence (change history may start late for an account).
const DATASET: Record<string, string> = { product_movers: 'product', quality_scores: 'quality', auction_insights: 'auction', change_history: 'changes' };
let coverage: { at: number; rows: Awaited<ReturnType<typeof readDataCoverage>> } | null = null;

async function coverageNote(ctx: ToolContext, name: string) {
  const dataset = DATASET[name];
  if (!dataset) return '';
  if (!coverage || Date.now() - coverage.at > 600_000) coverage = { at: Date.now(), rows: await readDataCoverage() };
  const row = coverage.rows.find(c => c.dataset === dataset && c.account_id === ctx.account.id);
  return row?.first_date ? `Data for this tool is available from ${row.first_date} to ${row.last_date}. Nothing is known about earlier days.\n` : 'No data is available for this tool yet.\n';
}

export async function runTool(ctx: ToolContext, name: string, input: Input): Promise<{ text: string; isError: boolean }> {
  const exec = EXECUTORS[name];
  if (!exec || (name === 'change_history' && !ctx.isAdmin) || (ctx.platform !== 'google' && GOOGLE_ONLY_TOOLS.has(name))) return { text: `Unknown tool ${name}`, isError: true };
  try {
    return { text: (await coverageNote(ctx, name)) + (await exec(ctx, input)), isError: false };
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true };
  }
}
