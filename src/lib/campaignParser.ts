import { config } from '@/lib/config';
import type { NetworkName } from '../../dashboard.config';

// Campaign name to classification, using the scheme in dashboard.config.ts. The example names follow
//   "NN | Category [bucket] <variant>"
// where NN encodes the network and the bracket holds ProductHero buckets.
// Pure function: tested in campaignParser.test.ts. Hand overrides live in the
// campaign_overrides table and win at upsert time.

export type Network = NetworkName;

export interface CampaignClassification {
  network: Network;
  category: string;
  bucket: string;
  parsed: boolean;
}

const { prefixNetwork: PREFIX_NETWORK, categoryAliases: CATEGORY_ALIASES, pattern: NAME_PATTERN } = config.campaignNames;
const BUCKET_TOKENS = new Set(config.campaignNames.bucketTokens);

const CHANNEL_NETWORK: Record<string, Network> = {
  SEARCH: 'Search',
  SHOPPING: 'Shopping',
  PERFORMANCE_MAX: 'PMax',
  DISPLAY: 'Display',
  DEMAND_GEN: 'Demand Gen',
  DISCOVERY: 'Demand Gen',
  VIDEO: 'Video',
  '2': 'Search', '3': 'Display', '4': 'Shopping', '6': 'Video', '10': 'PMax', '12': 'Demand Gen', '14': 'Demand Gen',
};


export function networkFromChannelType(channelType: string | number | undefined | null): Network {
  const key = String(channelType ?? '').toUpperCase();
  return CHANNEL_NETWORK[key] || 'Other';
}

export function normaliseCategory(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  const alias = CATEGORY_ALIASES[cleaned.toLowerCase()];
  return alias || cleaned;
}

export function normaliseBucket(raw: string | undefined): string {
  if (!raw) return '';
  const tokens = raw.split(/[+\-/,]/).map(t => t.trim().toUpperCase()).filter(Boolean);
  const known = tokens.filter(t => BUCKET_TOKENS.has(t));
  if (known.length === 0) return raw.trim();
  // "Boost - Feeder" collapses to Boost; H+S+V keeps its order.
  if (known.includes('BOOST')) return 'Boost';
  if (known.includes('ALL')) return 'All';
  return known.map(t => t[0]).join('+');
}

export function classifyCampaign(name: string, channelType?: string | number | null): CampaignClassification {
  const fallbackNetwork = networkFromChannelType(channelType);
  const match = NAME_PATTERN.exec(name || '');
  if (!match) {
    return { network: fallbackNetwork, category: 'Other', bucket: '', parsed: false };
  }
  const [, prefix, rawCategory, rawBucket] = match;
  // Display, Video and Demand Gen campaigns are unambiguous by channel type and win over
  // the prefix: "03 | Display" is a Display campaign, "04 | YouTube" a Video one.
  const channelWins = fallbackNetwork === 'Display' || fallbackNetwork === 'Video' || fallbackNetwork === 'Demand Gen';
  const network = channelWins ? fallbackNetwork : PREFIX_NETWORK[prefix] || fallbackNetwork;
  const category = normaliseCategory(rawCategory);
  return { network, category, bucket: normaliseBucket(rawBucket), parsed: true };
}
