// Parses a Google Ads auction insights report (Report Editor, segmented by
// campaign and day) into rows for publish_auction_insights. The same parser
// reads the scheduled Google Sheet (string cells from the Sheets API) and the
// CSV backfill (parseCsv first). Pure, no I/O.
//
// Layout: a manual Report Editor export has a title row and a date-range row
// ("October 9, 2026 - October 15, 2026") above the header; the nightly
// scheduled sheet starts with the header on row 1. Without the date-range row
// the span is the first to last day in the data. Search reports carry
// "Display URL domain" and six metrics; Shopping reports carry "Store display
// name" and three. The account itself is the competitor "You".

export type AuctionNetwork = 'Search' | 'Shopping';

export interface ParsedAuctionRow {
  date: string;                       // ISO day
  campaign: string;
  competitor: string;                 // domain (Search), store name (Shopping) or "You"
  impression_share: number | null;    // fraction; 0.10 ceiling when is_capped
  is_capped: boolean;                 // Google printed "< 10%"
  overlap_rate: number | null;
  position_above_rate: number | null;
  top_of_page_rate: number | null;
  abs_top_rate: number | null;
  outranking_share: number | null;
}

export interface ParsedAuctionReport {
  network: AuctionNetwork;
  span: { start: string; end: string } | null;   // the report's date range (row 2), else min / max day
  rows: ParsedAuctionRow[];
  skipped: number;                                // data rows without a usable day, campaign or competitor
  duplicates: number;                             // repeated day x campaign x competitor rows, dropped
}

// Header text per field. Matched case-insensitively on the start of the header,
// so "Search Impr. share (Auction Insights)" matches "search impr. share".
const COLUMNS = {
  campaign: ['campaign'],
  day: ['day'],
  competitor: ['display url domain', 'store display name'],
  impression_share: ['search impr. share', 'shopping impr. share'],
  overlap_rate: ['search overlap rate', 'shopping overlap rate'],
  position_above_rate: ['position above rate'],
  top_of_page_rate: ['top of page rate'],
  abs_top_rate: ['abs. top of page rate'],
  outranking_share: ['search outranking share', 'shopping outranking share'],
} as const;
type Field = keyof typeof COLUMNS;

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');

// "October 9, 2026" -> "2026-10-09"; ISO passes through; anything else is null.
export function parseReportDate(text: string): string | null {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(Number(m[2]))}`;
  return null;
}

// Percent cell to fraction. "--" and empty are null. "< 10%" is the 0.10
// ceiling (capped); "> 90%" is read as 0.90. Accepts "12.5%", "12,5%", "12%".
export function parsePercent(cell: string | undefined): { value: number | null; capped: boolean } {
  const t = (cell ?? '').trim();
  if (!t || t === '--') return { value: null, capped: false };
  if (/^<\s*10\s*%$/.test(t)) return { value: 0.1, capped: true };
  const m = t.replace(/^>\s*/, '').replace('%', '').trim().replace(/\s/g, '');
  const normalised = m.includes(',') && !m.includes('.') ? m.replace(',', '.') : m.replace(/,/g, '');
  const n = Number(normalised);
  return Number.isFinite(n) ? { value: Math.round(n * 100) / 10000, capped: false } : { value: null, capped: false };
}

function findHeader(values: string[][]): { index: number; columns: Partial<Record<Field, number>>; network: AuctionNetwork } | null {
  for (let i = 0; i < Math.min(values.length, 10); i++) {
    const cells = values[i].map(c => c.trim().toLowerCase());
    if (!cells.includes('campaign') || !cells.includes('day')) continue;
    const columns: Partial<Record<Field, number>> = {};
    for (const field of Object.keys(COLUMNS) as Field[]) {
      const idx = cells.findIndex(c => COLUMNS[field].some(prefix => (field === 'campaign' || field === 'day' ? c === prefix : c.startsWith(prefix))));
      if (idx >= 0) columns[field] = idx;
    }
    const network: AuctionNetwork = cells.some(c => c.startsWith('shopping impr. share')) ? 'Shopping' : 'Search';
    return { index: i, columns, network };
  }
  return null;
}

// The date-range row Google writes above the header: "October 9, 2026 - October 15, 2026".
function findSpan(values: string[][], headerIndex: number): { start: string; end: string } | null {
  for (let i = 0; i < headerIndex; i++) {
    const text = values[i].join(' ').replace(/"/g, '').trim();
    const parts = text.split(/\s+-\s+/);
    if (parts.length === 2) {
      const start = parseReportDate(parts[0]);
      const end = parseReportDate(parts[1]);
      if (start && end) return { start, end };
    }
  }
  return null;
}

export function parseAuctionReport(values: string[][]): ParsedAuctionReport {
  const header = findHeader(values);
  if (!header) throw new Error('No auction insights header row found (expected "Campaign" and "Day" columns)');
  const { columns: col, network } = header;
  if (col.competitor === undefined || col.impression_share === undefined) {
    throw new Error('Auction insights header is missing the competitor or impression share column');
  }
  const cell = (row: string[], field: Field) => (col[field] === undefined ? undefined : row[col[field]!]);
  const pct = (row: string[], field: Field) => parsePercent(cell(row, field)).value;

  // Keyed like the table's primary key: a repeated key in one batch fails the whole
  // publish ("ON CONFLICT ... cannot affect row a second time", the 17 and 18 Oct
  // 2026 runs). Two Shopping stores can share a display name; keep the bigger one.
  const byKey = new Map<string, ParsedAuctionRow>();
  let skipped = 0;
  let duplicates = 0;
  let min: string | null = null;
  let max: string | null = null;
  for (const row of values.slice(header.index + 1)) {
    if (row.every(c => !c || !c.trim())) continue;
    const date = parseReportDate(cell(row, 'day') ?? '');
    const campaign = (cell(row, 'campaign') ?? '').trim();
    const competitor = (cell(row, 'competitor') ?? '').trim();
    if (!date || !campaign || !competitor) { skipped++; continue; }
    const share = parsePercent(cell(row, 'impression_share'));
    const parsed: ParsedAuctionRow = {
      date, campaign, competitor,
      impression_share: share.value, is_capped: share.capped,
      overlap_rate: pct(row, 'overlap_rate'),
      position_above_rate: pct(row, 'position_above_rate'),
      top_of_page_rate: pct(row, 'top_of_page_rate'),
      abs_top_rate: pct(row, 'abs_top_rate'),
      outranking_share: pct(row, 'outranking_share'),
    };
    const key = `${date}|${campaign}|${competitor}`;
    const seen = byKey.get(key);
    if (seen) {
      duplicates++;
      if ((parsed.impression_share ?? -1) <= (seen.impression_share ?? -1)) continue;
    }
    byKey.set(key, parsed);
    if (!min || date < min) min = date;
    if (!max || date > max) max = date;
  }
  const span = findSpan(values, header.index) ?? (min && max ? { start: min, end: max } : null);
  return { network, span, rows: [...byKey.values()], skipped, duplicates };
}

// Minimal RFC 4180 CSV reader: quoted fields, doubled quotes, CRLF. Enough for
// Google Ads exports; no BOM sniffing beyond stripping a leading U+FEFF.
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); out.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); out.push(row); }
  return out;
}
