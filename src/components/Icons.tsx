// Inline line icons (24x24, stroke 1.75) so the nav needs no icon package.
import type { SVGProps } from 'react';

export type IconName = 'overview' | 'trends' | 'categories' | 'campaigns' | 'networks' | 'buckets' | 'products' | 'countries' | 'devices' | 'feed' | 'auction' | 'meetings' | 'status' | 'logout' | 'columns' | 'grip' | 'tree' | 'quality' | 'users' | 'settings' | 'menu' | 'close' | 'filter' | 'up' | 'down';

const PATHS: Record<IconName, React.ReactNode> = {
  overview: <><rect x="3" y="3" width="8" height="10" rx="1.5" /><rect x="13" y="3" width="8" height="6" rx="1.5" /><rect x="13" y="11" width="8" height="10" rx="1.5" /><rect x="3" y="15" width="8" height="6" rx="1.5" /></>,
  trends: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  categories: <><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9z" /><circle cx="8" cy="8" r="1.2" /></>,
  campaigns: <><path d="M4 11v2a2 2 0 0 0 2 2h2l7 4V5L8 9H6a2 2 0 0 0-2 2z" /><path d="M8 15l1 5h2" /><path d="M18 9a4 4 0 0 1 0 6" /></>,
  networks: <><circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /><path d="M12 7v5" /><path d="M12 12l-6 5" /><path d="M12 12l6 5" /></>,
  buckets: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /><path d="M3 17l9 5 9-5" /></>,
  products: <><path d="M3 8l9-5 9 5v8l-9 5-9-5V8z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" /></>,
  countries: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" /></>,
  devices: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  feed: <><path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1.2" /></>,
  auction: <><path d="M14 4l6 6" /><path d="M9 9l6 6" /><path d="M11 7l6 6" /><path d="M3 21l9-9" /><path d="M16 3l5 5" /></>,
  meetings: <><path d="M4 5h16v11H8l-4 4V5z" /><path d="M8 10l2 2 4-4" /></>,
  status: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>,
  logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 3v18" /></>,
  columns: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="M15 4v16" /></>,
  quality: <><path d="M4 17a8 8 0 1 1 16 0" /><path d="M12 17l4-5" /><circle cx="12" cy="17" r="1.2" /></>,
  tree: <><rect x="2" y="9" width="6" height="6" rx="1.5" /><rect x="16" y="3" width="6" height="6" rx="1.5" /><rect x="16" y="15" width="6" height="6" rx="1.5" /><path d="M8 12h4M12 6v12M12 6h4M12 18h4" /></>,
  menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
  close: <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
  filter: <><path d="M4 6h16" /><path d="M7 12h10" /><path d="M10 18h4" /></>,
  up: <><path d="M6 15l6-6 6 6" /></>,
  down: <><path d="M6 9l6 6 6-6" /></>,
  grip: <><circle cx="9" cy="6" r="1.2" /><circle cx="15" cy="6" r="1.2" /><circle cx="9" cy="12" r="1.2" /><circle cx="15" cy="12" r="1.2" /><circle cx="9" cy="18" r="1.2" /><circle cx="15" cy="18" r="1.2" /></>,
};

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {PATHS[name]}
    </svg>
  );
}
