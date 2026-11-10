import { requestGate } from '@/lib/config';
import { DEMO_MODE } from '@/lib/demoMode';
import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

const PUBLIC_PATHS = ['/login'];
const ADMIN_PATHS = ['/status', '/users', '/api/sync', '/api/admin'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const gate = requestGate(pathname, request.nextUrl.searchParams);
  if (gate === 'skip') return NextResponse.json({ skipped: true, reason: 'module disabled' });
  if (gate === 'not-found') {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.rewrite(new URL('/module-not-enabled', request.url));
  }

  // Fictional data, one built-in viewer: there is nothing to log in to.
  if (DEMO_MODE) {
    if (pathname.startsWith('/login')) return NextResponse.redirect(new URL('/', request.url));
    return NextResponse.next();
  }

  // Crons authenticate with CRON_SECRET inside their routes.
  if (pathname.startsWith('/api/cron')) return NextResponse.next();

  // Operational calls to /api/sync authenticate with the shared secret (the route re-checks it
  // in constant time).
  const cronSecret = process.env.CRON_SECRET;
  if (pathname.startsWith('/api/sync') && cronSecret && request.headers.get('authorization') === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) return NextResponse.next();

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL('/login', request.url);
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }
  if (ADMIN_PATHS.some(path => pathname.startsWith(path)) && token.role !== 'admin') {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Report ranges are capped: an unbounded start/end could keep
  // the database busy up to its statement timeout. 1,200 days covers "since 2024".
  if (pathname.startsWith('/api/report/')) {
    for (const [startKey, endKey] of [['start', 'end'], ['compareStart', 'compareEnd']]) {
      const start = request.nextUrl.searchParams.get(startKey);
      const end = request.nextUrl.searchParams.get(endKey);
      if (start && end && (Date.parse(end) - Date.parse(start)) / 86_400_000 > 1200) {
        return NextResponse.json({ error: 'Period too long (1,200 days at most).' }, { status: 400 });
      }
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/auth|_next|fonts|logos|favicon.ico|icon.svg|apple-icon.png).*)'],
};
