'use client';

// The AI analysis as app-wide state: it runs in the background for the
// current data view (account, period, comparison, filters), not per page, so moving
// between pages never starts a new run. A view change waits a moment before it starts,
// so clicking through filters does not fire a run per click. Shown in the dock (wide
// screens) and in the overlay panel behind the launcher (narrower screens).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useScope } from '../ScopeContext';
import type { Insight } from './types';

const DOCK_KEY = 'ai-dock-open';
const SETTLE_MS = 900;

export type AnalysisState = 'waiting' | 'thinking' | 'ready' | 'hidden' | 'error';

interface AnalysisValue {
  query: string;   // the data view as a query string, shared with the chat
  state: AnalysisState;
  steps: string[];
  insight: Insight | null;
  source: 'ai' | 'fallback' | 'demo' | null;
  error: string | null;
  refresh: () => void;
  update: (patch: { status?: Insight['status']; story?: Insight['story']; note?: string }) => void;
  asClient: boolean;                    // Admin: show (and edit) exactly what the client sees
  setAsClient: (v: boolean) => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  dockOpen: boolean;
  setDockOpen: (open: boolean) => void;
}

const AnalysisContext = createContext<AnalysisValue | null>(null);

export function useAnalysis() {
  const value = useContext(AnalysisContext);
  if (!value) throw new Error('useAnalysis outside AnalysisProvider');
  return value;
}

// The view as a query string: the analysis key. Pages are not part of it.
function useViewQuery() {
  const { scope, platform, range, compare, compareRange, filters } = useScope();
  return useMemo(() => {
    const params = new URLSearchParams({ page: 'overview', scope, start: range.start, end: range.end, compare });
    if (compareRange) { params.set('compareStart', compareRange.start); params.set('compareEnd', compareRange.end); }
    if (filters.campaigns.length) params.set('campaigns', filters.campaigns.join(','));
    if (filters.networks.length) params.set('networks', filters.networks.join(','));
    if (filters.categories.length) params.set('categories', filters.categories.join(','));
    if (platform === 'microsoft') params.set('platform', 'microsoft');
    if (filters.excludeBrand) params.set('brand', '0');
    if (filters.status) params.set('status', filters.status);
    return params.toString();
  }, [scope, platform, range, compare, compareRange, filters]);
}

// Reads an NDJSON stream (analysis and chat): step lines while the agent works, text
// deltas while the chat writes (a reset discards them), then one result line.
export async function readNdjson<T>(url: string, init: RequestInit, onStep: (step: string) => void, onText?: { delta: (text: string) => void; reset: () => void }): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const l of lines.filter(Boolean)) {
      const msg = JSON.parse(l);
      if (msg.step) onStep(msg.step);
      if (msg.delta) onText?.delta(msg.delta);
      if (msg.reset) onText?.reset();
      if (msg.error) throw new Error(msg.error);
      if (msg.result) return msg.result as T;
    }
    if (done) throw new Error('Analysis aborted');
  }
}

export function AnalysisProvider({ children }: { children: React.ReactNode }) {
  const query = useViewQuery();
  const [state, setState] = useState<AnalysisState>('waiting');
  const [steps, setSteps] = useState<string[]>([]);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [asClient, setAsClient] = useState(false);
  const [source, setSource] = useState<'ai' | 'fallback' | 'demo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dockOpen, setDockOpenState] = useState(true);

  // Open or folded to the rail: a per-viewer convenience in this browser.
  useEffect(() => {
    try { if (window.localStorage.getItem(DOCK_KEY) === '0') setDockOpenState(false); } catch { /* storage blocked: open */ }
  }, []);
  const setDockOpen = useCallback((open: boolean) => {
    setDockOpenState(open);
    try { window.localStorage.setItem(DOCK_KEY, open ? '1' : '0'); } catch { /* storage blocked */ }
  }, []);

  // A new view clears the old analysis; a refresh of the same view keeps it until the new one is in.
  const lastQuery = useRef(`${query}${asClient}`);
  useEffect(() => {
    const controller = new AbortController();
    if (lastQuery.current !== `${query}${asClient}`) { setInsight(null); lastQuery.current = `${query}${asClient}`; }
    setState('waiting');
    setSteps([]);
    setError(null);
    // Let the view settle: several filter clicks in a row start one run.
    const timer = window.setTimeout(() => {
      setState('thinking');
      readNdjson<{ insight: Insight | null; source: 'ai' | 'fallback' | 'demo' }>(`/api/insights?${query}${asClient ? '&as=client' : ''}${run > 0 ? '&fresh=1' : ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: controller.signal }, step => setSteps(s => [...s, step]))
        // A withdrawn analysis comes back empty for the client: nothing to show.
        .then(body => { setInsight(body.insight); setSource(body.source); setState(body.insight ? 'ready' : 'hidden'); })
        .catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); setState('error'); } });
    }, run > 0 ? 0 : SETTLE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, run, asClient]);

  const refresh = useCallback(() => setRun(r => r + 1), []);
  // Admin's edit or withdrawal: shown at once, stored on the server (PATCH /api/insights).
  const update = useCallback((patch: { status?: Insight['status']; story?: Insight['story']; note?: string }) => {
    setInsight(current => {
      if (!current) return current;
      const { note: _note, ...shown } = patch;   // the note is stored, not shown
      void _note;
      const next = { ...current, ...shown, ...(patch.story ? { status: 'approved' as const } : {}) };
      fetch('/api/insights', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: current.id, ...patch }) })
        .then(r => { if (!r.ok) throw new Error(`Save failed (${r.status})`); })
        .catch(e => { setInsight(current); setError(e instanceof Error ? e.message : String(e)); });
      return next;
    });
  }, []);

  const value = useMemo<AnalysisValue>(() => ({ query, state, steps, insight, source, error, refresh, update, asClient, setAsClient, panelOpen, setPanelOpen, dockOpen, setDockOpen }),
    [query, state, steps, insight, source, error, refresh, update, asClient, panelOpen, dockOpen, setDockOpen]);
  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}
