import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { isCronRequest } from '@/lib/requestGuards';
import { readDataCoverage, readSyncStatus, readUnparsedCampaigns } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    const session = await requireSession('admin');
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const [runs, unparsed, coverage] = await Promise.all([readSyncStatus(), readUnparsedCampaigns(), readDataCoverage()]);
  return NextResponse.json({ runs, unparsed, coverage, now: new Date().toISOString() });
}
