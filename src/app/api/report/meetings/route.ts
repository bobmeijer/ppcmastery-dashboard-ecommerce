import { DEFAULT_SCOPE, isAccountLabel } from '@/lib/config';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { Action, Communication, CommunicationsReport, MeetingLabel } from '@/lib/meetingsShaping';

export const dynamic = 'force-dynamic';

// GET /api/report/meetings?scope=<label>
// Items cover the whole business and come back for both labels; actions tagged with a
// label are filtered to it in read_communications_json. Hidden items reach admins only.
export async function GET(request: Request) {
  const session = await requireSession('client');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const requested = url.searchParams.get('scope');
  const scope: MeetingLabel = isAccountLabel(requested) ? requested : DEFAULT_SCOPE;
  const admin = session.user.role === 'admin';
  const { data, error } = await getSupabaseAdmin().rpc('read_communications_json', { p_label: scope, p_include_hidden: admin });
  assertOk(error, 'read_communications_json');

  const body: CommunicationsReport = {
    scope,
    items: (data?.items ?? []) as Communication[],
    actions: (data?.actions ?? []) as Action[],
    role: admin ? 'admin' : 'client',
  };
  return NextResponse.json(body);
}
