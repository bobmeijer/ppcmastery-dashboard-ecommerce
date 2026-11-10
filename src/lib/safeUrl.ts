// URL guards for the browser. Pure, tested in safeUrl.test.ts.

// Feed links come from Merchant Center: only http(s) may become an href, so a
// "javascript:" link in a product feed can never run in the dashboard.
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

// After login: a same-origin path only. "//evil.com" and "/\evil.com" start with "/" but
// leave the site, so the check resolves the URL against the current origin.
export function safeCallback(callback: string | null | undefined, origin: string): string {
  if (!callback || !callback.startsWith('/')) return '/';
  try {
    const resolved = new URL(callback, origin);
    return resolved.origin === origin ? `${resolved.pathname}${resolved.search}${resolved.hash}` : '/';
  } catch {
    return '/';
  }
}
