import { DEFAULT_SCOPE } from '@/lib/config';
import { NextResponse } from 'next/server';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { platformsFromUrl } from '@/lib/platform';
import { requireSession } from '@/lib/auth';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { filterOptions } from '@/lib/filters';
import { buildQualityReport, QualityTuple, toRow } from '@/lib/qualityShaping';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const list = (v: string | null) => (v || '').split(',').map(s => s.trim()).filter(Boolean);

async function read(ids: string[], start: string, end: string, platforms: string[] | null) {
  const { data, error } = await getSupabaseAdmin().rpc('read_keyword_quality_json', { p_account_ids: ids, p_start_date: start, p_end_date: end, p_platforms: platforms });
  assertOk(error, 'Unable to read keyword quality');
  return ((data || []) as QualityTuple[]).map(toRow);
}

// GET /api/report/quality?scope=&start=&end=[&compareStart=&compareEnd=][&campaigns=&networks=&categories=&brand=0&status=]
// Quality Score page. A year of keyword-days is too much for the
// browser, so the top-bar filters are applied here and only the shaped report
// goes out, plus the filter options from the unfiltered period.
export async function GET(request: Request) {
  const session = await requireSession('client');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || '';
  if (!DATE.test(start) || !DATE.test(end) || start > end) {
    return NextResponse.json({ error: 'start and end (YYYY-MM-DD) are required' }, { status: 400 });
  }
  const compareStart = url.searchParams.get('compareStart');
  const compareEnd = url.searchParams.get('compareEnd');
  const hasCompare = !!compareStart && !!compareEnd && DATE.test(compareStart) && DATE.test(compareEnd) && compareStart <= compareEnd;
  const accounts = resolveScope(await listAccounts(), url.searchParams.get('scope') || DEFAULT_SCOPE);
  const ids = accounts.map(a => a.id);

  const [rows, compareRows] = await Promise.all([
    read(ids, start, end, platformsFromUrl(url)),
    hasCompare ? read(ids, compareStart!, compareEnd!, platformsFromUrl(url)) : Promise.resolve(null),
  ]);
  const filters = {
    campaigns: list(url.searchParams.get('campaigns')),
    networks: list(url.searchParams.get('networks')),
    categories: list(url.searchParams.get('categories')),
    excludeBrand: url.searchParams.get('brand') === '0',
    status: url.searchParams.get('status') || '',
  };
  const report = buildQualityReport({ rows, compareRows, start, end, filters });
  const latest = rows.reduce<string | null>((max, r) => (max === null || r.date > max ? r.date : max), null);

  return NextResponse.json({
    scope: url.searchParams.get('scope') || DEFAULT_SCOPE,
    accounts: accounts.map(a => ({ id: a.id, label: a.label, display_name: a.display_name, lag_days: a.lag_days })),
    range: { start, end },
    compareRange: hasCompare ? { start: compareStart, end: compareEnd } : null,
    options: filterOptions(rows),
    latest,
    report,
    role: session.user.role,
  });
}
