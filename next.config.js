/** @type {import('next').NextConfig} */

// Security headers (security check 2026-10-16). Next 15 needs inline scripts for its
// bootstrap, so script-src keeps 'unsafe-inline'; the CSP still blocks foreign scripts,
// framing, plugins and form posts elsewhere. Dev adds eval and the HMR websocket.
const dev = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",          // product images come from the shops' own hosts
  "font-src 'self'",
  `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

// Fixed into the build. See demo-mode.js for when the demo runs.
const { resolveDemoMode } = require('./demo-mode');

const nextConfig = {
  env: { NEXT_PUBLIC_DEMO_MODE: resolveDemoMode(process.env) ? '1' : '' },
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['google-ads-api'],
  // Optional, gitignored: ships with the functions when it exists locally at build time.
  outputFileTracingIncludes: { '/api/**/*': ['./context/methodology.md'] },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
