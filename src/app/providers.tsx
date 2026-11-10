'use client';

import { SessionProvider } from 'next-auth/react';
import { Suspense } from 'react';
import { DEMO_MODE, DEMO_SESSION } from '@/lib/demoMode';
import { ScopeProvider } from '@/components/ScopeContext';
import { FreshnessProvider } from '@/components/FreshnessContext';
import { FilterOptionsProvider } from '@/components/FilterOptionsContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider {...(DEMO_MODE ? { session: DEMO_SESSION, refetchOnWindowFocus: false, refetchInterval: 0 } : {})}>
      <Suspense fallback={null}>
        <ScopeProvider><FreshnessProvider><FilterOptionsProvider>{children}</FilterOptionsProvider></FreshnessProvider></ScopeProvider>
      </Suspense>
    </SessionProvider>
  );
}
