'use client';

// Settings section: Users and Status left the sidebar and sit
// behind the admin-only gear next to logout; these tabs switch between them.
import { usePathname, useRouter } from 'next/navigation';

export const ADMIN_TABS = [
  { href: '/users', label: 'Users' },
  { href: '/status', label: 'Status' },
];

export const isAdminPath = (pathname: string) => ADMIN_TABS.some(t => pathname.startsWith(t.href));

export function AdminTabs() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <nav className="segmented" aria-label="Settings">
      {ADMIN_TABS.map(tab => (
        <button key={tab.href} type="button" aria-pressed={pathname.startsWith(tab.href)}
          onClick={() => router.push(tab.href)}>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
