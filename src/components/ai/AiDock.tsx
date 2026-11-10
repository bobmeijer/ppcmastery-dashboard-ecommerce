'use client';

// The AI assistant dock: a fixed right column on wide
// screens with the analysis of the current view on top and the chat below. Folds to a
// 48 px rail that keeps the status visible (pulsing while thinking, accent dot when
// ready); open or folded is remembered in this browser.
import { SparkIcon } from './AiMarks';
import { useAnalysis } from './AnalysisContext';
import { ChatBody } from './ChatPanel';
import { useAnalysisStatus } from './AnalysisView';

export function AiDock() {
  const { dockOpen, setDockOpen, state } = useAnalysis();
  const status = useAnalysisStatus();
  const busy = state === 'thinking' || state === 'waiting';
  if (!dockOpen) {
    return (
      <aside className="hidden border-l border-line bg-paper xl:sticky xl:top-0 xl:flex xl:h-screen xl:flex-col xl:items-center" aria-label="AI assistant">
        <button type="button" onClick={() => setDockOpen(true)} title={`${status}. Expand`} aria-label="Expand AI assistant"
          className="flex h-full w-full flex-col items-center gap-3 pt-4 text-muted hover:bg-paper-alt hover:text-ink">
          <span className={`relative flex h-7 w-7 items-center justify-center rounded-full bg-ink text-paper ${busy ? 'animate-pulse' : ''}`}>
            <SparkIcon size={14} />
            {state === 'ready' && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-paper" style={{ background: 'var(--accent)' }} />}
          </span>
          <span className="text-xs font-medium [writing-mode:vertical-rl]">{busy ? 'Thinking...' : 'AI analysis'}</span>
        </button>
      </aside>
    );
  }
  return (
    <aside className="hidden border-l border-line bg-paper xl:sticky xl:top-0 xl:flex xl:h-screen xl:flex-col" aria-label="AI assistant">
      <ChatBody onCollapse={() => setDockOpen(false)} />
    </aside>
  );
}
