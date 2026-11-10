import type { IconName } from './Icons';
import type { ModuleKey } from '../../dashboard.config';
import { accountHidesPage, moduleEnabled } from '@/lib/config';

interface NavEntry { href: string; label: string; icon: IconName; group: string; adminOnly?: boolean; soon?: boolean; module?: ModuleKey }

// Grouped by the question a page answers, with hairlines between groups and no headings.
// Status is housekeeping, not a report, and sits small under the list (group 'Admin').
// A disabled module's pages disappear here and return not found in the middleware.
const ALL_PAGES: NavEntry[] = [
  { href: '/', label: 'Overview', icon: 'overview', group: 'Analysis' },
  { href: '/trends', label: 'Trends', icon: 'trends', group: 'Analysis' },
  { href: '/metric-tree', label: 'Metric tree', icon: 'tree', group: 'Analysis' },
  { href: '/campaigns', label: 'Campaigns', icon: 'campaigns', group: 'Spend' },
  { href: '/categories', label: 'Categories', icon: 'categories', group: 'Spend' },
  { href: '/products', label: 'Products', icon: 'products', group: 'Products' },
  { href: '/buckets', label: 'Buckets', icon: 'buckets', group: 'Products' },
  { href: '/feed', label: 'Feed status', icon: 'feed', group: 'Products', module: 'feedStatus' },
  { href: '/quality-score', label: 'Quality Score', icon: 'quality', group: 'Auction and quality', module: 'qualityScore' },
  { href: '/auction', label: 'Auction insights', icon: 'auction', group: 'Auction and quality', module: 'auctionInsights' },
  { href: '/countries', label: 'Countries', icon: 'countries', group: 'Audience' },
  { href: '/devices', label: 'Devices', icon: 'devices', group: 'Audience' },
  { href: '/meetings', label: 'Communication', icon: 'meetings', group: 'Collaboration', module: 'communications' },
  { href: '/status', label: 'Status', icon: 'status', group: 'Admin', adminOnly: true },
];

export const NAV = ALL_PAGES.filter(item => !item.module || moduleEnabled(item.module));

export const pageAvailable = (href: string, scope: string) =>
  !((href === '/buckets' || href === '/quality-score') && accountHidesPage(scope, href));

export const pageTitle = (pathname: string) =>
  (NAV.find(item => (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href))) || NAV[0]).label;
