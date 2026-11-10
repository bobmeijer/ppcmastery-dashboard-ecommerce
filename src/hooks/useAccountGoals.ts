'use client';

import { useEffect, useState } from 'react';
import type { AccountGoals } from '@/lib/accountGoals';

// undefined while loading, null when the account has no revenue and ROAS goals.
export function useAccountGoals(label: string | null | undefined): AccountGoals | null | undefined {
  const [result, setResult] = useState<{ label: string; goals: AccountGoals | null } | null>(null);

  useEffect(() => {
    if (!label) return;
    let current = true;
    fetch(`/api/report/goals?scope=${encodeURIComponent(label)}`)
      .then(response => (response.ok ? response.json() : { goals: null }))
      .catch(() => ({ goals: null }))
      .then((body: { goals: AccountGoals | null }) => { if (current) setResult({ label, goals: body.goals }); });
    return () => { current = false; };
  }, [label]);

  if (!label) return null;
  return result?.label === label ? result.goals : undefined;
}
