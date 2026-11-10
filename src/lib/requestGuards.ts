import 'server-only';
import { timingSafeEqual } from 'node:crypto';

// Request guards.

// Cron and operational callers send "Authorization: Bearer <CRON_SECRET>". Compared in
// constant time; a missing secret never matches.
export function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Mutating admin calls must be same-origin JSON: a cross-site form or text/plain post
// (no CORS preflight) is refused even if a cookie ever rides along.
export function isSameOriginJson(request: Request): boolean {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  if (process.env.NEXTAUTH_URL) allowed.add(new URL(process.env.NEXTAUTH_URL).origin);
  return allowed.has(origin);
}
