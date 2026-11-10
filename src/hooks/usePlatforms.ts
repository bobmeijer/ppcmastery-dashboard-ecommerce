'use client';

import { moduleEnabled } from '@/lib/config';
import { useEffect, useState } from 'react';
import type { Platform } from '@/lib/platform';

const GOOGLE_ONLY: Platform[] = ['google'];

// Platforms with data per account label (see /api/report/platforms); Google until the answer is in.
export function usePlatforms(labels: string[]): Record<string, Platform[]> {
  const [platforms, setPlatforms] = useState<Record<string, Platform[]>>({});
  useEffect(() => {
    if (!moduleEnabled('microsoftAds')) return;
    let cancelled = false;
    for (const scope of labels) {
      fetch(`/api/report/platforms?${new URLSearchParams({ scope }).toString()}`)
        .then(response => (response.ok ? response.json() : { platforms: GOOGLE_ONLY }))
        .then(body => { if (!cancelled) setPlatforms(all => ({ ...all, [scope]: body.platforms || GOOGLE_ONLY })); })
        .catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [labels]);
  return Object.fromEntries(labels.map(label => [label, platforms[label] ?? GOOGLE_ONLY]));
}
