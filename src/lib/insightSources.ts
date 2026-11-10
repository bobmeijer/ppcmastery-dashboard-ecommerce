// "Source" per point of the AI analysis: every tool result gets a
// reference the model cites per point ([T3] for a data table, [T3.2] for one audit
// finding, note or meeting line), and each cited reference becomes a source the reader can
// open: the dashboard page with that period and filter, or the finding itself. Pure, so it
// is tested without the model.

export type Source =
  | { kind: 'data'; label: string; path?: string; params?: Record<string, string> }
  | { kind: 'context'; source: string; date: string | null; text: string };

export interface ToolCall { name: string; input: Record<string, unknown>; text: string }

// Tools whose result is a list of findings or meetings: each line can be cited on its own.
const LINE_TOOLS = new Set(['account_context', 'communication']);

export function citeResult(n: number, name: string, text: string): string {
  if (!LINE_TOOLS.has(name)) return `[T${n}]\n${text}`;
  return text.split('\n').map((line, i) => `[T${n}.${i + 1}] ${line}`).join('\n');
}

const SOURCE_NAMES: Record<string, string> = {
  'daily-note': "the account manager's daily note", 'business context': 'Business context', 'standing notes': 'Standing notes',
  'diagnosis-log': 'Diagnosis log', 'conversion-settings': 'Conversion settings',
  'feed-auditor': 'Feed audit', 'keyword-auditor': 'Keyword audit', 'pmax-auditor': 'PMax audit',
  'competitive-auditor': 'Competitor audit', 'search-term-auditor': 'Search term audit', 'lp-auditor': 'Landing page audit',
  'account-auditor': 'Account audit', 'placement-auditor': 'Placement audit', 'budget-auditor': 'Budget audit',
  'quality-score-auditor': 'Quality Score audit', 'bidding-auditor': 'Bidding audit', 'tracking-auditor': 'Tracking audit',
  'tracking-specialist': 'Tracking analysis', 'geo-schedule-auditor': 'Location and schedule audit', 'ad-copy-auditor': 'Ad copy audit',
  'offer-auditor': 'Offer audit', 'strategy-auditor': 'Strategy audit',
};
export const sourceName = (s: string) => SOURCE_NAMES[s] ?? s;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const period = (input: Record<string, unknown>) =>
  ISO.test(String(input.start)) && ISO.test(String(input.end)) ? `${fmtDate(String(input.start))} to ${fmtDate(String(input.end))}` : '';

const DATA: Record<string, { label: (i: Record<string, unknown>) => string; path?: (i: Record<string, unknown>) => string }> = {
  campaign_data: {
    label: i => `Campaign data${{ total: '', network: ' per network', campaign: ' per campaign', week: ' per week', day: ' per day' }[String(i.group_by)] ?? ''}`,
    path: i => (i.group_by === 'week' || i.group_by === 'day' ? '/trends' : '/campaigns'),
  },
  device_data: { label: () => 'Devices', path: () => '/devices' },
  country_data: { label: () => 'Countries', path: () => '/countries' },
  product_movers: { label: () => 'Products', path: () => '/products' },
  feed_status: { label: () => 'Merchant Center feed', path: () => '/feed' },
  quality_scores: { label: () => 'Quality Score', path: () => '/quality-score' },
  auction_insights: { label: i => `Auction insights ${i.network === 'Shopping' ? 'Shopping' : 'Search'}`, path: () => '/auction' },
  change_history: { label: () => 'Change history (the account manager only)' },
};

function dataSource(call: ToolCall): Source | null {
  const d = DATA[call.name];
  if (!d) return null;
  const when = period(call.input);
  const network = typeof call.input.network === 'string' && call.name !== 'auction_insights' ? call.input.network : null;
  const campaign = typeof call.input.campaign === 'string' && call.input.campaign.trim() ? `campaigns containing "${call.input.campaign.trim()}"` : null;
  const label = [d.label(call.input), network, campaign, when].filter(Boolean).join(', ');
  if (!d.path) return { kind: 'data', label };
  const params: Record<string, string> = when ? { preset: 'custom', start: String(call.input.start), end: String(call.input.end) } : {};
  if (network) params.networks = network;
  return { kind: 'data', label, path: d.path(call.input), params };
}

// account_context: "[source, 2026-10-21, covering a to b, severity] claim Evidence: ..."
// communication: "2026-10-14 meeting "Title": summary Decisions: ..."
function contextSource(line: string): Source {
  const finding = /^\[([^,\]]+), (\d{4}-\d{2}-\d{2})(?:, covering [^,\]]+)?, [^\]]+\] ([\s\S]*)$/.exec(line);
  if (finding) return { kind: 'context', source: sourceName(finding[1]), date: finding[2], text: finding[3] };
  const meeting = /^(\d{4}-\d{2}-\d{2}) (meeting|email) "([^"]*)": ([\s\S]*)$/.exec(line);
  if (meeting) return { kind: 'context', source: `${meeting[2] === 'meeting' ? 'Meeting' : 'Email'} "${meeting[3]}"`, date: meeting[1], text: meeting[4] };
  return { kind: 'context', source: 'Note', date: null, text: line };
}

// The cited references of one point as sources, deduplicated, unknown ids dropped.
// calls[n - 1] is the call cited as T<n>.
export function resolveSources(refs: string[], calls: ToolCall[]): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const m = /^\[?T(\d+)(?:\.(\d+))?\]?$/.exec(ref.trim());
    if (!m) continue;
    const call = calls[Number(m[1]) - 1];
    if (!call) continue;
    let source: Source | null;
    if (LINE_TOOLS.has(call.name)) {
      const line = m[2] ? call.text.split('\n')[Number(m[2]) - 1] : undefined;
      source = line ? contextSource(line) : null;
    } else {
      source = dataSource(call);
    }
    if (!source) continue;
    const key = JSON.stringify(source);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out.slice(0, 4);
}
