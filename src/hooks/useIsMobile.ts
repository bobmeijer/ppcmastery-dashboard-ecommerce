'use client';

import { useEffect, useState } from 'react';

// Below Tailwind's `lg` (1024px) the dashboard switches to its phone layout:
// drawer nav, filters and period in sheets.
export const MOBILE_QUERY = '(max-width: 1023.98px)';

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatch(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return match;
}

export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
// Phones only (Tailwind `sm`): tables hide their secondary columns below this width.
export const useIsPhone = () => useMediaQuery('(max-width: 639.98px)');
