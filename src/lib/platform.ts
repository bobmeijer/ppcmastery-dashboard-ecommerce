import { moduleEnabled } from '@/lib/config';

// Ad platform: Google Ads and Microsoft Ads share the fact
// tables (column platform) but are never shown together: every view is one
// platform, Google by default. Goals and targets belong to Google only.
// Travels in the URL as ?platform=microsoft (absent = google) and reaches the
// read functions as p_platforms.

export type Platform = 'google' | 'microsoft';

export const parsePlatform = (value: string | null | undefined): Platform => (value === 'microsoft' ? 'microsoft' : 'google');

export const platformsFromUrl = (url: URL): Platform[] => [parsePlatform(url.searchParams.get('platform'))];

// Targets (goals, ROAS floor) are Google Ads targets.
export const targetsApply = (platform: Platform) => platform === 'google';

export const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: 'google', label: 'Google Ads' },
  ...(moduleEnabled('microsoftAds') ? [{ value: 'microsoft' as const, label: 'Microsoft Ads' }] : []),
];

// Pages whose data only exists for Google (Merchant feed, auction insights from the Report Editor).
export const GOOGLE_ONLY_PATHS = ['/feed', '/auction'];
export const isGoogleOnlyPath = (pathname: string) => GOOGLE_ONLY_PATHS.some(p => pathname.startsWith(p));
