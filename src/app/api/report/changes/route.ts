import { NextResponse } from 'next/server';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { requireSession } from '@/lib/auth';
import { groupChangeEventsByDay, readChangeEvents } from '@/lib/reports-changes';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/report/changes?scope=all|<label>&start=&end=
// Admin-only: account change history as cause markers for the Trends chart.
export async function GET(request: Request) {
  const session = await requireSession('admin');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || '';
  if (!DATE.test(start) || !DATE.test(end) || start > end) {
    return NextResponse.json({ error: 'start and end (YYYY-MM-DD) are required' }, { status: 400 });
  }
  const accounts = resolveScope(await listAccounts(), url.searchParams.get('scope'));
  const rows = await readChangeEvents(accounts.map(a => a.id), start, end);

  return NextResponse.json({
    scope: url.searchParams.get('scope') || 'all',
    range: { start, end },
    days: groupChangeEventsByDay(rows),
  });
}
