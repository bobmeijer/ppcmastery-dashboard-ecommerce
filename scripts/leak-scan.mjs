#!/usr/bin/env node
// Fails when a tracked file looks like it holds a credential, an ad account ID, a Google
// file ID or a personal email address. Generic patterns only. Prints where, never the value.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CHECKS = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Google OAuth secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
  ['Google refresh token', /\b1\/\/0[A-Za-z0-9_-]{40,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['Stripe or similar live key', /\b[sr]k_live_[A-Za-z0-9]{16,}/],
  ['Resend key', /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}/],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\./],
  ['assigned secret', /\b(?:SERVICE_ROLE_KEY|CLIENT_SECRET|DEVELOPER_TOKEN|REFRESH_TOKEN|API_KEY|CRON_SECRET|NEXTAUTH_SECRET)\s*=\s*["']?[A-Za-z0-9/+_-]{16,}/],
  ['Google Ads ID', /(?<![\d.-])\d{3}-\d{3}-\d{4}(?![\d-])/],
  ['Google Ads ID', /(?<![\d.])\d{10}(?![\d.])/, /^(?:1000000\d{3}|2000000\d{3}|3000000000|9000000000|1234567890)$/],
  ['Google file ID', /(?:docs|drive|sheets)\.google\.com\/[^\s"'`]*?\/(?:d|folders)\/[A-Za-z0-9_-]{20,}/],
  ['Google file ID', /(?<![A-Za-z0-9_-])1[A-Za-z0-9_-]{32,43}(?![A-Za-z0-9_-])/],
  ['email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/, /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/i],
];

const SKIP = /(^|\/)package-lock\.json$|\.(?:woff2?|png|jpe?g|webp|ico)$/;
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(f => f && !SKIP.test(f));

let hits = 0;
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    for (const [name, pattern, allowed] of CHECKS) {
      const match = line.match(pattern);
      if (match && !allowed?.test(match[0])) {
        hits += 1;
        console.log(`${file}:${index + 1}  ${name}`);
      }
    }
  });
}

console.log(hits ? `${hits} possible leaks in ${files.length} files` : `Clean: ${files.length} files scanned`);
process.exit(hits ? 1 : 0);
