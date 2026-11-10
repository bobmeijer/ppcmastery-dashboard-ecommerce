import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BRAND } from '../config';
import { addDays } from './dates';
import * as reads from './reads';
import { replayStories } from './replay';
import { DemoWorld, DEMO_SEED, HISTORY_DAYS } from './world';

// Stands in for the Supabase client in demo mode. Reads come from the generator, writes
// stay in memory and are gone after a restart. Nothing here touches the network.

// The goals the demo gauges and AI text agree on.
const DEMO_GOALS: Record<string, { revenuePerMonth: number; roas: number }> = {
  shopa: { revenuePerMonth: 175000, roas: 5.5 },
  shopb: { revenuePerMonth: 52000, roas: 4.5 },
};

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null; count: number | null };

export const demoInsightKey = (accountId: string, role: string) => createHash('sha256').update(JSON.stringify(['demo-replay', accountId, role])).digest('hex');

class Store {
  world: DemoWorld;
  tables: Record<string, Row[]> = {};
  spend = new Map<string, number>();

  constructor(world: DemoWorld) {
    this.world = world;
    const { accounts, campaigns } = world;
    const { items, actions } = reads.buildCommunications(world);
    this.tables = {
      accounts: accounts.map(a => world.accountRow(a)),
      campaign_dim: campaigns.map(c => ({ account_id: c.account_id, campaign_id: c.campaign_id, campaign_name: c.campaign_name, channel_type: c.channel_type, status: c.status, network: c.network, category: c.category, bucket: c.bucket, platform: c.platform, parsed: c.parsed, overridden: false, target_roas: c.target_roas, target_cpa: c.target_cpa })),
      targets: this.targets(),
      product_type_exclusions: accounts.map(a => ({ account_id: a.id, type_level1: 'outlet' })),
      users: [
        { id: 'demo-admin', email: 'demo@example.com', name: 'Demo viewer', role: 'admin', created_at: '2024-02-01T09:00:00.000Z', last_login: `${world.today}T07:45:00.000Z`, session_version: 1, password_hash: '' },
        { id: 'demo-client', email: 'client@example.com', name: `${BRAND.client} reader`, role: 'client', created_at: '2024-03-12T09:00:00.000Z', last_login: addDays(world.today, -2) + 'T09:12:00.000Z', session_version: 1, password_hash: '' },
      ],
      communications: items,
      actions,
      context_findings: [{ account_label: null, hidden: false, synced_at: `${world.today}T04:00:00.000Z` }],
      chat_messages: [], login_attempts: [], sync_runs: [], oauth_tokens: [],
      ai_spend: [],
      ai_insights: this.seedInsights(),
      ads_campaign_daily: this.dateIndex(['google', 'microsoft']),
      ads_geo_daily: this.dateIndex(['google', 'microsoft']),
      ads_product_daily: this.dateIndex(['google', 'microsoft']),
      ads_product_monthly: [],
    };
  }

  private targets(): Row[] {
    const { accounts } = this.world;
    const values = [[50, 700], [36, 340]];
    return accounts.flatMap((a, i) => {
      const [cpa, purchases] = values[a.profile] ?? values[0];
      const goals = DEMO_GOALS[a.label];
      return [
        // Same goals as the dashboard shows, so the AI text and the gauges agree.
        ...(goals ? [{ metric: 'roas', value: goals.roas, kind: 'floor' }, { metric: 'revenue_per_month', value: goals.revenuePerMonth, kind: 'target' }] : []),
        { metric: 'cpa', value: cpa, kind: 'max' }, { metric: 'purchases_per_month', value: purchases, kind: 'target' },
      ].map((t, j) => ({ id: i * 10 + j + 1, account_id: a.id, ...t, phase: 'Peak season', valid_from: '2024-01-01', valid_to: null, note: null }));
    });
  }

  private dateIndex(platforms: string[]): Row[] {
    const rows: Row[] = [];
    for (const a of this.world.accounts) {
      for (const platform of platforms) {
        const length = platform === 'google' ? HISTORY_DAYS : 240;
        for (let age = 1; age <= length; age += 1) rows.push({ account_id: a.id, platform, fact_date: addDays(this.world.today, -age) });
      }
    }
    return rows;
  }

  private seedInsights(): Row[] {
    const stories = replayStories(this.world);
    return this.world.accounts.flatMap(a => (['admin', 'client'] as const).flatMap(role => {
      const entry = stories[a.label];
      if (!entry) return [];
      return [{ key: demoInsightKey(a.id, role), account_label: a.label, role, view: {}, story: entry.story, edited_story: null, status: 'auto', source: 'demo', model: entry.model, generated_at: entry.generatedAt, edited_at: null, edit_note: null, cost_usd: 0 }];
    }));
  }

  rpc(name: string, args: Row): unknown {
    const world = this.world;
    switch (name) {
      case 'read_campaign_facts_json': return reads.campaignFacts(world, args);
      case 'read_conversion_roles_json': return reads.conversionRoles(world, args);
      case 'read_device_facts_json': return reads.deviceFacts(world, args);
      case 'read_geo_facts_json': return reads.geoFacts(world, args);
      case 'read_product_facts_json': return reads.productFacts(world, args);
      case 'read_product_daily_json': return reads.productDaily(world, args);
      case 'read_product_label_days_json': return reads.productLabelDays(world, args);
      case 'read_keyword_quality_json': return reads.keywordQuality(world, args);
      case 'read_feed_products_json': return reads.feedProducts(world, args);
      case 'read_feed_daily_json': return reads.feedDaily(world, args);
      case 'read_change_events_json': return reads.changeEvents(world, args);
      case 'read_auction_insights_json': return reads.auctionInsights(world, args);
      case 'read_auction_categories_json': return reads.auctionCategories(world, args);
      case 'read_auction_coverage_json': return reads.auctionCoverage(world, args);
      case 'read_sync_status_json': return reads.syncStatus(world);
      case 'read_data_coverage_json': return reads.dataCoverage(world);
      case 'read_context_findings_json': return reads.contextFindings(world, args);
      case 'read_communications_json': return this.communications(args);
      case 'set_action_status': return this.setActionStatus(args);
      case 'set_communication_hidden': return this.setHidden(args);
      case 'reserve_ai_spend': return this.reserve(args);
      case 'settle_ai_spend': this.spend.set(String(args.p_month), (this.spend.get(String(args.p_month)) ?? 0) + Number(args.p_delta)); return null;
      case 'bump_session_version': return null;
      default: throw new Error(`Not available in the demo: ${name}`);
    }
  }

  private communications(args: Row) {
    const hiddenOk = Boolean(args.p_include_hidden);
    const items = (this.tables.communications as (Row & { date: string; time: string; hidden: boolean; id: string })[]).filter(c => hiddenOk || !c.hidden).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    const visible = new Set(items.map(i => i.id));
    const actions = this.tables.actions.filter(a => (a.label === null || a.label === args.p_label) && visible.has(String(a.source_id)));
    return { items, actions };
  }

  private setActionStatus(args: Row) {
    const row = this.tables.actions.find(a => a.id === args.p_id);
    if (!row) return false;
    row.status = args.p_status;
    return true;
  }

  private setHidden(args: Row) {
    const row = this.tables.communications.find(c => c.id === args.p_id);
    if (!row) return false;
    row.hidden = args.p_hidden;
    return true;
  }

  private reserve(args: Row) {
    const month = String(args.p_month);
    const used = this.spend.get(month) ?? 0;
    if (used + Number(args.p_usd) > Number(args.p_cap)) return false;
    this.spend.set(month, used + Number(args.p_usd));
    return true;
  }

  spendTotal() { return [...this.spend.values()].reduce((s, v) => s + v, 0); }
}

type Filter = (row: Row) => boolean;

class Query implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private max: number | null = null;
  private window: [number, number] | null = null;
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: Row[] = [];
  private patch: Row = {};
  private conflict = 'id';
  private single_: 'single' | 'maybe' | null = null;
  private head = false;
  private counted = false;
  private columns: string | null = null;

  constructor(private store: Store, private table: string) {}

  select(columns = '*', options?: { head?: boolean; count?: string }) { this.columns = columns; this.head = !!options?.head; this.counted = !!options?.count; return this; }
  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push(r => r[c] !== v); return this; }
  in(c: string, values: unknown[]) { this.filters.push(r => values.includes(r[c])); return this; }
  gte(c: string, v: string) { this.filters.push(r => String(r[c]) >= v); return this; }
  gt(c: string, v: string) { this.filters.push(r => String(r[c]) > v); return this; }
  lte(c: string, v: string) { this.filters.push(r => String(r[c]) <= v); return this; }
  lt(c: string, v: string) { this.filters.push(r => String(r[c]) < v); return this; }
  is(c: string, v: unknown) { this.filters.push(r => (r[c] ?? null) === v); return this; }
  not(c: string, op: string, v: unknown) { if (op === 'is') this.filters.push(r => (r[c] ?? null) !== v); return this; }
  or(expression: string) {
    const parts = expression.split(',').map(p => p.split('.'));
    this.filters.push(r => parts.some(([c, op, v]) => (op === 'is' ? (r[c] ?? null) === null : String(r[c]) === v)));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) { this.orders.push({ column, ascending: options?.ascending ?? true }); return this; }
  limit(n: number) { this.max = n; return this; }
  range(from: number, to: number) { this.window = [from, to]; return this; }
  single() { this.single_ = 'single'; return this; }
  maybeSingle() { this.single_ = 'maybe'; return this; }
  insert(values: Row | Row[]) { this.mode = 'insert'; this.payload = Array.isArray(values) ? values : [values]; return this; }
  upsert(values: Row | Row[], options?: { onConflict?: string }) { this.mode = 'upsert'; this.payload = Array.isArray(values) ? values : [values]; this.conflict = options?.onConflict ?? 'id'; return this; }
  update(patch: Row) { this.mode = 'update'; this.patch = patch; return this; }
  delete() { this.mode = 'delete'; return this; }

  private rows() { return (this.store.tables[this.table] ??= []); }
  private matching() { return this.rows().filter(r => this.filters.every(f => f(r))); }

  private run(): Row[] {
    const table = this.rows();
    if (this.mode === 'insert') {
      const added = this.payload.map(v => ({ id: randomUUID(), created_at: new Date().toISOString(), ...v }));
      table.push(...added);
      return added;
    }
    if (this.mode === 'upsert') {
      return this.payload.map(v => {
        const existing = table.find(r => r[this.conflict] === v[this.conflict]);
        if (existing) return Object.assign(existing, v);
        const added = { id: randomUUID(), ...v };
        table.push(added);
        return added;
      });
    }
    if (this.mode === 'update') return this.matching().map(r => Object.assign(r, this.patch));
    if (this.mode === 'delete') {
      const gone = new Set(this.matching());
      this.store.tables[this.table] = table.filter(r => !gone.has(r));
      return [...gone];
    }
    let rows = [...this.matching()];
    for (const { column, ascending } of [...this.orders].reverse()) {
      rows.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (ascending ? 1 : -1));
    }
    return rows;
  }

  private project(row: Row): Row {
    if (!this.columns || this.columns === '*') return { ...row };
    return Object.fromEntries(this.columns.split(',').map(c => c.trim()).map(c => [c, row[c]]));
  }

  private execute(): Result {
    try {
      const matched = this.run();
      const count = this.counted ? matched.length : null;
      if (this.head) return { data: null, error: null, count };
      let rows = matched;
      if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
      if (this.max !== null) rows = rows.slice(0, this.max);
      const shaped = rows.map(r => this.project(r));
      if (this.single_ === 'single' && shaped.length !== 1) return { data: null, error: { message: 'Expected one row' }, count };
      if (this.single_) return { data: shaped[0] ?? null, error: null, count };
      return { data: shaped, error: null, count };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) }, count: null };
    }
  }

  then<A = Result, B = never>(done?: ((value: Result) => A | PromiseLike<A>) | null, failed?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.execute()).then(done, failed);
  }
}

export interface DemoClient {
  from: (table: string) => Query;
  rpc: (name: string, args?: Row) => Promise<{ data: unknown; error: { message: string } | null }>;
  store: Store;
}

export function createFakeClient(seed = DEMO_SEED, today?: string): DemoClient {
  const store = new Store(new DemoWorld(seed, today));
  return {
    store,
    from: table => new Query(store, table),
    rpc: async (name, args = {}) => {
      try {
        return { data: store.rpc(name, args), error: null };
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
      }
    },
  };
}

// One fake database per day: the demo always ends yesterday, and writes survive page changes.
const cache = globalThis as unknown as { __demoClient?: { day: string; client: DemoClient } };

export function getDemoClient(): SupabaseClient {
  const day = new Date().toISOString().slice(0, 10);
  if (cache.__demoClient?.day !== day) cache.__demoClient = { day, client: createFakeClient(DEMO_SEED, day) };
  return cache.__demoClient.client as unknown as SupabaseClient;
}


