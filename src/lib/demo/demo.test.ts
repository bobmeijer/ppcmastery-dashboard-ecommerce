import { afterEach, describe, expect, it, vi } from 'vitest';
import { moduleGate } from '../modules';
import { toRow, type QualityTuple } from '../qualityShaping';
import { createFakeClient } from './fakeClient';
import { addDays, shiftDatesInText } from './dates';
import { NO_KEY_MESSAGE, replayAnswer } from './replay';
import { DIP_START, RECOVERED, DemoWorld, FEED_END, FEED_START } from './world';

const { resolveDemoMode } = require('../../../demo-mode') as { resolveDemoMode: (env: Record<string, string | undefined>) => boolean };

const TODAY = '2026-11-10';
const period = { p_start_date: '2026-10-01', p_end_date: '2026-10-31', p_grain: 'day', p_platforms: ['google'] };
const A = '1000000001';
const B = '1000000002';
const ids = [A];

async function rpc(name: string, args: Record<string, unknown> = {}, today = TODAY) {
  const { data, error } = await createFakeClient(undefined, today).rpc(name, { p_account_ids: ids, ...period, ...args });
  expect(error).toBeNull();
  return data as Record<string, unknown>[];
}

const sum = (rows: Record<string, unknown>[], key: string) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);

describe('generator', () => {
  it('gives the same data for the same seed', async () => {
    for (const name of ['read_campaign_facts_json', 'read_product_facts_json', 'read_keyword_quality_json', 'read_auction_insights_json', 'read_change_events_json']) {
      expect(await rpc(name)).toEqual(await rpc(name));
    }
  });

  it('gives different data for a different seed', async () => {
    const other = await createFakeClient(123, TODAY).rpc('read_campaign_facts_json', { p_account_ids: ids, ...period });
    expect(other.data).not.toEqual(await rpc('read_campaign_facts_json'));
  });

  it('ends yesterday, 24 months long, whatever today is', async () => {
    const world = new DemoWorld(undefined, '2027-03-05');
    const rows = await rpc('read_campaign_facts_json', { p_start_date: '2020-01-01', p_end_date: '2030-01-01' }, '2027-03-05');
    const dates = rows.map(r => String(r.period)).sort();
    expect(dates[dates.length - 1]).toBe('2027-03-04');
    expect(dates[0]).toBe(addDays(world.today, -730));
  });

  it('keeps the numbers of a period when the dates move along with today', () => {
    const now = new DemoWorld(undefined, TODAY);
    const later = new DemoWorld(undefined, '2027-02-01');
    const c = now.campaigns[1];
    expect(later.dayMetrics(later.campaigns[1], 30)).toEqual(now.dayMetrics(c, 30));
  });

  it('has conversion lag on recent days', () => {
    const world = new DemoWorld(undefined, TODAY);
    const c = world.campaigns.find(x => x.category === 'Stoves' && x.network === 'Search')!;
    const rate = (from: number, to: number) => {
      let clicks = 0; let conversions = 0;
      for (let age = from; age <= to; age += 1) { const m = world.dayMetrics(c, age)!; clicks += m.clicks; conversions += m.conversions; }
      return conversions / clicks;
    };
    expect(rate(1, 5)).toBeLessThan(rate(25, 30) * 0.9);
  });

  it('tells the story: dip, recovery, feed problem, zombies', () => {
    const world = new DemoWorld(undefined, TODAY);
    const brandless = world.campaigns.find(c => c.category === 'Stoves' && c.network === 'PMax')!;
    const cvr = (age: number) => { const m = world.dayMetrics(brandless, age)!; return m.conversions / m.clicks; };
    const average = (from: number, to: number, f: (a: number) => number) => { let s = 0; for (let a = from; a <= to; a += 1) s += f(a); return s / (to - from + 1); };
    expect(average(55, 70, cvr)).toBeLessThan(average(RECOVERED - 8, RECOVERED, cvr));
    expect(DIP_START).toBeGreaterThan(RECOVERED);

    const shopping = world.campaigns.find(c => c.account_id === B && c.network === 'PMax' && c.category === 'Rugs')!;
    const clicks = (age: number) => world.dayMetrics(shopping, age)!.clicks;
    expect(average(FEED_END + 2, FEED_START - 2, clicks)).toBeLessThan(average(FEED_START + 3, FEED_START + 16, clicks));

    const buckets = new Set(world.products.map(p => world.bucketOf(p, 1)));
    expect(buckets).toContain('zombies');
    expect(buckets).toContain('heroes');
  });

  it('never uses a remote or client image', () => {
    const world = new DemoWorld(undefined, TODAY);
    expect(world.products.every(p => p.image.startsWith('data:image/svg+xml,'))).toBe(true);
  });

  it('classifies campaign names with the parser in dashboard.config.ts', () => {
    const world = new DemoWorld(undefined, TODAY);
    expect(world.campaigns.find(c => c.campaign_name === '03 | Fire pits')?.category).toBe('Stoves');
    expect(world.campaigns.find(c => c.campaign_name === 'Spring test campaign')?.parsed).toBe(false);
  });
});

describe('response shapes match the database functions', () => {
  const expectKeys = (row: Record<string, unknown>, keys: string[]) => expect(Object.keys(row).sort()).toEqual([...keys].sort());
  const facts = ['account_id', 'platform', 'period', 'campaign_id', 'campaign_name', 'status', 'category', 'network', 'impressions', 'clicks', 'cost', 'conversions', 'conversions_value'];

  it('campaign facts', async () => expectKeys((await rpc('read_campaign_facts_json'))[0], [...facts, 'channel_type', 'bucket', 'target_roas', 'target_cpa', 'all_conversions', 'all_conversions_value', 'eligible_impressions', 'is_impressions', 'budget_lost_impressions', 'rank_lost_impressions']));
  it('conversion roles', async () => expectKeys((await rpc('read_conversion_roles_json'))[0], ['account_id', 'platform', 'period', 'campaign_id', 'role', 'conversion_action_id', 'conversion_action_name', 'conversions', 'conversions_value']));
  it('devices', async () => expectKeys((await rpc('read_device_facts_json'))[0], [...facts, 'device']));
  it('geo', async () => expectKeys((await rpc('read_geo_facts_json'))[0], [...facts, 'country_code']));
  it('product facts', async () => expectKeys((await rpc('read_product_facts_json'))[0], ['account_id', 'platform', 'campaign_id', 'campaign_name', 'network', 'category', 'campaign_bucket', 'product_item_id', 'product_title', 'product_type', 'brand', 'custom_label_0', 'custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4', 'country_code', 'impressions', 'clicks', 'cost', 'conversions', 'conversions_value', 'source']));
  it('product daily', async () => expectKeys((await rpc('read_product_daily_json', { p_item_id: 'cf-1001' }))[0], ['date', 'campaign_id', 'campaign_name', 'campaign_bucket', 'country_code', 'label', 'impressions', 'clicks', 'cost', 'conversions', 'conversions_value']));
  it('feed products', async () => expectKeys((await rpc('read_feed_products_json'))[0], ['account_id', 'feed_label', 'item_id', 'title', 'link', 'image_link', 'price', 'currency', 'availability', 'brand', 'product_type', 'custom_label_0', 'custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4', 'ads_status', 'merchant_status', 'issues', 'synced_at']));
  it('feed daily', async () => expectKeys((await rpc('read_feed_daily_json', { p_account_id: A, p_start_date: '2026-11-01' }))[0], ['date', 'totals', 'by_destination', 'synced_at']));
  it('change events', async () => expectKeys((await rpc('read_change_events_json'))[0], ['account_id', 'change_time', 'change_date', 'resource_name', 'resource_type', 'operation', 'campaign_id', 'campaign_name', 'changed_fields', 'summary', 'user_email', 'client_type']));
  it('auction', async () => expectKeys((await rpc('read_auction_insights_json', { p_grain: 'all', p_network: 'Search', p_category: null }))[0], ['period', 'network', 'category', 'competitor', 'impression_share', 'is_capped', 'overlap_rate', 'position_above_rate', 'top_of_page_rate', 'abs_top_rate', 'outranking_share', 'eligible', 'campaign_days']));
  it('auction categories', async () => expectKeys((await rpc('read_auction_categories_json'))[0], ['network', 'category', 'eligible']));
  it('sync status', async () => expectKeys((await rpc('read_sync_status_json'))[0], ['source', 'dataset', 'account_id', 'status', 'start_date', 'end_date', 'row_count', 'duration_ms', 'error_message', 'started_at', 'completed_at']));
  it('coverage', async () => expectKeys((await rpc('read_data_coverage_json'))[0], ['dataset', 'account_id', 'platform', 'first_date', 'last_date', 'rows']));

  it('keyword rows work with the real row mapper', async () => {
    const tuple = (await rpc('read_keyword_quality_json'))[0] as unknown as QualityTuple;
    const row = toRow(tuple);
    expect(row.keyword).toBeTruthy();
    expect([2, 3, 4]).toContain(row.expected_ctr);
  });

  it('product label day rows have nine positions', async () => {
    expect(((await rpc('read_product_label_days_json'))[0] as unknown as unknown[]).length).toBe(9);
  });

  it('communication items and actions', async () => {
    const { data } = await createFakeClient(undefined, TODAY).rpc('read_communications_json', { p_label: 'shopb', p_include_hidden: true });
    const body = data as { items: Record<string, unknown>[]; actions: Record<string, unknown>[] };
    expectKeys(body.items[0], ['id', 'kind', 'title', 'date', 'time', 'participants', 'summary_md', 'decisions', 'detail_md', 'message_count', 'labels', 'hidden']);
    expectKeys(body.actions[0], ['id', 'source_id', 'title', 'owner', 'due', 'label', 'status', 'created']);
  });
});

describe('fake client', () => {
  it('filters, orders and limits like the real client', async () => {
    const db = createFakeClient(undefined, TODAY);
    const { data } = await db.from('ads_campaign_daily').select('fact_date').eq('account_id', A).in('platform', ['google']).order('fact_date', { ascending: false }).limit(1).maybeSingle();
    expect(data).toEqual({ fact_date: '2026-11-09' });
    const { data: none } = await db.from('users').select('id').eq('email', 'nobody@example.com').maybeSingle();
    expect(none).toBeNull();
    const { count } = await db.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin');
    expect(count).toBe(1);
  });

  it('keeps writes in memory and never changes the seed data elsewhere', async () => {
    const db = createFakeClient(undefined, TODAY);
    const before = await db.rpc('read_communications_json', { p_label: 'shopa', p_include_hidden: true });
    expect(((before.data as { actions: { id: string; status: string }[] }).actions.find(a => a.id === 'a1'))!.status).toBe('open');
    await db.rpc('set_action_status', { p_id: 'a1', p_status: 'done' });
    const after = await db.rpc('read_communications_json', { p_label: 'shopa', p_include_hidden: true });
    expect(((after.data as { actions: { id: string; status: string }[] }).actions.find(a => a.id === 'a1'))!.status).toBe('done');
    const fresh = await createFakeClient(undefined, TODAY).rpc('read_communications_json', { p_label: 'shopa', p_include_hidden: true });
    expect(((fresh.data as { actions: { id: string; status: string }[] }).actions.find(a => a.id === 'a1'))!.status).toBe('open');
  });

  it('refuses sync writes', async () => {
    const { error } = await createFakeClient(undefined, TODAY).rpc('publish_daily_facts', {});
    expect(error?.message).toContain('Not available');
  });
});

describe('AI replay', () => {
  it('has a labelled analysis and every suggested question for both shops', async () => {
    const db = createFakeClient(undefined, TODAY);
    const { data } = await db.from('ai_insights').select('account_label,source');
    expect(data).toHaveLength(4);
    for (const label of ['shopa', 'shopb']) expect(replayAnswer(label, 'Why is revenue below goal?', { shift: 0 })).not.toBe(NO_KEY_MESSAGE);
  });

  it('answers free text with the connect-your-key message', () => {
    expect(replayAnswer('shopa', 'What should I do about my brand?', { shift: 0 })).toBe(NO_KEY_MESSAGE);
    expect(NO_KEY_MESSAGE).toMatch(/your own API key/);
  });

  it('moves dates in the text along with the data', () => {
    expect(shiftDatesInText('From 2 October to 18 Oct 2026, and 2026-10-01.', 30, 2026)).toBe('From 1 November to 17 Nov 2026, and 2026-10-31.');
    expect(shiftDatesInText('On 2 October.', 0, 2026)).toBe('On 2 October.');
  });
});

describe('safety', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('server-only'); vi.doUnmock('next-auth'); });

  const DB = { NEXT_PUBLIC_SUPABASE_URL: 'https://x.example', SUPABASE_SERVICE_ROLE_KEY: 'x' };

  it('runs the demo only in development without database settings, or on request', () => {
    expect(resolveDemoMode({ NODE_ENV: 'development' })).toBe(true);
    expect(resolveDemoMode({ NODE_ENV: 'development', ...DB })).toBe(false);
    expect(resolveDemoMode({ NODE_ENV: 'production' })).toBe(false);
    expect(resolveDemoMode({ NODE_ENV: 'production', ...DB })).toBe(false);
    expect(resolveDemoMode({ NODE_ENV: 'production', DASHBOARD_DEMO: '1' })).toBe(true);
    expect(resolveDemoMode({ NODE_ENV: 'production', DASHBOARD_DEMO: 'true' })).toBe(false);
  });

  it('refuses to start in demo mode with database settings present', () => {
    for (const env of [DB, { NEXT_PUBLIC_SUPABASE_URL: 'x' }, { SUPABASE_SERVICE_ROLE_KEY: 'x' }]) {
      expect(() => resolveDemoMode({ NODE_ENV: 'production', DASHBOARD_DEMO: '1', ...env })).toThrow(/refuses to start/);
    }
  });

  it('disables every cron in demo mode', () => {
    const on = { microsoftAds: true, feedStatus: true, auctionInsights: true, changeHistory: true, qualityScore: true, communications: true, ai: true };
    for (const path of ['/api/cron/google-ads', '/api/cron/feed', '/api/cron/insights', '/api/cron/microsoft-ads', '/api/cron/auction']) {
      expect(moduleGate(path, new URLSearchParams(), on, true)).toBe('skip');
      expect(moduleGate(path, new URLSearchParams(), on, false)).toBe('open');
    }
  });

  it('bypasses the login only in demo mode', async () => {
    vi.doMock('server-only', () => ({}));
    vi.doMock('next-auth', () => ({ getServerSession: async () => null, default: vi.fn() }));
    vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', '');
    vi.stubEnv('NEXTAUTH_SECRET', 'test');
    expect(await (await import('../auth')).requireSession()).toBeNull();
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', '1');
    expect((await (await import('../auth')).requireSession('admin'))?.user.role).toBe('admin');
  });

  it('never returns the real client in demo mode with a service key present', async () => {
    vi.doMock('server-only', () => ({}));
    vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', '1');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'x');
    const { getSupabaseAdmin } = await import('../supabaseAdmin');
    expect(() => getSupabaseAdmin()).toThrow(/refuses/);
  });
});
