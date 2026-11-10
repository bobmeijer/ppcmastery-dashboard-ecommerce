'use client';

// Admin-only finding block. Rendered only for the admin role; the server never sends `finding` to the client role.
import { useSession } from 'next-auth/react';
import type { BeVsNlFinding } from '@/lib/geoShaping';

export function AdminNote({ finding }: { finding: BeVsNlFinding | null }) {
  const { data: session } = useSession();
  if (session?.user?.role !== 'admin' || !finding) return null;
  return (
    <section className="card p-4 lg:p-5" style={finding.flagged ? { borderColor: 'var(--warn)' } : undefined}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold tracking-tight">Note BE versus NL</h2>
          <span className="eyebrow">Admin only</span>
        </div>
        <span className="text-xs font-medium" style={{ color: finding.flagged ? 'var(--warn)' : 'var(--gray-500)' }}>
          {finding.flagged ? 'Deviation' : 'No deviation'}
        </span>
      </header>
      <p className="mt-2 text-sm">{finding.text}</p>
    </section>
  );
}
