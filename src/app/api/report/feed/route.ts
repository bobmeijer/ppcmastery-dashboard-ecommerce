import { NextResponse } from 'next/server';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { requireSession } from '@/lib/auth';
import { readFeedSnapshot } from '@/lib/reports-feed';

export const dynamic = 'force-dynamic';

// GET /api/report/feed?scope=<label>
// The feed status is a snapshot (latest sync), not a period report, so start/end are not needed.
export async function GET(request: Request) {
  const session = await requireSession('client');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = session.user.role === 'admin';

  const url = new URL(request.url);
  const scope = url.searchParams.get('scope');
  const accounts = resolveScope(await listAccounts(), scope);
  if (accounts.length !== 1) {
    return NextResponse.json({ error: 'scope must name one account label' }, { status: 400 });
  }
  const account = accounts[0];

  const snapshot = await readFeedSnapshot(account);
  if (!snapshot) return NextResponse.json({ error: `No feed data for ${account.display_name}` }, { status: 404 });

  // Audit scores are part of the Admin-only layer.
  const visible = isAdmin ? snapshot : { ...snapshot, audit: null };

  return NextResponse.json({
    scope: account.label,
    account: { id: account.id, label: account.label, display_name: account.display_name, lag_days: account.lag_days, merchant_id: account.merchant_id },
    snapshot: visible,
    role: session.user.role,
  });
}
