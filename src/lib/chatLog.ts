// Chat log (migration 0007): every question and answer, so Admin reads along, and the
// "Ask Admin" flag. Logging never blocks the chat: when the table is missing or a
// write fails, the chat still answers and the panel does not claim that Admin reads along.
import 'server-only';
import { getSupabaseAdmin } from './supabaseAdmin';

export interface LogEntry {
  threadId: string;
  userEmail: string;
  role: 'user' | 'assistant';
  accountLabel: string;
  view: Record<string, unknown>;
  text: string;
  source?: string;
}

// Returns the new row id, or null when nothing was stored.
export async function logChat(e: LogEntry): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().from('chat_messages').insert({
    thread_id: e.threadId, user_email: e.userEmail, role: e.role, account_label: e.accountLabel, view: e.view, text: e.text, source: e.source ?? null,
  }).select('id').single();
  if (error) { console.error(`chat log: ${error.message}`); return null; }
  return (data as { id: string }).id;
}

export interface Escalation {
  question: string;
  answer: string | null;
  accountLabel: string;
  view: Record<string, unknown>;
  userEmail: string;
  askedAt: string;
}

// Only the reader's own questions can be put to Admin, and each one once: the flag is set only
// while it is empty, so repeated clicks or scripted calls send one mail. Returns the
// question with the answer that followed it, for the mail to Admin; 'already' when it was
// flagged before; null when nothing was flagged.
export async function escalateChat(id: string, userEmail: string): Promise<Escalation | 'already' | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('chat_messages').update({ escalated_at: new Date().toISOString() })
    .eq('id', id).eq('user_email', userEmail).eq('role', 'user').is('escalated_at', null)
    .select('thread_id, text, account_label, view, created_at');
  if (error) { console.error(`chat escalate: ${error.message}`); return null; }
  const q = (data ?? [])[0] as { thread_id: string; text: string; account_label: string; view: Record<string, unknown>; created_at: string } | undefined;
  if (!q) {
    const { data: before } = await db.from('chat_messages').select('id')
      .eq('id', id).eq('user_email', userEmail).eq('role', 'user').not('escalated_at', 'is', null).limit(1);
    return before?.length ? 'already' : null;
  }
  const { data: next } = await db.from('chat_messages').select('text').eq('thread_id', q.thread_id).eq('role', 'assistant')
    .gt('created_at', q.created_at).order('created_at').limit(1);
  return { question: q.text, answer: (next?.[0] as { text: string } | undefined)?.text ?? null, accountLabel: q.account_label, view: q.view, userEmail, askedAt: q.created_at };
}

// A reader rates an answer they got: useful (1) or not (-1), with an optional note.
// Only their own answers; the raw material for the evaluation set.
export async function rateChat(answerId: string, userEmail: string, rating: 1 | -1, note: string | null): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().from('chat_messages').update({ rating, rating_note: note, rated_at: new Date().toISOString() })
    .eq('id', answerId).eq('user_email', userEmail).eq('role', 'assistant').select('id');
  if (error) { console.error(`chat rate: ${error.message}`); return false; }
  return (data ?? []).length === 1;
}
