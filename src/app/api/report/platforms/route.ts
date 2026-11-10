import { DEFAULT_SCOPE } from '@/lib/config';
import { NextResponse } from 'next/server';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { requireSession } from '@/lib/auth';
import type { Platform } from '@/lib/platform';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// GET /api/report/platforms?scope=<label>
// The platforms that have campaign facts for the label. The sidebar shows the
// platform switch only when Microsoft is among them, so a label whose Microsoft
// account has no campaigns yet gets it with its first spend.
export async function GET(request: Request) {
  const session = await requireSession('client');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const ids = resolveScope(await listAccounts(), url.searchParams.get('scope') || DEFAULT_SCOPE).map(a => a.id);
  const supabase = getSupabaseAdmin();
  const platforms: Platform[] = ['google'];
  if (ids.length) {
    const { data, error } = await supabase.from('ads_campaign_daily').select('fact_date')
      .in('account_id', ids).eq('platform', 'microsoft').limit(1);
    assertOk(error, 'Unable to read platforms');
    if (data && data.length) platforms.push('microsoft');
  }
  return NextResponse.json({ platforms });
}
