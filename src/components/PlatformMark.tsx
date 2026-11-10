import type { Platform } from '@/lib/platform';

// Small Google Ads / Microsoft marks in their own colours (the only colour in the
// sidebar, on purpose: the platform changes every number on the page). Inline SVG.
export function PlatformMark({ platform, size = 14 }: { platform: Platform; size?: number }) {
  if (platform === 'microsoft') {
    return (
      <svg width={size} height={size} viewBox="0 0 23 23" aria-hidden className="shrink-0">
        <rect x="1" y="1" width="10" height="10" fill="#F25022" /><rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
        <rect x="1" y="12" width="10" height="10" fill="#00A4EF" /><rect x="12" y="12" width="10" height="10" fill="#FFB900" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path d="M8.3 3.2a3.4 3.4 0 0 1 4.6 1.2l7.4 12.8a3.4 3.4 0 1 1-5.9 3.4L7 7.8a3.4 3.4 0 0 1 1.3-4.6z" fill="#4285F4" />
      <path d="M7.3 7.6l5 8.6-3 5.2a3.4 3.4 0 1 1-5.9-3.4z" fill="#FBBC04" />
      <circle cx="6.3" cy="18.1" r="3.4" fill="#34A853" />
    </svg>
  );
}
