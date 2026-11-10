// Stored analyses (migration 0008): one per view, so a view opened on another Vercel
// instance or after a deploy is instant, and the account manager's edit or withdrawal holds. A fully
// matured period (its end before the matured date) is "stable" and keeps its analysis
// and the account manager's edit across days; a running period gets a new one each day.
import 'server-only';
import { createHash } from 'node:crypto';
import { getSupabaseAdmin } from './supabaseAdmin';
import { DEMO_MODE } from './demoMode';
import type { View } from './insightView';
import type { Source } from './insightSources';

export type Role = 'admin' | 'client';
export interface Story { headline: string; points: { text: string; type: 'fact' | 'interpretation'; link?: { path: string; params?: Record<string, string> }; sources?: Source[] }[] }
export type InsightStatus = 'auto' | 'approved' | 'hidden';

export interface StoredInsight {
  key: string;
  story: Story;            // the account manager's edit when there is one, else the generated story
  status: InsightStatus;
  source: string;
  model: string | null;
  generatedAt: string;
}

export function viewKey(page: string, v: View, role: Role, contextVersion: string) {
  const day = v.range.end <= v.maturedEnd ? 'stable' : v.today;
  const view = { page, platform: v.platform, range: v.range, compareRange: v.compareRange, filters: v.filters, day, contextVersion };
  // The demo has one pre-generated analysis per account, whatever the view.
  const parts = DEMO_MODE ? ['demo-replay', v.account.id, role] : [v.account.id, role, view];
  return { key: createHash('sha256').update(JSON.stringify(parts)).digest('hex'), view };
}

type Row = { key: string; story: Story; edited_story: Story | null; status: InsightStatus; source: string; model: string | null; generated_at: string };
const toStored = (r: Row): StoredInsight => ({ key: r.key, story: r.edited_story ?? r.story, status: r.status, source: r.source, model: r.model, generatedAt: r.generated_at });

export async function readInsight(key: string): Promise<StoredInsight | null> {
  const { data, error } = await getSupabaseAdmin().from('ai_insights').select('key, story, edited_story, status, source, model, generated_at').eq('key', key).maybeSingle();
  if (error) { console.error(`insight store: ${error.message}`); return null; }
  return data ? toStored(data as Row) : null;
}

// A fresh run replaces the generated story but keeps the account manager's edit and status.
export async function saveInsight(row: { key: string; accountLabel: string; role: Role; view: Record<string, unknown>; story: Story; source: string; model: string | null; costUsd: number }): Promise<StoredInsight> {
  const { data, error } = await getSupabaseAdmin().from('ai_insights').upsert({
    key: row.key, account_label: row.accountLabel, role: row.role, view: row.view, story: row.story, source: row.source, model: row.model,
    generated_at: new Date().toISOString(), cost_usd: row.costUsd,
  }, { onConflict: 'key' }).select('key, story, edited_story, status, source, model, generated_at').single();
  if (error) {
    console.error(`insight store: ${error.message}`);
    return { key: row.key, story: row.story, status: 'auto', source: row.source, model: row.model, generatedAt: new Date().toISOString() };
  }
  await pruneInsights(row.accountLabel);
  return toStored(data as Row);
}

// Every filter combination is its own view, so rows pile up. Unedited analyses older than
// 60 days go; the account manager's edits and withdrawals stay (they feed readCorrections).
const KEEP_DAYS = 60;
async function pruneInsights(accountLabel: string) {
  const before = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
  const { error } = await getSupabaseAdmin().from('ai_insights').delete()
    .eq('account_label', accountLabel).is('edited_at', null).lt('generated_at', before);
  if (error) console.error(`insight store prune: ${error.message}`);
}

// the account manager only: an edited story makes the label "Reviewed analysis"; hidden withdraws it for the client.
export async function editInsight(key: string, patch: { status?: InsightStatus; story?: Story; note?: string }, by: string): Promise<StoredInsight | null> {
  const update: Record<string, unknown> = { edited_by: by, edited_at: new Date().toISOString() };
  if (patch.note !== undefined) update.edit_note = patch.note || null;
  if (patch.story) { update.edited_story = patch.story; update.status = 'approved'; }
  if (patch.status) update.status = patch.status;
  const { data, error } = await getSupabaseAdmin().from('ai_insights').update(update).eq('key', key)
    .select('key, story, edited_story, status, source, model, generated_at').maybeSingle();
  if (error) { console.error(`insight store: ${error.message}`); return null; }
  return data ? toStored(data as Row) : null;
}

// the account manager's recent corrections for an account, as examples for the analysis and the chat
//: what the AI wrote, what the account manager made of it (or that he withdrew it) and
// his note on what to learn. Only the client versions: that is what the account manager edits.
// For a client reader the withdrawn analyses are left out entirely: what
// he took back must never reach a client prompt, not even as a counter-example.
export async function readCorrections(accountLabel: string, role: Role, limit = 8): Promise<string> {
  let query = getSupabaseAdmin().from('ai_insights')
    .select('story, edited_story, status, edit_note, edited_at')
    .eq('account_label', accountLabel).eq('role', 'client').not('edited_at', 'is', null);
  if (role === 'client') query = query.neq('status', 'hidden');
  const { data, error } = await query.order('edited_at', { ascending: false }).limit(limit);
  if (error || !data?.length) return '';
  const text = (s: Story | null) => (s ? [s.headline, ...s.points.map(p => `- ${p.text}`)].join('\n') : '');
  return (data as { story: Story; edited_story: Story | null; status: InsightStatus; edit_note: string | null; edited_at: string }[]).map((r, i) => [
    `Correction ${i + 1} (${r.edited_at.slice(0, 10)}):`,
    `AI wrote:\n${text(r.story)}`,
    r.status === 'hidden' ? 'the account manager withdrew this analysis.' : r.edited_story ? `the account manager changed it to:\n${text(r.edited_story)}` : '',
    r.edit_note ? `the account manager's lesson: ${r.edit_note}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}
