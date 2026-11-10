import type { ModuleKey } from '../../dashboard.config';

// Which optional module owns a page or an API path. Pure, so middleware can use it.

export type ModuleSwitches = Record<ModuleKey, boolean>;
export type Gate = 'open' | 'not-found' | 'skip';

const PATHS: [string, ModuleKey][] = [
  ['/feed', 'feedStatus'],
  ['/auction', 'auctionInsights'],
  ['/quality-score', 'qualityScore'],
  ['/meetings', 'communications'],
  ['/api/report/feed', 'feedStatus'],
  ['/api/report/auction', 'auctionInsights'],
  ['/api/report/quality', 'qualityScore'],
  ['/api/report/changes', 'changeHistory'],
  ['/api/report/meetings', 'communications'],
  ['/api/insights', 'ai'],
  ['/api/chat', 'ai'],
];

const CRONS: [string, ModuleKey][] = [
  ['/api/cron/microsoft-ads', 'microsoftAds'],
  ['/api/cron/feed', 'feedStatus'],
  ['/api/cron/auction', 'auctionInsights'],
  ['/api/cron/insights', 'ai'],
];

const GOOGLE_DATASETS: Record<string, ModuleKey> = { quality: 'qualityScore', changes: 'changeHistory' };

const matches = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
const owner = (list: [string, ModuleKey][], pathname: string) => list.find(([prefix]) => matches(pathname, prefix))?.[1] ?? null;

export function moduleForCron(pathname: string, search: URLSearchParams): ModuleKey | null {
  if (matches(pathname, '/api/cron/google-ads')) return GOOGLE_DATASETS[search.get('dataset') ?? ''] ?? null;
  return owner(CRONS, pathname);
}

// A disabled module's pages and API routes do not exist, and its crons do nothing.
export function moduleGate(pathname: string, search: URLSearchParams, switches: ModuleSwitches, demo = false): Gate {
  if (matches(pathname, '/api/cron')) {
    if (demo) return 'skip';   // the demo never syncs
    const cron = moduleForCron(pathname, search);
    return cron && !switches[cron] ? 'skip' : 'open';
  }
  const key = owner(PATHS, pathname);
  return key && !switches[key] ? 'not-found' : 'open';
}
