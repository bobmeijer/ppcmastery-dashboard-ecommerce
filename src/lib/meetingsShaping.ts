import { BRAND } from '@/lib/config';

// Pure shaping for the Communication page (meetings and email threads): types, a
// tiny markdown parser (headings, bold/italic, bullets, paragraphs), action-board
// helpers and the next-meeting detector. No React, no server imports; everything is testable.

export type MeetingLabel = string;
export type ActionStatus = 'open' | 'done' | 'dropped';
export type CommunicationKind = 'meeting' | 'email';

// One timeline item: a digest that a digest step wrote from a
// meeting note or an email thread (migration 0004). Raw email text never gets here.
export interface Communication {
  id: string;           // 'meeting:<note file stem>' or 'email:<thread id>'
  kind: CommunicationKind;
  title: string;
  date: string;         // YYYY-MM-DD, meeting date or last message
  time: string;         // "08:33 - 09:21" for meetings, "" for email
  participants: string[];
  summary_md: string;   // digest text
  decisions: string[];
  detail_md: string | null; // meetings: the full note for the fold-out
  message_count: number;
  labels: MeetingLabel[];
  hidden: boolean;      // only admins ever receive hidden items
}

export interface Action {
  id: string;
  source_id: string;
  title: string;
  owner: string; // the account manager, the client, or another name
  due: string | null;
  label: MeetingLabel | null;
  status: ActionStatus;
  created: string; // date of the meeting or email it first came from
}

export interface CommunicationsReport {
  scope: string;
  items: Communication[];
  actions: Action[];
  role: 'admin' | 'client';
}

// ---------------------------------------------------------------- markdown

export type InlineNode = { type: 'text'; text: string } | { type: 'bold'; children: InlineNode[] } | { type: 'italic'; children: InlineNode[] };

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: { text: string; depth: number }[] };

// Notetakers export two flavours: "- " bullets (one per line, nested with four
// spaces) and "•" bullets glued together on a single line. Both become list items.
export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let list: { text: string; depth: number }[] | null = null;
  let paragraph: string[] = [];

  const flushList = () => { if (list && list.length) blocks.push({ type: 'list', items: list }); list = null; };
  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    if (text) blocks.push({ type: 'paragraph', text });
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flushList(); flushParagraph(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (heading) {
      flushList(); flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    const dash = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (dash) {
      flushParagraph();
      list = list || [];
      list.push({ text: dash[2].trim(), depth: Math.min(3, Math.floor(dash[1].length / 4)) });
      continue;
    }

    if (line.trim().startsWith('•')) {
      flushParagraph();
      list = list || [];
      for (const part of line.split('•')) {
        const text = part.trim();
        if (text) list.push({ text, depth: 0 });
      }
      continue;
    }

    // Plain text: continuation of a list item when a list is open, else a paragraph.
    if (list && list.length) { list[list.length - 1].text += ` ${line.trim()}`; continue; }
    paragraph.push(line.trim());
  }
  flushList(); flushParagraph();
  return blocks;
}

// Inline: **bold**, *italic* and _italic_. Unmatched markers fall through as text.
export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  let i = 0;
  let buffer = '';
  const pushText = () => { if (buffer) { out.push({ type: 'text', text: buffer }); buffer = ''; } };

  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        pushText();
        out.push({ type: 'bold', children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
      // "****" or an empty pair: swallow the markers.
      if (end === i + 2) { i = end + 2; continue; }
    }
    const marker = text[i];
    if ((marker === '*' || marker === '_') && !text.startsWith('**', i)) {
      const end = text.indexOf(marker, i + 1);
      const inner = end > i + 1 ? text.slice(i + 1, end) : '';
      const wordBound = marker === '_' ? (i === 0 || /\s|[(\[]/.test(text[i - 1])) : true;
      if (inner && wordBound && !/^\s/.test(inner) && !/\s$/.test(inner)) {
        pushText();
        out.push({ type: 'italic', children: parseInline(inner) });
        i = end + 1;
        continue;
      }
    }
    buffer += text[i];
    i += 1;
  }
  pushText();
  return out;
}

export const inlineToText = (nodes: InlineNode[]): string =>
  nodes.map(n => (n.type === 'text' ? n.text : inlineToText(n.children))).join('');

// Executive summary = the blocks under the "Executive Summary" heading until
// the next heading of the same or higher level. Rest = everything else minus
// the H1 title and the empty "Summary" heading some notetakers emit.
export function splitSummary(md: string): { executive: Block[]; rest: Block[] } {
  const blocks = parseMarkdown(md);
  const executive: Block[] = [];
  const rest: Block[] = [];
  let inExec = false;
  let execLevel = 2;
  for (const block of blocks) {
    if (block.type === 'heading') {
      if (block.level === 1) continue;
      if (/^executive summary$/i.test(block.text)) { inExec = true; execLevel = block.level; continue; }
      if (inExec && block.level <= execLevel) inExec = false;
      if (!inExec && /^summary$/i.test(block.text)) continue;
    }
    (inExec ? executive : rest).push(block);
  }
  return { executive, rest };
}

export const executiveBullets = (md: string): string[] =>
  splitSummary(md).executive.flatMap(b => (b.type === 'list' ? b.items.filter(i => i.depth === 0).map(i => i.text) : b.type === 'paragraph' ? [b.text] : []));

// Strip the emoji notetakers put in front of the title.
export const cleanTitle = (title: string) => title.replace(/^[^\p{L}\p{N}]+/u, '').trim();

// ------------------------------------------------------------------ dates

const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function ageInDays(created: string, today: string): number {
  const a = Date.UTC(+created.slice(0, 4), +created.slice(5, 7) - 1, +created.slice(8, 10));
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function fmtDate(iso: string, withYear = true): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}${withYear ? ` ${y}` : ''}`;
}

// "next progress meeting ... on Tuesday 13 October 2026 at 10:00"
// Scans meetings newest first (digest, then the full note) and returns the first future date it finds.
export function nextMeeting(items: Communication[]): { date: string; time: string | null; source: string } | null {
  const sorted = items.filter(m => m.kind === 'meeting').sort((a, b) => b.date.localeCompare(a.date));
  const re = new RegExp(`next[^.•\\n]{0,120}?(\\d{1,2})\\s+(${MONTHS_EN.join('|')})\\s+(\\d{4})(?:\\s+at\\s+(\\d{1,2}[:.]\\d{2}))?`, 'i');
  for (const m of sorted) {
    const hit = re.exec(m.summary_md) || re.exec(m.detail_md || '');
    if (!hit) continue;
    const month = MONTHS_EN.indexOf(hit[2].toLowerCase()) + 1;
    const date = `${hit[3]}-${String(month).padStart(2, '0')}-${hit[1].padStart(2, '0')}`;
    if (date < m.date) continue;
    return { date, time: hit[4] ? hit[4].replace('.', ':') : null, source: m.id };
  }
  return null;
}

// ------------------------------------------------------------------ board

// Owners on the client side: the client's name from the config, or just its first word.
const firstWord = (text: string) => text.trim().split(/\s+/)[0].toLowerCase();
export const isClientOwner = (owner: string) => firstWord(owner) === firstWord(BRAND.client);
export const isManagerOwner = (owner: string) => owner.trim().toLowerCase() === BRAND.accountManager.toLowerCase();

export function ownerInitials(owner: string): string {
  const o = owner.trim();
  const parts = o.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return o.slice(0, 2).toUpperCase();
}

export type BoardTab = 'open' | 'done' | 'all';

export function filterActions(actions: Action[], scope: string, tab: BoardTab, overrides: Record<string, ActionStatus> = {}): Action[] {
  return actions
    .map(a => ({ ...a, status: overrides[a.id] ?? a.status }))
    .filter(a => !a.label || a.label === scope)
    .filter(a => (tab === 'all' ? true : tab === 'open' ? a.status === 'open' : a.status !== 'open'))
    .sort((a, b) => (a.status === b.status ? a.created.localeCompare(b.created) : a.status === 'open' ? -1 : 1));
}

export function headerCounts(actions: Action[], scope: string, overrides: Record<string, ActionStatus> = {}) {
  const open = filterActions(actions, scope, 'open', overrides);
  return {
    admin: open.filter(a => isManagerOwner(a.owner)).length,
    client: open.filter(a => isClientOwner(a.owner)).length,
    total: open.length,
  };
}
