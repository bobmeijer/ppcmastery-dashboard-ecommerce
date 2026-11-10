'use client';

import { moduleEnabled } from '@/lib/config';
import { DEMO_MODE } from '@/lib/demoMode';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Icon } from './Icons';
import { NAV, pageAvailable, pageTitle } from './nav';
import { AccountPicker } from './AccountPicker';
import { BrandLogo } from './BrandLogo';
import { isAdminPath } from './AdminTabs';
import { ScopeBar } from './ScopeBar';
import { useScope } from './ScopeContext';
import { ChatPanel, ChatProvider } from './ai/ChatPanel';
import { AnalysisProvider, useAnalysis } from './ai/AnalysisContext';
import { AiDock } from './ai/AiDock';


function initials(name?: string | null) {
  return (name || '?').split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-paper">{initials(name)}</span>;
}

function Footer() {
  const { data: session } = useSession();
  const name = session?.user?.name || session?.user?.email || '';
  const logout = () => signOut({ callbackUrl: '/login' });
  // Settings: admins only, next to logout; opens user management.
  const isAdmin = session?.user?.role === 'admin';
  const inSettings = isAdminPath(usePathname());
  return (
    <div className="mt-auto -mx-4 -mb-5">
      {DEMO_MODE && <p className="px-4 pb-2 text-xs text-muted">Demo: all shops and numbers are fictional.</p>}
      <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-sm">
        <Avatar name={name} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {isAdmin && <Link href="/users" title="Settings" aria-label="Settings" aria-current={inSettings ? 'page' : undefined}
          className={inSettings ? 'text-ink' : 'text-muted hover:text-ink'}><Icon name="settings" size={16} /></Link>}
        {!DEMO_MODE && <button type="button" title="Log out" aria-label="Log out" className="text-muted hover:text-ink" onClick={logout}><Icon name="logout" size={16} /></button>}
      </div>
    </div>
  );
}

function useNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const { scope } = useScope();
  const query = params.toString();
  const items = NAV.filter(item => (!item.adminOnly || isAdmin) && pageAvailable(item.href, scope)).map(item => ({
    ...item,
    href: query ? `${item.href}?${query}` : item.href,
    active: item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
  }));
  return { items };
}

type NavItem = ReturnType<typeof useNav>['items'][number];

const NavLink = ({ item, showLabel = true, small = false }: { item: NavItem; showLabel?: boolean; small?: boolean }) => (
  <Link href={item.href} className="nav-link" data-active={item.active} aria-disabled={item.soon} title={showLabel ? undefined : item.label}
    style={{ opacity: item.soon ? 0.45 : undefined, justifyContent: showLabel ? undefined : 'center', padding: showLabel ? (small ? '0.3rem 0.75rem' : undefined) : '0.6rem', fontSize: small ? 12 : undefined }}>
    <Icon name={item.icon} size={small ? 14 : undefined} />
    {showLabel && <span>{item.label}</span>}
    {showLabel && item.soon && <span className="ml-auto text-[10px] uppercase tracking-wide">M2</span>}
  </Link>
);


// Grouped sidebar: account picker on top, then the nav groups
// from nav.ts with hairlines and no headings. 'Admin' (Status, Users) is not in the
// list: it sits behind the settings gear in the footer.
function SidebarContent({ items }: { items: NavItem[] }) {
  const main = items.filter(i => i.group !== 'Admin');
  const groups = [...new Set(main.map(i => i.group))];
  return (
    <>
      <div className="mb-5"><AccountPicker /></div>
      <nav className="min-h-0 overflow-y-auto">
        {groups.map((group, index) => (
          <div key={group} className={index > 0 ? 'mt-2 border-t border-line pt-2' : ''}>
            <div className="flex flex-col gap-0.5">{main.filter(i => i.group === group).map(item => <NavLink key={item.href} item={item} />)}</div>
          </div>
        ))}
      </nav>
      <Footer />
    </>
  );
}

// Phones and tablets: the sidebar stacked a full screen of
// navigation above every page. Below lg it is a drawer behind a menu button in a compact
// sticky top bar with the page title and the label logo.
function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  const { scope } = useScope();
  const title = pageTitle(usePathname());
  return (
    <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-paper/95 px-2 backdrop-blur lg:hidden">
      <button type="button" onClick={onMenu} aria-label="Open menu" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink hover:bg-paper-alt">
        <Icon name="menu" size={20} />
      </button>
      <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{title}</h1>
      <button type="button" onClick={onMenu} aria-label="Choose account" className="flex h-10 shrink-0 items-center rounded-md px-2">
        <BrandLogo scope={scope} height={18} maxWidth={120} />
      </button>
    </div>
  );
}

function Drawer({ open, onClose, items }: { open: boolean; onClose: () => void; items: NavItem[] }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [open, onClose]);
  return (
    <div className="lg:hidden" aria-hidden={!open}>
      <button type="button" tabIndex={open ? 0 : -1} aria-label="Close menu" onClick={onClose}
        className="sheet-backdrop fixed inset-0 z-40 transition-opacity duration-200" style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }} />
      <aside role="dialog" aria-modal="true" aria-label="Menu"
        className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,86vw)] flex-col bg-paper px-4 pt-4 pb-5 transition-transform duration-200"
        style={{ transform: open ? 'translateX(0)' : 'translateX(-100%)', visibility: open ? 'visible' : 'hidden', transitionProperty: 'transform, visibility', boxShadow: open ? '12px 0 32px rgba(10,10,10,0.12)' : undefined }}>
        <SidebarContent items={items} />
      </aside>
    </div>
  );
}

// The AI analysis runs app-wide for the current data view, so the provider wraps the
// whole shell; the dock and the narrow-screen panel read the same run. Without the AI
// module none of it is mounted.
export function Shell({ children }: { children: React.ReactNode }) {
  if (!moduleEnabled('ai')) return <ShellLayout dockOpen={null}>{children}</ShellLayout>;
  return <AnalysisProvider><ChatProvider><DockedLayout>{children}</DockedLayout></ChatProvider></AnalysisProvider>;
}

function DockedLayout({ children }: { children: React.ReactNode }) {
  const { dockOpen } = useAnalysis();
  return <ShellLayout dockOpen={dockOpen}>{children}</ShellLayout>;
}

function ShellLayout({ children, dockOpen }: { children: React.ReactNode; dockOpen: boolean | null }) {
  const { items } = useNav();
  const pathname = usePathname();
  const params = useSearchParams().toString();
  const [menu, setMenu] = useState(false);
  // Any navigation (page or account switch) closes the drawer.
  useEffect(() => { setMenu(false); }, [pathname, params]);
  return (
    <div className={`min-h-screen lg:grid lg:grid-cols-[264px_1fr] ${dockOpen === null ? '' : dockOpen ? 'xl:grid-cols-[264px_1fr_400px]' : 'xl:grid-cols-[264px_1fr_48px]'}`}>
      <aside className="hidden flex-col border-r border-line bg-paper px-4 py-5 lg:sticky lg:top-0 lg:flex lg:h-screen">
        <SidebarContent items={items} />
      </aside>
      <MobileTopBar onMenu={() => setMenu(true)} />
      <Drawer open={menu} onClose={() => setMenu(false)} items={items} />
      <div className="min-w-0">
        <ScopeBar />
        <main className="page-reveal mx-auto w-full max-w-[1320px] px-3 py-4 sm:px-4 lg:px-8 lg:py-6">{children}</main>
      </div>
      {dockOpen !== null && <AiDock />}
      {dockOpen !== null && <ChatPanel />}
    </div>
  );
}
