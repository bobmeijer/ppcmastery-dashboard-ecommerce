'use client';

// Chat side panel: labelled as an AI assistant working with
// Admin's approach, never as Admin. The AI analysis of the current view sits on top, the
// conversation below (dock layout C1). The dock renders this body as a
// column on wide screens; narrower screens get it in an overlay behind the launcher.
// Answers come from /api/chat (Sonnet 5.5 with the same data tools as the analysis).
// The conversation lives in ChatProvider, so folding the dock or changing page keeps it;
// "Admin reads along" shows only once the server confirms the chat is logged.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icons';
import { SCOPES, useScope } from '../ScopeContext';
import { fmtDate } from '@/lib/meetingsShaping';
import { SendIcon, SparkIcon } from './AiMarks';
import { readNdjson, useAnalysis } from './AnalysisContext';
import { AnalysisView, useAnalysisStatus } from './AnalysisView';
import { SUGGESTED_QUESTIONS } from './suggestions';
import { DEMO_MODE } from '@/lib/demoMode';
import type { ChatMessage } from './types';

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `t${Date.now()}${Math.random().toString(36).slice(2)}`);

interface ChatValue {
  messages: ChatMessage[];
  thinking: boolean;
  draft: string;           // the answer as it streams in; replaced by the checked answer
  step: string | null;
  logged: boolean;
  ask: (question: string) => void;
  escalate: (id: string) => void;
  rate: (id: string, rating: 1 | -1, note?: string) => void;
}
const ChatContext = createContext<ChatValue | null>(null);
const useChat = () => {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChat outside ChatProvider');
  return value;
};

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { query, insight } = useAnalysis();
  const [threadId] = useState(newId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [logged, setLogged] = useState(false);
  const analysis = insight ? [insight.story.headline, ...insight.story.points.map(p => `- ${p.type === 'interpretation' ? '(interpretation) ' : ''}${p.text}`)].join('\n') : '';

  const ask = useCallback((text: string) => {
    const question = text.trim();
    if (!question || thinking) return;
    const history = messages.map(m => ({ role: m.role, text: m.text }));
    setMessages(m => [...m, { id: newId(), role: 'user', text: question }]);
    setThinking(true);
    setStep(null);
    setDraft('');
    readNdjson<{ answer: string; suggestAdmin: boolean; logged: boolean; questionId: string | null; answerId: string | null }>(`/api/chat?${query}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId, question, history, analysis }),
    }, setStep, { delta: d => setDraft(s => s + d), reset: () => setDraft('') })
      .then(r => {
        setLogged(r.logged);
        setMessages(m => [...m, { id: newId(), role: 'assistant', text: r.answer, suggestAdmin: r.suggestAdmin, questionId: r.questionId, answerId: r.answerId }]);
      })
      .catch(() => setMessages(m => [...m, { id: newId(), role: 'assistant', text: 'Something went wrong fetching an answer. Try again or ask Admin.', suggestAdmin: true }]))
      .finally(() => { setThinking(false); setStep(null); setDraft(''); });
  }, [thinking, messages, query, threadId, analysis]);

  const escalate = useCallback((id: string) => {
    const message = messages.find(m => m.id === id);
    const mark = (patch: Partial<ChatMessage>) => setMessages(m => m.map(x => (x.id === id ? { ...x, ...patch } : x)));
    if (!message?.questionId) { mark({ escalateFailed: true }); return; }
    fetch('/api/chat/escalate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ questionId: message.questionId }) })
      .then(r => mark(r.ok ? { escalated: true, escalateFailed: false } : { escalateFailed: true }))
      .catch(() => mark({ escalateFailed: true }));
  }, [messages]);

  // Useful or not, with an optional note: stored on the answer for the evaluation set.
  const rate = useCallback((id: string, rating: 1 | -1, note?: string) => {
    const message = messages.find(m => m.id === id);
    if (!message?.answerId) return;
    setMessages(m => m.map(x => (x.id === id ? { ...x, rating } : x)));
    fetch('/api/chat/rate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answerId: message.answerId, rating, note }) })
      .then(r => { if (!r.ok) throw new Error(); })
      .catch(() => setMessages(m => m.map(x => (x.id === id ? { ...x, rating: undefined } : x))));
  }, [messages]);

  const value = useMemo(() => ({ messages, thinking, draft, step, logged, ask, escalate, rate }), [messages, thinking, draft, step, logged, ask, escalate, rate]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

function useChatContext() {
  const { scope, range } = useScope();
  const account = SCOPES.find(s => s.value === scope)?.label ?? scope;
  return { account, period: `${fmtDate(range.start, false)} to ${fmtDate(range.end, false)}` };
}

function Rating({ message, onRate }: { message: ChatMessage; onRate: (id: string, rating: 1 | -1, note?: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  if (!message.answerId) return null;
  if (message.rating) return <span className="text-xs text-muted">{message.rating === 1 ? 'Marked as helpful' : 'Marked as not helpful, thank you'}</span>;
  if (asking) {
    return (
      <form className="flex w-full items-center gap-1.5" onSubmit={e => { e.preventDefault(); onRate(message.id, -1, note.trim() || undefined); }}>
        <input autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder="What was wrong? (optional)"
          className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2 py-1 text-xs focus:border-subtle focus:outline-none" aria-label="Comment" />
        <button type="submit" className="text-xs font-medium text-ink hover:underline">Send</button>
      </form>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <button type="button" onClick={() => onRate(message.id, 1)} className="hover:text-ink">Helpful</button>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={() => setAsking(true)} className="hover:text-ink">Not helpful</button>
    </span>
  );
}

function Message({ message, onEscalate, onRate }: { message: ChatMessage; onEscalate: (id: string) => void; onRate: (id: string, rating: 1 | -1, note?: string) => void }) {
  if (message.role === 'user') {
    return <div className="ml-8 self-end whitespace-pre-line rounded-[10px] bg-ink px-3 py-2 text-sm text-paper">{message.text}</div>;
  }
  return (
    <div className="mr-4 space-y-1.5">
      <div className="whitespace-pre-line rounded-[10px] bg-paper-alt px-3 py-2 text-sm text-ink">{message.text}</div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
      {message.escalated
        ? <p className="px-1 text-xs text-muted">Sent to Admin. He will get back to you.</p>
        : message.escalateFailed
          ? <p className="px-1 text-xs text-muted">Could not send this right now. Feel free to email or call Admin directly.</p>
          : <button type="button" onClick={() => onEscalate(message.id)}
              className={message.suggestAdmin ? 'rounded-md border border-ink px-2.5 py-1 text-xs font-medium text-ink hover:bg-ink hover:text-paper' : 'px-1 text-xs font-medium text-muted hover:text-ink'}>
              Ask Admin
            </button>}
      <Rating message={message} onRate={onRate} />
      </div>
    </div>
  );
}

function CollapseIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l6 6-6 6" /><path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function ChatBody({ onClose, onCollapse }: { onClose?: () => void; onCollapse?: () => void }) {
  const context = useChatContext();
  const { messages, thinking, draft, step, logged, ask, escalate, rate } = useChat();
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (onClose) inputRef.current?.focus(); }, [onClose]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, thinking, draft]);
  const send = (text: string) => { if (!thinking && text.trim()) { ask(text); setInput(''); } };

  const conversation = (
    <>
      {messages.length === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted">{DEMO_MODE ? 'Pre-generated answers for this demo. Pick a question below, or connect your own key to ask anything.' : 'Follow up on the analysis or ask your own question about this view. If it is one for Admin, you can ask him directly.'}</p>
          {SUGGESTED_QUESTIONS.map(q => (
            <button key={q} type="button" onClick={() => send(q)} className="block w-full rounded-[10px] border border-line px-3 py-2 text-left text-sm hover:border-subtle">{q}</button>
          ))}
        </div>
      )}
      {messages.map(m => <Message key={m.id} message={m} onEscalate={escalate} onRate={rate} />)}
      {thinking && (draft
        ? <div className="mr-4 whitespace-pre-line rounded-[10px] bg-paper-alt px-3 py-2 text-sm text-ink" aria-live="polite">{draft}</div>
        : (
          <div className="mr-4 flex w-fit items-center gap-1.5 rounded-[10px] bg-paper-alt px-3 py-2 text-sm text-muted" aria-live="polite">
            <SparkIcon size={13} />Thinking...{step && <span className="text-subtle">{step}</span>}
          </div>
        ))}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-ink text-paper"><SparkIcon size={13} /></span>
            AI assistant
          </h2>
          <p className="mt-0.5 text-xs text-muted">Follows Admin&apos;s approach.{logged && ' Admin reads along.'}</p>
        </div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close chat" className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:text-ink"><Icon name="close" size={18} /></button>}
        {onCollapse && <button type="button" onClick={onCollapse} aria-label="Collapse" title="Collapse" className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:text-ink"><CollapseIcon /></button>}
      </header>

      <div className="border-b border-line bg-paper-alt px-4 py-2 text-xs text-muted">
        Looking at <span className="font-medium text-ink">{context.account}</span>, {context.period}
      </div>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="rounded-[10px] border border-line p-3"><AnalysisView /></div>
        {conversation}
      </div>

      <form className="border-t border-line px-3 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        onSubmit={e => { e.preventDefault(); send(input); }}>
        <div className="flex items-end gap-2 rounded-[10px] border border-line px-2 py-1.5 focus-within:border-subtle">
          <textarea ref={inputRef} rows={1} value={input} onChange={e => setInput(e.target.value)} placeholder="Ask about these numbers"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            className="max-h-32 min-h-[2rem] flex-1 resize-none bg-transparent px-1 py-1 text-sm focus:outline-none" aria-label="Question" />
          <button type="submit" disabled={!input.trim() || thinking} aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink text-paper disabled:bg-line disabled:text-subtle"><SendIcon /></button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-subtle">AI answers based on the dashboard data. Decisions and advice stay with Admin.</p>
      </form>
    </div>
  );
}

// Below xl there is no room for the dock: a launcher plus overlay panel instead. The
// launcher shows what the analysis is doing, so nobody has to open the panel to wait.
export function ChatPanel() {
  const { panelOpen: open, setPanelOpen: setOpen, state } = useAnalysis();
  const status = useAnalysisStatus();
  const [seen, setSeen] = useState(false);
  useEffect(() => { if (state !== 'ready') setSeen(false); }, [state]);
  useEffect(() => { if (open && state === 'ready') setSeen(true); }, [open, state]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  const busy = state === 'thinking' || state === 'waiting';
  const dot = busy ? 'var(--gray-400)' : state === 'ready' && !seen ? 'var(--accent)' : null;

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} title={status}
          className={`fixed bottom-4 right-4 z-30 h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-paper shadow-[0_6px_20px_rgba(10,10,10,0.18)] hover:bg-ink-soft inline-flex xl:hidden`}
          style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <SparkIcon />
          {busy ? 'Thinking...' : 'Analysis and questions'}
          {dot && <span className={`h-2 w-2 rounded-full ${busy ? 'animate-pulse' : ''}`} style={{ background: dot }} aria-hidden="true" />}
        </button>
      )}
      {/* Phones: full-height sheet over the page. Desktop: a panel on the right; the page keeps scrolling. */}
      {open && <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} className="sheet-backdrop fixed inset-0 z-40 lg:hidden" />}
      <aside role="dialog" aria-label="AI assistant" aria-hidden={!open}
        className="fixed inset-y-0 right-0 z-50 w-full border-l border-line bg-paper transition-transform duration-200 sm:w-[440px]"
        style={{ transform: open ? 'translateX(0)' : 'translateX(100%)', visibility: open ? 'visible' : 'hidden', transitionProperty: 'transform, visibility',
          boxShadow: open ? '-12px 0 32px rgba(10,10,10,0.10)' : undefined }}>
        {open && <ChatBody onClose={() => setOpen(false)} />}
      </aside>
    </>
  );
}
