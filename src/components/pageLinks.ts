'use client';

// Links between pages that keep the current scope, period and filters in the
// URL (Products <-> Buckets). `changes` sets or (null) removes keys.
import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

export function useHrefWith() {
  const params = useSearchParams();
  return useCallback((path: string, changes: Record<string, string | null> = {}) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key); else next.set(key, value);
    }
    const query = next.toString();
    return query ? `${path}?${query}` : path;
  }, [params]);
}
