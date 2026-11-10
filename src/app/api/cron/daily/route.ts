import { NextResponse } from 'next/server';
import config from '../../../../../dashboard.config';
import { isCronRequest } from '@/lib/requestGuards';
import { DailyHandler, dailySteps, hasTimeLeft } from '@/lib/sync/dailyPlan';
import { GET as googleAds } from '../google-ads/route';
import { GET as microsoftAds } from '../microsoft-ads/route';
import { GET as feed } from '../feed/route';
import { GET as auction } from '../auction/route';
import { GET as insights } from '../insights/route';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const HANDLERS: Record<DailyHandler, (request: Request) => Promise<Response>> = {
  'google-ads': googleAds,
  'microsoft-ads': microsoftAds,
  feed,
  auction,
  insights,
};

// GET /api/cron/daily
// The one scheduled job. It runs every enabled sync in turn, so a single daily schedule is
// enough. Steps that do not fit in the time limit are listed under "skipped" and are picked
// up by the next run, because each step re-reads a window of recent days.
export async function GET(request: Request) {
  if (!isCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const startedAt = Date.now();
  const origin = new URL(request.url).origin;
  const authorization = request.headers.get('authorization') as string;
  const results: { step: string; status: number }[] = [];
  const skipped: string[] = [];

  for (const step of dailySteps(config.modules)) {
    const name = `${step.handler}${step.query ? `?${step.query}` : ''}`;
    if (!hasTimeLeft(Date.now() - startedAt)) {
      skipped.push(name);
      continue;
    }
    const url = `${origin}/api/cron/${name}`;
    const response = await HANDLERS[step.handler](new Request(url, { headers: { authorization } }));
    results.push({ step: name, status: response.status });
  }

  const ok = results.every(result => result.status < 400) && skipped.length === 0;
  return NextResponse.json({ ok, seconds: Math.round((Date.now() - startedAt) / 1000), results, skipped }, { status: ok ? 200 : 500 });
}
