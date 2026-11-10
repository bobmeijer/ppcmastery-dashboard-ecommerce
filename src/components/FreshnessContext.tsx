'use client';

// Pages report the latest fact date they rendered; the top bar shows it.
import { createContext, useContext, useEffect, useState } from 'react';

const FreshnessContext = createContext<{ value: string | null; set: (v: string | null) => void }>({ value: null, set: () => {} });

export function FreshnessProvider({ children }: { children: React.ReactNode }) {
  const [value, set] = useState<string | null>(null);
  return <FreshnessContext.Provider value={{ value, set }}>{children}</FreshnessContext.Provider>;
}

export const useFreshness = () => useContext(FreshnessContext).value;

export function useSetFreshness(value: string | null) {
  const { set } = useContext(FreshnessContext);
  useEffect(() => { set(value); }, [value, set]);
}
