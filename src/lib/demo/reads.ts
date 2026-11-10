import { ACCOUNTS, BRAND } from '../config';
import { addDays, longDate, periodOf } from './dates';
import { between, hash, noise, round2 } from './random';
import { DIP_END, DIP_START, FEED_END, FEED_START, HISTORY_DAYS, LABEL_EPOCH_DAYS, RECOVERED, type DayMetrics, type DemoCampaign, type DemoProduct, type DemoWorld } from './world';

// The fake database functions. Each one returns the same shape as the read function of
// the same name in supabase/migrations.

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const label = (c: DemoCampaign) => (c.platform === 'microsoft' ? `${c.campaign_name} (Microsoft)` : c.campaign_name);
const r0 = Math.round;

function forEachDay(world: DemoWorld, args: Args, visit: (c: DemoCampaign, date: string, age: number, m: DayMetrics) => void, campaigns?: DemoCampaign[]) {
  const ids = (args.p_account_ids as string[]) ?? [];
  const platforms = (args.p_platforms as string[] | null) ?? null;
  const list = (campaigns ?? world.campaigns).filter(c => ids.includes(c.account_id) && (!platforms || platforms.includes(c.platform)));
  const first = addDays(world.today, -HISTORY_DAYS);
  const last = addDays(world.today, -1);
  const start = String(args.p_start_date) < first ? first : String(args.p_start_date);
  const end = String(args.p_end_date) > last ? last : String(args.p_end_date);
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const age = world.ageOf(date);
    for (const c of list) {
      const m = world.dayMetrics(c, age);
      if (m) visit(c, date, age, m);
    }
  }
}

function add(target: Row, key: string, value: number) { target[key] = (target[key] as number) + value; }
const finish = (rows: Row[], money: string[]) => rows.map(row => { for (const k of money) row[k] = round2(row[k] as number); return row; });
const MONEY = ['cost', 'conversions', 'conversions_value'];

export function campaignFacts(world: DemoWorld, args: Args): Row[] {
  const grain = String(args.p_grain ?? 'day');
  const groups = new Map<string, Row>();
  forEachDay(world, args, (c, date, _age, m) => {
    const period = periodOf(date, grain);
    const key = `${c.campaign_id}|${c.platform}|${period}`;
    let row = groups.get(key);
    if (!row) {
      row = { account_id: c.account_id, platform: c.platform, period, campaign_id: c.campaign_id, campaign_name: label(c), channel_type: c.channel_type, status: c.status, network: c.network, category: c.category, bucket: c.bucket, target_roas: c.target_roas, target_cpa: c.target_cpa, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0, all_conversions: 0, all_conversions_value: 0, eligible_impressions: 0, is_impressions: 0, budget_lost_impressions: 0, rank_lost_impressions: 0 };
      groups.set(key, row);
    }
    add(row, 'impressions', m.impressions); add(row, 'clicks', m.clicks); add(row, 'cost', m.cost); add(row, 'conversions', m.conversions); add(row, 'conversions_value', m.conversions_value);
    add(row, 'all_conversions', m.conversions * 1.4); add(row, 'all_conversions_value', m.conversions_value * 1.02);
    if (m.share) {
      const eligible = m.impressions / m.share;
      add(row, 'eligible_impressions', eligible); add(row, 'is_impressions', m.impressions); add(row, 'budget_lost_impressions', eligible * m.budgetLost); add(row, 'rank_lost_impressions', eligible * m.rankLost);
    }
  });
  return finish([...groups.values()], [...MONEY, 'all_conversions', 'all_conversions_value']);
}

const ACTIONS: { id: string; name: string; role: string; volume: number; value: number }[] = [
  { id: '7100001', name: 'Purchase', role: 'primary_revenue', volume: 1, value: 1 },
  { id: '7100002', name: 'Add to basket', role: 'micro', volume: 3.6, value: 0 },
  { id: '7100003', name: 'Sample order', role: 'samples', volume: 0.18, value: 0 },
  { id: '7100004', name: 'Newsletter signup', role: 'unmapped', volume: 0.3, value: 0 },
];

export function conversionRoles(world: DemoWorld, args: Args): Row[] {
  const grain = String(args.p_grain ?? 'day');
  const groups = new Map<string, Row>();
  forEachDay(world, args, (c, date, _age, m) => {
    const period = periodOf(date, grain);
    for (const a of ACTIONS) {
      const key = `${c.campaign_id}|${period}|${a.id}`;
      const row = groups.get(key) ?? { account_id: c.account_id, platform: c.platform, period, campaign_id: c.campaign_id, role: a.role, conversion_action_id: a.id, conversion_action_name: a.name, conversions: 0, conversions_value: 0 };
      groups.set(key, row);
      add(row, 'conversions', m.conversions * a.volume);
      add(row, 'conversions_value', m.conversions_value * a.value);
    }
  });
  return finish([...groups.values()], ['conversions', 'conversions_value']);
}

const COUNTRIES: [string, number, number][] = [['NL', 0.68, 1.04], ['BE', 0.21, 0.92], ['DE', 0.07, 0.86], ['FR', 0.04, 0.72]];
const DEVICES: [string, number, number][] = [['MOBILE', 0.58, 0.8], ['DESKTOP', 0.35, 1.42], ['TABLET', 0.07, 1.0]];

function splitBy(world: DemoWorld, args: Args, field: string, parts: [string, number, number][], adjust?: (name: string, c: DemoCampaign, age: number) => number): Row[] {
  const grain = String(args.p_grain ?? 'day');
  const groups = new Map<string, Row>();
  forEachDay(world, args, (c, date, age, m) => {
    const period = periodOf(date, grain);
    const weights = parts.map(([name, , quality]) => quality * (adjust?.(name, c, age) ?? 1));
    const total = parts.reduce((sum, [, share], i) => sum + share * weights[i], 0);
    parts.forEach(([name, share], i) => {
      const key = `${c.campaign_id}|${period}|${name}`;
      const row = groups.get(key) ?? { account_id: c.account_id, platform: c.platform, period, campaign_id: c.campaign_id, campaign_name: label(c), status: c.status, category: c.category, network: c.network, [field]: name, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 };
      groups.set(key, row);
      const conversionShare = (share * weights[i]) / total;
      add(row, 'impressions', r0(m.impressions * share)); add(row, 'clicks', r0(m.clicks * share)); add(row, 'cost', m.cost * share);
      add(row, 'conversions', m.conversions * conversionShare); add(row, 'conversions_value', m.conversions_value * conversionShare);
    });
  });
  return finish([...groups.values()], MONEY);
}

export const geoFacts = (world: DemoWorld, args: Args) => splitBy(world, args, 'country_code', COUNTRIES);

// The first shop's dip is a mobile checkout problem, and the device split shows it.
export const deviceFacts = (world: DemoWorld, args: Args) => splitBy(world, args, 'device', DEVICES, (name, c, age) => {
  const firstShop = world.accounts[0]?.id === c.account_id;
  return firstShop && name === 'MOBILE' && age <= DIP_START && age > RECOVERED ? 0.45 : 1;
});

const productBase = (p: DemoProduct, bucket: string, shop: string) => ({
  product_item_id: p.item_id, product_title: p.title, product_type: p.product_type, brand: shop.toLowerCase(),
  custom_label_0: `${p.item_id} - ${p.group}`, custom_label_1: p.size, custom_label_2: bucket, custom_label_3: p.group, custom_label_4: '',
});

function shopName(world: DemoWorld, accountId: string) { return world.accounts.find(a => a.id === accountId)?.name ?? 'shop'; }

const COUNTRY_SPLIT = COUNTRIES.map(([code, share, quality]) => ({ code, share, quality }));
const COUNTRY_TOTAL = COUNTRY_SPLIT.reduce((s, c) => s + c.share * c.quality, 0);

export function productFacts(world: DemoWorld, args: Args): Row[] {
  const groups = new Map<string, { c: DemoCampaign; age: number; m: DayMetrics }>();
  forEachDay(world, args, (c, _date, age, m) => {
    if (c.network !== 'Shopping' && c.network !== 'PMax') return;
    const key = `${c.campaign_id}|${Math.floor(age / LABEL_EPOCH_DAYS)}`;
    const group = groups.get(key);
    if (!group) { groups.set(key, { c, age, m: { ...m } }); return; }
    group.m.impressions += m.impressions; group.m.clicks += m.clicks; group.m.cost += m.cost; group.m.conversions += m.conversions; group.m.conversions_value += m.conversions_value;
  });
  const rows = new Map<string, Row>();
  for (const { c, age, m } of groups.values()) {
    for (const s of world.productShares(c, age)) {
      for (const country of COUNTRY_SPLIT) {
        const key = `${c.campaign_id}|${s.product.item_id}|${s.bucket}|${country.code}`;
        const quality = country.quality / COUNTRY_TOTAL;
        const row = rows.get(key) ?? { account_id: c.account_id, platform: c.platform, campaign_id: c.campaign_id, campaign_name: label(c), network: c.network, category: c.category, campaign_bucket: c.bucket, ...productBase(s.product, s.bucket, shopName(world, c.account_id)), country_code: country.code, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0, source: 'daily' };
        rows.set(key, row);
        add(row, 'impressions', r0(m.impressions * s.reach * country.share)); add(row, 'clicks', r0(m.clicks * s.reach * country.share)); add(row, 'cost', m.cost * s.cost * country.share);
        add(row, 'conversions', m.conversions * s.value * country.share * quality); add(row, 'conversions_value', m.conversions_value * s.value * country.share * quality);
      }
    }
  }
  return finish([...rows.values()], MONEY);
}

export function productDaily(world: DemoWorld, args: Args): Row[] {
  const id = String(args.p_item_id).toLowerCase();
  const out: Row[] = [];
  forEachDay(world, args, (c, date, age, m) => {
    const share = world.productShares(c, age).find(s => s.product.item_id.toLowerCase() === id);
    if (!share) return;
    for (const country of COUNTRY_SPLIT) {
      const quality = country.quality / COUNTRY_TOTAL;
      out.push({ date, campaign_id: c.campaign_id, campaign_name: label(c), campaign_bucket: c.bucket, country_code: country.code, label: share.bucket, impressions: r0(m.impressions * share.reach * country.share), clicks: r0(m.clicks * share.reach * country.share), cost: round2(m.cost * share.cost * country.share), conversions: round2(m.conversions * share.value * country.share * quality), conversions_value: round2(m.conversions_value * share.value * country.share * quality) });
    }
  });
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.campaign_id).localeCompare(String(b.campaign_id)) || String(a.country_code).localeCompare(String(b.country_code)));
}

export function productLabelDays(world: DemoWorld, args: Args): unknown[] {
  const rows = new Map<string, unknown[]>();
  forEachDay(world, args, (c, date, age, m) => {
    for (const s of world.productShares(c, age)) {
      const key = `${date}|${s.product.item_id}|${s.bucket}`;
      const row = rows.get(key) ?? [date, s.product.item_id, s.bucket, 0, 0, 0, 0, 0, s.product.product_type];
      rows.set(key, row);
      row[3] = (row[3] as number) + r0(m.impressions * s.reach); row[4] = (row[4] as number) + r0(m.clicks * s.reach);
      row[5] = round2((row[5] as number) + m.cost * s.cost); row[6] = round2((row[6] as number) + m.conversions * s.value); row[7] = round2((row[7] as number) + m.conversions_value * s.value);
    }
  });
  return [...rows.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
}

const KEYWORDS: Record<string, string[]> = {
  Brand: ['{shop}', '{shop} shop', '{shop} reviews', '{shop} opening hours'],
  Stoves: ['wood stove', 'buy log burner', 'outdoor stove', 'fire pit', 'fire pit table', 'patio heater wood', 'fire bowl large', 'garden fire pit'],
  'Planters + Pots': ['zinc planter', 'large planter', 'terracotta pots', 'raised garden bed', 'corten planter', 'balcony planter'],
  Lighting: ['solar garden lights', 'outdoor wall light', 'festoon lights', 'garden lanterns', 'porch light'],
  'Wall art': ['canvas prints', 'large wall art', 'botanical prints', 'framed poster', 'art for living room', 'gallery wall set'],
  Other: ['garden gift ideas', 'outdoor living shop', 'garden accessories'],
};

export function keywordQuality(world: DemoWorld, args: Args): unknown[] {
  const out: unknown[] = [];
  const search = world.campaigns.filter(c => c.network === 'Search');
  forEachDay(world, args, (c, date, _age, m) => {
    const words = (KEYWORDS[c.category] ?? KEYWORDS.Other).map(w => w.replace('{shop}', shopName(world, c.account_id).toLowerCase()));
    const weights = words.map((_w, i) => 1 / (1 + i));
    const total = weights.reduce((s, w) => s + w, 0);
    words.forEach((word, i) => {
      const criterion = `${c.campaign_id.slice(-6)}${100 + i}`;
      const adGroup = `${c.campaign_id.slice(-6)}${i % 2}`;
      const share = weights[i] / total;
      const quality = c.category === 'Brand' ? 9 + (hash(criterion) % 2) : 3 + (hash(`${criterion}qs`) % 8);
      const part = (key: string) => (quality >= 8 ? 4 : quality <= 4 ? 2 : 2 + (hash(`${criterion}${key}`) % 3));
      out.push([date, c.campaign_id, label(c), c.status, c.network, c.category, adGroup, i % 2 ? `${c.category} general` : `${c.category} exact`, criterion, word, ['EXACT', 'PHRASE', 'BROAD'][i % 3], r0(m.impressions * share), r0(m.clicks * share), round2(m.cost * share), round2(m.conversions * share), round2(m.conversions_value * share), quality, part('ctr'), part('ad'), part('lp')]);
    });
  }, search);
  return out;
}

const STATUS_RATE: [string, string, 'blocking' | 'warning', string][] = [
  ['item_missing_required_attribute', 'NOT_ELIGIBLE', 'blocking', 'Missing value [shipping]'],
  ['landing_page_error', 'NOT_ELIGIBLE', 'blocking', 'Mismatched landing page'],
  ['low_image_quality', 'ELIGIBLE_LIMITED', 'warning', 'Low image quality [image_link]'],
  ['missing_potentially_required_attribute', 'ELIGIBLE', 'warning', 'Missing recommended attribute [gtin]'],
  ['price_updated', 'ELIGIBLE', 'warning', 'Automatic updates: mismatched product price'],
];

export function feedProducts(world: DemoWorld, args: Args): Row[] {
  const ids = (args.p_account_ids as string[]) ?? [];
  const syncedAt = `${world.today}T05:20:00.000Z`;
  return world.products.filter(p => ids.includes(p.account_id)).map(p => {
    const roll = noise(world.seed, `${p.item_id}feed`);
    const profile = world.accounts.find(a => a.id === p.account_id)!.profile;
    const blockedLimit = profile === 1 ? 0.07 : 0.03;
    const issues: Row[] = [];
    let ads = 'ELIGIBLE';
    let merchant = 'APPROVED';
    if (roll < blockedLimit) {
      const [code, status, severity, description] = STATUS_RATE[roll < blockedLimit / 2 ? 0 : 1];
      issues.push({ code, source: 'merchant', severity, description });
      ads = status; merchant = 'DISAPPROVED';
    } else if (roll < blockedLimit + 0.04) {
      merchant = 'PENDING';
    }
    const extra = noise(world.seed, `${p.item_id}warn`);
    if (extra < 0.12) { const [code, status, severity, description] = STATUS_RATE[2 + Math.floor(extra / 0.04)]; issues.push({ code, source: 'merchant', severity, description }); if (ads === 'ELIGIBLE') ads = status; }
    const outOfStock = noise(world.seed, `${p.item_id}stock`) < 0.05;
    return {
      account_id: p.account_id, feed_label: 'NL', item_id: p.item_id, title: p.title, link: `https://${shopName(world, p.account_id).toLowerCase()}.example/${p.item_id.toLowerCase()}`, image_link: p.image, price: p.price, currency: 'EUR', availability: outOfStock ? 'OUT_OF_STOCK' : 'IN_STOCK', brand: shopName(world, p.account_id).toLowerCase(), product_type: p.product_type,
      custom_label_0: `${p.item_id} - ${p.group}`, custom_label_1: p.size, custom_label_2: world.bucketOf(p, 1), custom_label_3: p.group, custom_label_4: null,
      ads_status: ads, merchant_status: merchant, issues, synced_at: syncedAt,
    };
  });
}

export function feedDaily(world: DemoWorld, args: Args): Row[] {
  const id = String(args.p_account_id);
  const account = world.accounts.find(a => a.id === id);
  if (!account) return [];
  const current = feedProducts(world, { p_account_ids: [id] });
  const blocked = current.filter(r => r.ads_status === 'NOT_ELIGIBLE').length;
  const pending = current.filter(r => r.merchant_status === 'PENDING').length;
  const out: Row[] = [];
  const first = String(args.p_start_date);
  for (let date = first; date < world.today; date = addDays(date, 1)) {
    const age = world.ageOf(date);
    const issue = account.profile === 1 && age <= FEED_START && age > FEED_END ? Math.round(current.length * 0.31) : 0;
    const itemsInFeed = current.length;
    const nowBlocked = blocked + issue + (hash(`${id}${age}`) % 3);
    const eligible = itemsInFeed - nowBlocked;
    const approved = itemsInFeed - nowBlocked - pending;
    out.push({ date, totals: { itemsInFeed, eligible, blocked: nowBlocked, pending, merchantProducts: itemsInFeed, merchantApproved: approved, merchantDisapproved: nowBlocked, merchantPending: pending }, by_destination: [{ destination: 'SHOPPING_ADS', label: 'Shopping ads', active: approved, pending, disapproved: nowBlocked }, { destination: 'FREE_LISTINGS', label: 'Free listings', active: approved + Math.round(nowBlocked / 2), pending, disapproved: Math.round(nowBlocked / 2) }], synced_at: `${date}T05:20:00.000Z` });
  }
  return out;
}

const CHANGE_PATTERNS: [string, string, string[], string][] = [
  ['CAMPAIGN_BUDGET', 'UPDATE', ['amount_micros'], 'Campaign budget changed'],
  ['CAMPAIGN_CRITERION', 'CREATE', ['keyword.text'], 'Negative keyword added (campaign)'],
  ['AD_GROUP_CRITERION', 'CREATE', ['keyword.text'], 'Keyword added'],
  ['AD_GROUP_CRITERION', 'UPDATE', ['status'], 'Keyword paused'],
  ['AD_GROUP_AD', 'UPDATE', ['ad.responsive_search_ad.headlines'], 'Ad text changed'],
  ['CAMPAIGN', 'UPDATE', ['target_roas.target_roas'], 'Target ROAS changed'],
  ['ASSET', 'CREATE', ['name'], 'Asset added'],
];

export function changeEvents(world: DemoWorld, args: Args): Row[] {
  const ids = (args.p_account_ids as string[]) ?? [];
  const start = String(args.p_start_date);
  const end = String(args.p_end_date);
  const out: Row[] = [];
  const story = (accountIndex: number, age: number) => {
    if (accountIndex === 0 && age === DIP_END) return ['CAMPAIGN', 'UPDATE', ['tracking_url_template'], 'Mobile checkout fix released, tracking checked'] as const;
    if (accountIndex === 0 && age === DIP_START + 1) return ['CAMPAIGN', 'UPDATE', ['final_url_suffix'], 'Final URL suffix changed for the new checkout'] as const;
    if (accountIndex === 1 && age === FEED_END + 1) return ['ASSET', 'UPDATE', ['feed'], 'Feed attributes corrected and products resubmitted'] as const;
    return null;
  };
  for (const account of world.accounts) {
    if (!ids.includes(account.id)) continue;
    const campaigns = world.campaigns.filter(c => c.account_id === account.id && c.platform === 'google' && c.status === 'ENABLED');
    for (let age = 1; age <= Math.min(HISTORY_DAYS, 400); age += 1) {
      const date = addDays(world.today, -age);
      if (date < start || date > end) continue;
      const special = story(account.profile, age);
      const count = Math.floor(between(world.seed, `${account.id}changes${age}`, 0, 5));
      const planned = special ? [special, ...Array(count).fill(null)] : Array(count).fill(null);
      planned.forEach((plan, i) => {
        const pick = hash(`${account.id}${age}${i}`);
        const template = plan ?? CHANGE_PATTERNS[pick % CHANGE_PATTERNS.length];
        const c = campaigns[pick % campaigns.length];
        out.push({ account_id: account.id, change_time: `${date}T${String(8 + (pick % 9)).padStart(2, '0')}:${String(pick % 60).padStart(2, '0')}:00.000Z`, change_date: date, resource_name: `customers/${account.id}/campaigns/${c.campaign_id}/changes/${age}${i}`, resource_type: template[0], operation: template[1], campaign_id: c.campaign_id, campaign_name: c.campaign_name, changed_fields: [...template[2]], summary: template[3], user_email: 'demo@example.com', client_type: pick % 5 === 0 ? 'GOOGLE_ADS_SCRIPTS' : 'GOOGLE_ADS_WEB_CLIENT' });
      });
    }
  }
  return out.sort((a, b) => String(a.change_time).localeCompare(String(b.change_time)) || String(a.resource_name).localeCompare(String(b.resource_name)));
}

const COMPETITORS = [
  ['northflame.example', 'emberyard.example', 'hearthlane.example', 'patioforge.example', 'gardengrate.example', 'ashwood-outdoor.example'],
  ['loomandlane.example', 'walltales.example', 'softfloor.example', 'printhouse.example', 'threadloft.example', 'canvasmill.example'],
];

export const auctionCompetitors = COMPETITORS;

function auctionGroups(world: DemoWorld, args: Args) {
  const groups = new Map<string, { network: string; category: string; account: string; profile: number; impressions: number; eligible: number; days: number; sampleAge: number }>();
  const campaigns = world.campaigns.filter(c => c.platform === 'google' && (c.network === 'Search' || c.network === 'Shopping') && c.status === 'ENABLED');
  return { groups, campaigns, args };
}

export function auctionInsights(world: DemoWorld, args: Args): Row[] {
  const { groups, campaigns } = auctionGroups(world, args);
  const grain = String(args.p_grain ?? 'week');
  forEachDay(world, { ...args, p_platforms: ['google'] }, (c, date, age, m) => {
    if ((args.p_network && c.network !== args.p_network) || (args.p_category && c.category !== args.p_category) || !m.share) return;
    const period = grain === 'all' ? String(args.p_start_date) : periodOf(date, grain);
    const key = `${period}|${c.network}|${c.category}`;
    const account = world.accounts.find(a => a.id === c.account_id)!;
    const group = groups.get(key) ?? { network: c.network, category: c.category, account: c.account_id, profile: account.profile, impressions: 0, eligible: 0, days: 0, sampleAge: age };
    group.impressions += m.impressions; group.eligible += m.impressions / m.share; group.days += 1;
    groups.set(key, group);
  }, campaigns);
  const out: Row[] = [];
  for (const [key, g] of groups) {
    const period = key.split('|')[0];
    const own = g.impressions / g.eligible;
    out.push({ period, network: g.network, category: g.category, competitor: 'You', impression_share: own, is_capped: false, overlap_rate: null, position_above_rate: null, top_of_page_rate: g.network === 'Search' ? 0.71 : 0.48, abs_top_rate: g.network === 'Search' ? 0.34 : 0.18, outranking_share: null, eligible: g.eligible, campaign_days: g.days });
    COMPETITORS[g.profile].forEach((domain, i) => {
      const seed = `${domain}${g.category}${g.network}`;
      const base = between(world.seed, seed, 0.06, 0.52) * (i === 0 ? 1.25 : 1);
      if (noise(world.seed, `${seed}present`) > 0.86) return;
      const rising = i === 0 ? 1 + (120 - Math.min(g.sampleAge, 120)) / 300 : 1;
      const share = Math.min(0.72, base * rising * (0.94 + noise(world.seed, `${seed}${period}`) * 0.12));
      const capped = share < 0.1;
      out.push({ period, network: g.network, category: g.category, competitor: domain, impression_share: capped ? 0.0999 : share, is_capped: capped, overlap_rate: Math.min(0.9, share * 1.1), position_above_rate: between(world.seed, `${seed}above`, 0.12, 0.48), top_of_page_rate: between(world.seed, `${seed}top`, 0.3, 0.8), abs_top_rate: between(world.seed, `${seed}abs`, 0.08, 0.35), outranking_share: between(world.seed, `${seed}out`, 0.3, 0.75), eligible: g.eligible, campaign_days: g.days });
    });
  }
  return out.sort((a, b) => String(a.period).localeCompare(String(b.period)) || String(a.category).localeCompare(String(b.category)) || String(a.competitor).localeCompare(String(b.competitor)));
}

export function auctionCategories(world: DemoWorld, args: Args): Row[] {
  const groups = new Map<string, Row>();
  forEachDay(world, { ...args, p_platforms: ['google'] }, (c, _d, _a, m) => {
    if ((c.network !== 'Search' && c.network !== 'Shopping') || !m.share || c.status !== 'ENABLED') return;
    const key = `${c.network}|${c.category}`;
    const row = groups.get(key) ?? { network: c.network, category: c.category, eligible: 0 };
    groups.set(key, row);
    add(row, 'eligible', m.impressions / m.share);
  });
  return [...groups.values()].sort((a, b) => String(a.network).localeCompare(String(b.network)) || (b.eligible as number) - (a.eligible as number));
}

export function auctionCoverage(world: DemoWorld, args: Args): Row[] {
  const ids = (args.p_account_ids as string[]) ?? [];
  return ids.length ? [{ network: 'Search', first_date: addDays(world.today, -HISTORY_DAYS), last_date: addDays(world.today, -1) }, { network: 'Shopping', first_date: addDays(world.today, -HISTORY_DAYS), last_date: addDays(world.today, -1) }] : [];
}

const DATASETS = ['campaign', 'conversions', 'geo', 'device', 'product', 'quality', 'changes', 'feed', 'auction'];

export function syncStatus(world: DemoWorld): Row[] {
  return world.accounts.flatMap(a => DATASETS.map((dataset, i) => {
    const started = `${world.today}T0${(i % 6) + 3}:10:00.000Z`;
    return { source: dataset === 'feed' ? 'merchant' : dataset === 'auction' ? 'sheets' : 'google_ads', dataset, account_id: a.id, status: 'success', start_date: addDays(world.today, -3), end_date: addDays(world.today, -1), row_count: 200 + (hash(`${a.id}${dataset}`) % 4800), duration_ms: 1200 + (hash(`${dataset}${a.id}t`) % 9000), error_message: null, started_at: started, completed_at: started.replace(':10:00', ':11:04') };
  }));
}

export function dataCoverage(world: DemoWorld): Row[] {
  return world.accounts.flatMap(a => ['campaign', 'conversions', 'geo', 'device', 'product', 'quality', 'changes', 'auction'].flatMap(dataset => ['google', 'microsoft'].filter(p => p === 'google' || ['campaign', 'geo', 'device'].includes(dataset)).map(platform => ({
    dataset, account_id: a.id, platform, first_date: addDays(world.today, platform === 'google' ? -HISTORY_DAYS : -240), last_date: addDays(world.today, -1), rows: 2000 + (hash(`${a.id}${dataset}${platform}`) % 40000),
  }))));
}

export function contextFindings(world: DemoWorld, args: Args): Row[] {
  const first = world.accounts[0];
  const second = world.accounts[1];
  const day = (age: number) => addDays(world.today, -age);
  const all = [
    first && { kind: 'notes', source: 'Account notes', account: first.label, run_date: day(RECOVERED + 2), window_start: day(DIP_START), window_end: day(RECOVERED), claim: `A checkout update on the ${first.name} site broke the payment step on mobile for about three weeks. It was fixed on ${longDate(day(DIP_END))}.`, evidence: 'Shop order numbers fell on mobile only over the same days.', severity: 'high', client_safe: true },
    second && { kind: 'audit', source: 'Feed review', account: second.label, run_date: day(FEED_END), window_start: day(FEED_START), window_end: day(FEED_END), claim: `A feed export change removed size and colour on rugs and wall art, and about 31% of ${second.name} products were disapproved until the feed was corrected.`, evidence: 'Merchant Center diagnostics showed missing required attributes.', severity: 'high', client_safe: true },
  ].filter(Boolean) as Row[];
  const label = String(args.p_label);
  return all.filter(f => f.account === label && String(f.window_start) <= String(args.p_end) && String(f.window_end) >= String(args.p_start) && (args.p_include_private || f.client_safe));
}

export function buildCommunications(world: DemoWorld) {
  const day = (offset: number) => addDays(world.today, offset);
  const labels = ACCOUNTS.map(a => a.label);
  const [a, b = a] = world.accounts;
  const owner = BRAND.accountManager;
  const client = BRAND.client;
  const people = [owner, `Sam (${client})`, `Alex (${client})`];
  const email = { kind: 'email', time: '', detail_md: null, hidden: false };
  const items = [
    { id: 'meeting:progress-review', kind: 'meeting', title: 'Monthly progress review', date: day(-4), time: '10:00 - 10:45', participants: people, message_count: 0, labels, hidden: false,
      summary_md: `- **Search** is stable, and Shopping brought in most of the extra revenue this month.\n- **${b.name}** is limited by budget on its best rug campaigns.\n- Next progress meeting: ${longDate(day(7))} at 10:00.`,
      decisions: [`Move part of the ${a.name} brand budget to Shopping for four weeks.`, 'Keep the seasonal promotion running until the end of the month.'],
      detail_md: `# Monthly progress review\n\n## Results\n- Both accounts are close to their ROAS targets.\n- ${a.name} has recovered from the mobile checkout problem.\n\n## Budget\n- ${b.name} campaigns lose impression share to budget on weekdays.\n- Review the split again after four weeks.\n\n## Next steps\n- Prepare the product list for the seasonal promotion.` },
    { ...email, id: 'email:feed-fix', title: 'Feed update after the disapprovals', date: day(-9), participants: [owner, `Sam (${client})`], message_count: 4, labels: [b.label],
      summary_md: `Size and colour were missing from the ${b.name} feed after an export change. Both attributes are back, and **${owner}** checks approval in Merchant Center.`,
      decisions: ['Add a weekly check on required feed attributes.'] },
    { ...email, id: 'email:stove-landing-page', title: 'Landing page for wood stoves', date: day(-15), participants: [owner, `Alex (${client})`], message_count: 6, labels: [a.label],
      summary_md: 'Search traffic for wood stoves lands on a general category page. Agreed on a dedicated page with **delivery time and installation options** near the top.',
      decisions: ['Test the new page against the category page for four weeks.'] },
    { id: 'meeting:q4-planning', kind: 'meeting', title: 'Q4 planning and budgets', date: day(-32), time: '14:00 - 15:00', participants: people, message_count: 0, labels, hidden: false,
      summary_md: '- Set the **Q4 targets** per account and agreed on the promotion calendar.\n- Stock of the best sellers is confirmed through the end of the year.',
      decisions: ['Raise budgets from the first week of the peak season if ROAS stays on target.'],
      detail_md: `# Q4 planning and budgets\n\n## Targets\n- ROAS targets stay the same as last quarter.\n- Revenue goals are split per account.\n\n## Calendar\n- Two promotions for ${a.name} and one for ${b.name}.\n- Feed labels for promotion products are set one week ahead.` },
    { ...email, id: 'email:checkout-fix', title: 'Mobile checkout problem', date: day(-51), participants: [owner, `Sam (${client})`], message_count: 5, labels: [a.label],
      summary_md: 'Mobile orders fell after the checkout update, while desktop stayed level. The **payment step** was fixed the same week, and numbers are recovering.',
      decisions: [] },
  ];
  const act = (id: string, source_id: string, title: string, ownerName: string, label: string | null, status: string, created: number, due: number | null = null) => ({ id, source_id, title, owner: ownerName, label, status, created: day(created), due: due === null ? null : day(due) });
  const actions = [
    act('a1', 'meeting:progress-review', 'Move brand budget to Shopping and report back after four weeks', owner, a.label, 'open', -4, 24),
    act('a2', 'meeting:progress-review', 'Send the product list for the seasonal promotion', client, null, 'open', -4, 5),
    act('a3', 'email:feed-fix', 'Add the weekly feed attribute check', client, b.label, 'open', -9, -2),
    act('a4', 'email:feed-fix', 'Check feed approval in Merchant Center', owner, b.label, 'open', -9),
    act('a5', 'email:stove-landing-page', 'Build the wood stove landing page', client, a.label, 'open', -15, 6),
    act('a6', 'email:stove-landing-page', 'Set up the landing page test', owner, a.label, 'open', -15),
    act('a7', 'meeting:q4-planning', 'Prepare the Q4 budget split per campaign', owner, null, 'done', -32),
    act('a8', 'meeting:q4-planning', 'Confirm stock for the best sellers', client, null, 'done', -32),
    act('a9', 'meeting:q4-planning', `Add a third promotion for ${b.name}`, client, b.label, 'dropped', -32),
    act('a10', 'email:checkout-fix', 'Compare tracked conversions with shop orders', owner, a.label, 'done', -51),
  ];
  return { items, actions };
}
