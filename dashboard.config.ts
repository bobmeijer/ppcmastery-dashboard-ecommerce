// One file to make this dashboard yours: brand, accounts, money and dates, how campaign
// names are read, and which modules are on. This is an example, so change anything.
// Ask your LLM when a change reaches further than this file.
//
// This file also ships to the browser, where anyone can read it, even without logging in.
// Never put secrets, targets or competitor lists in it. Secrets belong in environment
// variables, private settings per account in dashboard.server.ts, goals in the targets table.
//
// Data that changes per client decision stays in database tables: targets, conversion
// roles, campaign overrides and the accounts themselves. `label` below must match
// accounts.label in the database.

export type ModuleKey =
  | 'microsoftAds'
  | 'feedStatus'
  | 'auctionInsights'
  | 'changeHistory'
  | 'qualityScore'
  | 'communications'
  | 'ai';

export type NetworkName = 'Search' | 'Shopping' | 'PMax' | 'Display' | 'Demand Gen' | 'Video' | 'Other';

export type OptionalPage = '/buckets' | '/quality-score';

export interface AccountConfig {
  label: string;                       // short id, used in URLs and in the database
  name: string;                        // shown in the interface and to the AI
  logo?: string;                       // path under public/, the name is shown when empty
  lagDays: number;                     // days before conversions are considered complete
  hiddenPages?: OptionalPage[];        // pages that make no sense for this account
  categoriesFromProductTypes?: boolean; // one campaign per account: use product types as categories
}

export interface DashboardConfig {
  brand: {
    name: string;                      // browser title and login page
    description: string;
    client: string;                    // who the dashboard is for, as shown in the interface
    accountManager: string;            // action owner name for the person running the account
  };
  accounts: AccountConfig[];           // the first account is the default
  currency: string;                    // ISO 4217 code
  locale: string;                      // BCP 47 tag for numbers and dates
  timeZone: string;                    // IANA name, decides where a day starts
  campaignNames: {
    pattern: RegExp;                   // groups: 1 network prefix, 2 category, 3 bucket
    prefixNetwork: Record<string, NetworkName>;
    categoryAliases: Record<string, string>; // lower-case spelling to one label
    bucketTokens: string[];
  };
  modules: Record<ModuleKey, boolean>;
}

const config: DashboardConfig = {
  brand: {
    name: 'PPC dashboard',
    description: 'Google Ads reporting dashboard',
    client: 'Demo Group',
    accountManager: 'Admin',
  },

  accounts: [
    { label: 'shopa', name: 'Cinderfold', lagDays: 21 },
    { label: 'shopb', name: 'Fennmoor', lagDays: 7, categoriesFromProductTypes: true },
  ],

  currency: 'EUR',
  locale: 'en-GB',
  timeZone: 'Europe/Amsterdam',

  // Example scheme: "08 | Category [H+S]". A name that does not match falls back to the
  // channel type and the category Other. If your names look nothing like this, this is
  // the first thing to change.
  campaignNames: {
    pattern: /^\s*(\d{2})\s*\|\s*([^\[<]+?)\s*(?:\[([^\]]*)\])?\s*(?:<([^>]*)>)?\s*$/,
    prefixNetwork: {
      '01': 'Search',
      '02': 'Search',
      '03': 'Search',
      '04': 'Display',
      '05': 'Shopping',
      '06': 'Video',
      '07': 'Demand Gen',
      '08': 'PMax',
    },
    categoryAliases: {
      stoves: 'Stoves',
      'fire pits': 'Stoves',
      'fire pit': 'Stoves',
      'planters + pots': 'Planters + Pots',
      planters: 'Planters + Pots',
      'planters and pots': 'Planters + Pots',
      lighting: 'Lighting',
      lamps: 'Lighting',
      'lamps / lighting': 'Lighting',
      competitors: 'Competitors',
      brand: 'Brand',
    },
    bucketTokens: ['H', 'S', 'V', 'Z', 'ALL', 'BOOST', 'FEEDER'],
  },

  // Core pages are always on. These are off until you connect what they need.
  modules: {
    microsoftAds: false,
    feedStatus: false,
    auctionInsights: false,
    changeHistory: false,
    qualityScore: false,
    communications: false,
    ai: false,
  },
};

export default config;
