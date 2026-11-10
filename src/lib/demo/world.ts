import { classifyCampaign } from '../campaignParser';
import { ACCOUNTS, BRAND, CURRENCY } from '../config';
import { addDays, daysBetween, toTime } from './dates';
import { between, hash, noise, round2 } from './random';

// The fictional business behind demo mode: two shops, their campaigns and products, and
// the numbers for any campaign on any day. Everything derives from the seed and from how
// many days ago a date is, so the last 30 days always look the same and the pre-generated
// AI text stays true while the dates move along with today.

export const DEMO_SEED = 20261110;
export const DEMO_ANCHOR = '2026-11-10';   // the day the AI replay was generated for
export const HISTORY_DAYS = 730;

export type Platform = 'google' | 'microsoft';

export interface DemoCampaign {
  account_id: string;
  campaign_id: string;
  campaign_name: string;
  platform: Platform;
  channel_type: string;
  status: string;
  network: string;
  category: string;
  bucket: string;
  parsed: boolean;
  target_roas: number | null;
  target_cpa: number | null;
  spend: number; cpc: number; ctr: number; cvr: number; aov: number;
  firstAge: number;
  lastAge: number;
  impressionShare: number | null;
}

export interface DemoProduct {
  account_id: string;
  item_id: string;
  title: string;
  product_type: string;
  category: string;
  price: number;
  size: string;
  group: string;
  weight: number;
  valueWeight: number;
  rank: number;
  image: string;
}

export interface DayMetrics { impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number; share: number | null; budgetLost: number; rankLost: number }

type CampaignSeed = [name: string, channel: string, spend: number, cpc: number, ctr: number, cvr: number, aov: number, options?: Partial<Pick<DemoCampaign, 'status' | 'firstAge' | 'lastAge' | 'target_roas'>>];

const SHOP_CAMPAIGNS: CampaignSeed[][] = [
  [
    ['01 | Brand', 'SEARCH', 38, 0.34, 0.26, 0.105, 212],
    ['02 | Stoves [H+S]', 'SEARCH', 96, 0.92, 0.062, 0.021, 455, { target_roas: 5 }],
    ['03 | Fire pits', 'SEARCH', 54, 0.74, 0.071, 0.024, 248, { target_roas: 4.5 }],
    ['02 | Planters', 'SEARCH', 42, 0.61, 0.068, 0.027, 132],
    ['03 | Lighting', 'SEARCH', 29, 0.55, 0.074, 0.03, 96],
    ['05 | Stoves [H+S]', 'SHOPPING', 78, 0.58, 0.014, 0.019, 438, { target_roas: 5.5 }],
    ['05 | Planters + Pots [H+S]', 'SHOPPING', 46, 0.42, 0.016, 0.024, 128],
    ['05 | Lighting [V+Z]', 'SHOPPING', 14, 0.31, 0.011, 0.013, 84],
    ['08 | Stoves [H]', 'PERFORMANCE_MAX', 118, 0.66, 0.018, 0.024, 470, { target_roas: 6 }],
    ['08 | Planters + Pots [H+S]', 'PERFORMANCE_MAX', 66, 0.48, 0.02, 0.028, 136, { firstAge: 520 }],
    ['08 | Lighting [S]', 'PERFORMANCE_MAX', 36, 0.4, 0.019, 0.029, 92, { firstAge: 410 }],
    ['04 | Remarketing', 'DISPLAY', 18, 0.28, 0.008, 0.012, 240],
    ['06 | Brand story', 'VIDEO', 11, 0.09, 0.012, 0.002, 210, { firstAge: 300 }],
    ['07 | Stoves [ALL]', 'DEMAND_GEN', 16, 0.31, 0.011, 0.006, 410, { firstAge: 260 }],
    ['Spring test campaign', 'SEARCH', 6, 0.7, 0.05, 0.012, 150, { firstAge: 120 }],
    ['02 | Garden chairs', 'SEARCH', 22, 0.7, 0.05, 0.016, 180, { status: 'REMOVED', lastAge: 380 }],
  ],
  [
    ['01 | Brand', 'SEARCH', 15, 0.29, 0.24, 0.092, 118],
    ['03 | Wall art', 'SEARCH', 24, 0.51, 0.058, 0.021, 142],
    ['05 | Rugs [H+S]', 'SHOPPING', 38, 0.38, 0.015, 0.017, 216, { target_roas: 4.5 }],
    ['05 | Wall art [H+S]', 'SHOPPING', 31, 0.33, 0.017, 0.022, 124],
    ['08 | Rugs [H+S]', 'PERFORMANCE_MAX', 62, 0.42, 0.019, 0.02, 224, { target_roas: 4.5 }],
    ['08 | Wall art [ALL]', 'PERFORMANCE_MAX', 48, 0.37, 0.02, 0.024, 131],
    ['08 | Textiles [ALL]', 'PERFORMANCE_MAX', 27, 0.33, 0.021, 0.026, 71, { firstAge: 460 }],
    ['04 | Remarketing', 'DISPLAY', 9, 0.24, 0.007, 0.011, 135],
  ],
];

const MICROSOFT_PICK = [['01 | Brand', '02 | Stoves [H+S]', '03 | Fire pits', '05 | Stoves [H+S]'], ['01 | Brand', '03 | Wall art', '05 | Rugs [H+S]']];

interface Family { type: string; category: string; nouns: string[]; shape: string; hue: number; price: [number, number] }

const SHOP_FAMILIES: Family[][] = [
  [
    { type: 'stoves > wood stoves', category: 'Stoves', nouns: ['wood stove', 'log burner', 'tent stove'], shape: 'stove', hue: 18, price: [390, 1490] },
    { type: 'stoves > fire pits', category: 'Stoves', nouns: ['fire pit', 'fire pit table', 'patio fire pit'], shape: 'bowl', hue: 28, price: [140, 620] },
    { type: 'stoves > fire bowls', category: 'Stoves', nouns: ['fire bowl', 'fire basket', 'brazier'], shape: 'bowl', hue: 10, price: [90, 390] },
    { type: 'planters + pots > zinc planters', category: 'Planters + Pots', nouns: ['zinc planter', 'trough planter', 'tall planter'], shape: 'pot', hue: 200, price: [60, 260] },
    { type: 'planters + pots > terracotta pots', category: 'Planters + Pots', nouns: ['terracotta pot', 'herb pot', 'bell pot'], shape: 'pot', hue: 22, price: [18, 95] },
    { type: 'planters + pots > raised beds', category: 'Planters + Pots', nouns: ['raised bed', 'corten bed', 'cedar bed'], shape: 'bed', hue: 90, price: [110, 420] },
    { type: 'lighting > solar lanterns', category: 'Lighting', nouns: ['solar lantern', 'path light', 'hanging lantern'], shape: 'lamp', hue: 48, price: [24, 120] },
    { type: 'lighting > wall lights', category: 'Lighting', nouns: ['wall light', 'porch light', 'up and down light'], shape: 'lamp', hue: 40, price: [38, 180] },
    { type: 'lighting > string lights', category: 'Lighting', nouns: ['string light', 'festoon set', 'bulb chain'], shape: 'lamp', hue: 56, price: [22, 90] },
    { type: 'outlet > last chance', category: 'Stoves', nouns: ['display model stove', 'returned fire bowl'], shape: 'stove', hue: 0, price: [80, 520] },
  ],
  [
    { type: 'wall art > canvas prints', category: 'Wall art', nouns: ['canvas print', 'gallery canvas', 'large canvas'], shape: 'frame', hue: 210, price: [45, 240] },
    { type: 'wall art > framed prints', category: 'Wall art', nouns: ['framed print', 'oak framed print', 'botanical print'], shape: 'frame', hue: 130, price: [35, 180] },
    { type: 'wall art > posters', category: 'Wall art', nouns: ['poster', 'art poster', 'poster set'], shape: 'frame', hue: 330, price: [14, 60] },
    { type: 'rugs > wool rugs', category: 'Rugs', nouns: ['wool rug', 'hand tufted rug', 'berber rug'], shape: 'rug', hue: 30, price: [160, 780] },
    { type: 'rugs > runner rugs', category: 'Rugs', nouns: ['runner rug', 'hallway runner', 'jute runner'], shape: 'rug', hue: 45, price: [70, 260] },
    { type: 'rugs > washable rugs', category: 'Rugs', nouns: ['washable rug', 'machine washable rug', 'kitchen rug'], shape: 'rug', hue: 180, price: [65, 340] },
    { type: 'textiles > cushions', category: 'Textiles', nouns: ['cushion', 'linen cushion', 'velvet cushion'], shape: 'cushion', hue: 280, price: [19, 65] },
    { type: 'textiles > throws', category: 'Textiles', nouns: ['throw', 'wool throw', 'waffle throw'], shape: 'cushion', hue: 12, price: [35, 130] },
    { type: 'textiles > curtains', category: 'Textiles', nouns: ['curtain', 'linen curtain', 'blackout curtain'], shape: 'rug', hue: 240, price: [40, 190] },
    { type: 'outlet > last chance', category: 'Rugs', nouns: ['sample rug', 'end of line print'], shape: 'rug', hue: 0, price: [20, 180] },
  ],
];

const ADJECTIVES = ['Harlow', 'Oster', 'Brindle', 'Tamsin', 'Wren', 'Corvin', 'Lowell', 'Maren', 'Quill', 'Sable', 'Thorne', 'Ashby', 'Dunmore', 'Ember', 'Fable', 'Greer', 'Ivo', 'Juno', 'Kestrel', 'Larch'];

function productImage(shape: string, hue: number, tone: number): string {
  const fill = `hsl(${hue},${tone % 40 + 25}%,${tone % 25 + 38}%)`;
  const soft = `hsl(${hue},30%,92%)`;
  const shapes: Record<string, string> = {
    stove: `<rect x="26" y="20" width="36" height="46" rx="3" fill="${fill}"/><rect x="33" y="34" width="22" height="20" rx="2" fill="${soft}"/><rect x="39" y="8" width="10" height="12" fill="${fill}"/>`,
    bowl: `<path d="M18 40h52a26 22 0 0 1-52 0z" fill="${fill}"/><rect x="38" y="62" width="12" height="12" fill="${fill}"/>`,
    pot: `<path d="M24 32h40l-6 42H30z" fill="${fill}"/><rect x="20" y="24" width="48" height="10" rx="2" fill="${fill}"/>`,
    bed: `<rect x="12" y="38" width="64" height="28" rx="2" fill="${fill}"/><path d="M20 38q6-18 12 0m8 0q6-22 12 0m8 0q6-16 10 0" stroke="hsl(110,40%,38%)" stroke-width="4" fill="none"/>`,
    lamp: `<path d="M30 44h28l-6-24H36z" fill="${fill}"/><rect x="41" y="44" width="6" height="26" fill="${fill}"/><rect x="30" y="70" width="28" height="5" rx="2" fill="${fill}"/>`,
    frame: `<rect x="18" y="14" width="52" height="60" fill="#fff" stroke="${fill}" stroke-width="5"/><circle cx="36" cy="36" r="8" fill="${fill}"/><path d="M24 66l16-18 10 10 8-8 8 16z" fill="${fill}" opacity=".7"/>`,
    rug: `<rect x="14" y="20" width="60" height="48" rx="2" fill="${fill}"/><rect x="22" y="28" width="44" height="32" fill="none" stroke="${soft}" stroke-width="3"/>`,
    cushion: `<rect x="20" y="24" width="48" height="42" rx="12" fill="${fill}"/><circle cx="44" cy="45" r="5" fill="${soft}"/>`,
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88"><rect width="88" height="88" fill="${soft}"/>${shapes[shape] ?? shapes.rug}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Monthly level of demand (January first), interpolated between months.
const SEASON = [
  [0.62, 0.66, 0.84, 1.02, 1.14, 1.12, 1.0, 0.86, 0.96, 1.18, 1.32, 0.98],
  [1.08, 0.98, 0.94, 0.88, 0.84, 0.8, 0.82, 0.88, 1.0, 1.12, 1.26, 1.04],
];
const WEEKDAY = [1.12, 1.08, 1.03, 1.0, 0.97, 0.86, 0.94];   // Sunday first

const SHOP_CONVERSION_LEVEL = [0.42, 0.46];   // brings ROAS to a believable level for each shop

export const ACCOUNT_IDS = ['1000000001', '1000000002'];
const PROFILE_COUNT = SHOP_CAMPAIGNS.length;

export const DIP_START = 72;   // first shop: mobile checkout problem, days ago
export const DIP_END = 50;
export const RECOVERED = 31;
export const FEED_START = 39;  // second shop: feed disapprovals, days ago
export const FEED_END = 23;
export const LABEL_EPOCH_DAYS = 14;

const BUCKET_MIX: [string, number, number, number][] = [
  ['heroes', 0.14, 1, 1.7], ['sidekicks', 0.3, 0.55, 1.05], ['villains', 0.2, 0.42, 0.34], ['zombies', 0.36, 0.012, 0.25],
];

export class DemoWorld {
  readonly seed: number;
  readonly today: string;
  readonly shift: number;
  readonly profiles: number[];
  readonly accounts: { id: string; label: string; name: string; lagDays: number; profile: number }[];
  readonly campaigns: DemoCampaign[];
  readonly products: DemoProduct[];
  private cache = new Map<string, DayMetrics | null>();

  constructor(seed = DEMO_SEED, today = new Date().toISOString().slice(0, 10)) {
    this.seed = seed;
    this.today = today;
    this.shift = daysBetween(DEMO_ANCHOR, today);
    this.accounts = ACCOUNTS.slice(0, PROFILE_COUNT).map((a, i) => ({ id: ACCOUNT_IDS[i], label: a.label, name: a.name, lagDays: a.lagDays, profile: i }));
    this.profiles = this.accounts.map(a => a.profile);
    this.campaigns = this.buildCampaigns();
    this.products = this.buildProducts();
  }

  private buildCampaigns(): DemoCampaign[] {
    const all: DemoCampaign[] = [];
    for (const account of this.accounts) {
      const seeds = SHOP_CAMPAIGNS[account.profile];
      seeds.forEach((seed, index) => {
        const google = this.campaign(account.id, seed, 'google', index);
        all.push(google);
        if (MICROSOFT_PICK[account.profile].includes(seed[0])) all.push(this.campaign(account.id, seed, 'microsoft', index));
      });
    }
    return all;
  }

  private campaign(accountId: string, seed: CampaignSeed, platform: Platform, index: number): DemoCampaign {
    const [name, channel, spend, cpc, ctr, cvr, aov, options = {}] = seed;
    const parsed = classifyCampaign(name, channel);
    const microsoft = platform === 'microsoft';
    const searchLike = channel === 'SEARCH' || channel === 'SHOPPING' || channel === 'PERFORMANCE_MAX';
    return {
      account_id: accountId,
      campaign_id: String(20000000000 + hash(`${accountId}${name}${platform}`) % 900000000 + index),
      campaign_name: name,
      platform,
      channel_type: channel,
      status: options.status ?? 'ENABLED',
      network: parsed.network,
      category: parsed.category,
      bucket: parsed.bucket,
      parsed: parsed.parsed,
      target_roas: options.target_roas ?? null,
      target_cpa: null,
      spend: microsoft ? spend * 0.09 : spend,
      cpc: microsoft ? cpc * 0.82 : cpc,
      ctr, cvr, aov,
      firstAge: microsoft ? Math.min(options.firstAge ?? HISTORY_DAYS, 240) : options.firstAge ?? HISTORY_DAYS,
      lastAge: options.lastAge ?? 1,
      impressionShare: searchLike ? between(this.seed, `is${name}${accountId}`, 0.42, 0.78) : null,
    };
  }

  private buildProducts(): DemoProduct[] {
    const products: DemoProduct[] = [];
    for (const account of this.accounts) {
      const prefix = account.profile === 0 ? 'CF' : 'FM';
      const families = SHOP_FAMILIES[account.profile];
      const perFamily = account.profile === 0 ? 20 : 16;
      let number = 1000;
      const list: DemoProduct[] = [];
      families.forEach((family, f) => {
        const count = family.type.startsWith('outlet') ? 6 : perFamily;
        for (let i = 0; i < count; i += 1) {
          number += 1;
          const key = `${account.id}${family.type}${i}`;
          const noun = family.nouns[i % family.nouns.length];
          const name = ADJECTIVES[(i * 7 + f * 3) % ADJECTIVES.length];
          const size = ['small', 'medium', 'large'][i % 3];
          const title = `${name} ${noun}, ${size}`;
          list.push({
            account_id: account.id,
            item_id: `${prefix}-${number}`,
            title,
            product_type: family.type,
            category: family.category,
            price: Math.round(between(this.seed, `price${key}`, family.price[0], family.price[1])) - 0.05,
            size,
            group: family.type.split(' > ')[1],
            weight: (1 / (1 + i) ** 0.85) * between(this.seed, `weight${key}`, 0.5, 1.65),
            valueWeight: between(this.seed, `value${key}`, 0.55, 1.5),
            rank: i,
            image: productImage(family.shape, family.hue, hash(key) % 251),
          });
        }
      });
      products.push(...list);
    }
    return products;
  }

  ageOf(date: string): number { return daysBetween(date, this.today); }

  // Where a day sits in the fixed demo calendar, so seasons and weekdays never change the story.
  private virtual(age: number) { return new Date(toTime(addDays(DEMO_ANCHOR, -age))); }

  private seasonFactor(profile: number, age: number): number {
    const date = this.virtual(age);
    const month = date.getUTCMonth();
    const fraction = (date.getUTCDate() - 1) / 30;
    const table = SEASON[profile];
    return table[month] + (table[(month + 1) % 12] - table[month]) * fraction;
  }

  private profileOf(accountId: string) { return this.accounts.find(a => a.id === accountId)!; }

  dayMetrics(c: DemoCampaign, age: number): DayMetrics | null {
    if (age < 1 || age > HISTORY_DAYS || age > c.firstAge || age < c.lastAge) return null;
    const key = `${c.campaign_id}|${age}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const account = this.profileOf(c.account_id);
    const profile = account.profile;
    const seed = this.seed;
    const n = (name: string) => noise(seed, `${c.campaign_id}${age}${name}`);
    const season = this.seasonFactor(profile, age);
    const weekday = WEEKDAY[this.virtual(age).getUTCDay()];
    const growth = 1 + 0.16 * (1 - age / HISTORY_DAYS);
    const brand = c.category === 'Brand';
    const shoppingLike = c.network === 'Shopping' || c.network === 'PMax';

    let reach = 1;
    let conversionRate = 1;
    if (profile === 0) {
      if (age <= DIP_START && age > DIP_END) conversionRate *= brand ? 0.82 : 0.68;
      else if (age <= DIP_END && age > RECOVERED) conversionRate *= 0.68 + 0.32 * (DIP_END - age) / (DIP_END - RECOVERED);
    }
    if (profile === 1 && shoppingLike && age <= FEED_START && age > FEED_END) reach *= 0.56;
    if (profile === 1 && shoppingLike && age <= FEED_END && age > FEED_END - 6) reach *= 0.56 + 0.44 * (FEED_END - age) / 6;

    const level = season * growth * (0.9 + 0.2 * n('spend'));
    const cost = c.spend * level * weekday * (0.55 + 0.45 * reach);
    const cpc = c.cpc * (0.94 + 0.12 * n('cpc')) * (1 + (season - 1) * 0.18);
    const clicks = Math.max(1, Math.round((cost / cpc) * (0.55 + 0.45 * reach)));
    const ctr = c.ctr * (0.9 + 0.2 * n('ctr'));
    const impressions = Math.round(clicks / ctr);
    const seasonalCvr = 0.9 + (season - 0.8) * 0.28;
    const complete = 1 - (account.lagDays > 10 ? 0.46 : 0.32) * Math.exp(-age / (account.lagDays > 10 ? 7 : 2.4));
    const conversions = clicks * c.cvr * SHOP_CONVERSION_LEVEL[profile] * conversionRate * seasonalCvr * (0.78 + 0.44 * n('cvr')) * complete;
    const value = conversions * c.aov * (0.9 + 0.2 * n('aov'));

    let share: number | null = null;
    let budgetLost = 0;
    let rankLost = 0;
    if (c.impressionShare !== null) {
      share = Math.min(0.95, c.impressionShare * (0.9 + 0.2 * n('share')) * (profile === 1 && shoppingLike && reach < 1 ? 0.72 : 1));
      const lost = 1 - share;
      const budgetPart = c.spend > 60 ? 0.42 : 0.12;
      budgetLost = lost * budgetPart;
      rankLost = lost * (1 - budgetPart);
    }
    const metrics: DayMetrics = { impressions, clicks, cost: round2(cost), conversions: round2(conversions), conversions_value: round2(value), share, budgetLost, rankLost };
    this.cache.set(key, metrics);
    return metrics;
  }

  // A product's bucket can change every two weeks, as a real label feed does.
  bucketOf(p: DemoProduct, age: number): string {
    const position = this.bucketPosition(p);
    const epoch = Math.floor(age / LABEL_EPOCH_DAYS);
    const drift = noise(this.seed, `${p.item_id}drift${epoch}`);
    let cumulative = 0;
    const adjusted = drift > 0.84 ? Math.min(0.99, position + 0.18) : position;
    for (const [name, share] of BUCKET_MIX) {
      cumulative += share;
      if (adjusted < cumulative) return name;
    }
    return 'zombies';
  }

  private bucketPosition(p: DemoProduct) { return (noise(this.seed, `${p.item_id}bucket`) * 0.35 + (p.rank / 22) * 0.65); }

  productsFor(c: DemoCampaign): DemoProduct[] {
    if (c.network !== 'Shopping' && c.network !== 'PMax') return [];
    return this.products.filter(p => p.account_id === c.account_id && p.category === c.category);
  }

  // How a campaign's day splits over its products in a bucket mix.
  productShares(c: DemoCampaign, age: number): { product: DemoProduct; bucket: string; cost: number; value: number; reach: number }[] {
    const epoch = Math.floor(age / LABEL_EPOCH_DAYS);
    const key = `${c.campaign_id}|${epoch}`;
    const known = this.shareCache.get(key);
    if (known) return known;
    const base = this.productsFor(c).map(product => {
      const bucket = this.bucketOf(product, age);
      const mix = BUCKET_MIX.find(b => b[0] === bucket)!;
      return { product, bucket, cost: product.weight * mix[2], value: product.weight * mix[2] * mix[3] * product.valueWeight, reach: product.weight * mix[2] };
    });
    const totalCost = base.reduce((s, b) => s + b.cost, 0) || 1;
    const totalValue = base.reduce((s, b) => s + b.value, 0) || 1;
    const out = base.map(b => ({ ...b, cost: b.cost / totalCost, value: b.value / totalValue, reach: b.cost / totalCost }));
    this.shareCache.set(key, out);
    return out;
  }
  private shareCache = new Map<string, { product: DemoProduct; bucket: string; cost: number; value: number; reach: number }[]>();

  accountRow(a: DemoWorld['accounts'][number]) {
    return {
      id: a.id, label: a.label, display_name: a.name, login_customer_id: '9000000000', merchant_id: `200000000${a.profile + 1}`,
      currency: CURRENCY, lag_days: a.lagDays, enabled: true, created_at: '2024-01-15T09:00:00.000Z',
      msads_account_id: `30000000${a.profile + 10}`, msads_customer_id: '300000000',
    };
  }

  get client() { return BRAND.client; }
}
