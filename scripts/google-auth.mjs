#!/usr/bin/env node
// One-time Google Ads login: opens the consent flow, stores the refresh token in .env.local
// (never printed) and lists the accounts this login can reach.
//
// Needs in .env.local: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN.
// The Google Cloud OAuth client must be of the type "Desktop app".
//
//   npm run google:auth
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadEnv } from './env.mjs';

const ENV_PATH = '.env.local';
const PORT = 8766;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/adwords';

loadEnv();
const { GOOGLE_ADS_CLIENT_ID: clientId, GOOGLE_ADS_CLIENT_SECRET: clientSecret, GOOGLE_ADS_DEVELOPER_TOKEN: developerToken } = process.env;
if (!clientId || !clientSecret) {
  console.error('Add GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET to .env.local first.');
  process.exit(1);
}

function saveToken(value) {
  const text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const line = `GOOGLE_ADS_REFRESH_TOKEN=${value}`;
  const re = /^GOOGLE_ADS_REFRESH_TOKEN=.*$/m;
  writeFileSync(ENV_PATH, re.test(text) ? text.replace(re, () => line) : `${text.replace(/\s*$/, '')}\n${line}\n`, 'utf8');
}

const state = randomBytes(16).toString('hex');
const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, REDIRECT_URI);
    if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
    const value = url.searchParams.get('code');
    const ok = value && url.searchParams.get('state') === state;
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(ok ? 'Done. You can close this tab.' : 'Login failed. Go back to the terminal.');
    server.close();
    if (ok) resolve(value); else reject(new Error(url.searchParams.get('error') || 'The login did not complete.'));
  });
  server.listen(PORT, '127.0.0.1', () => {
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state });
    console.log(`Open this address and sign in with a user who can reach your accounts:\n\nhttps://accounts.google.com/o/oauth2/v2/auth?${params}\n`);
  });
});

const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
});
const tokens = await tokenResponse.json();
if (!tokens.refresh_token) {
  console.error(`Google did not return a refresh token: ${tokens.error_description || tokens.error || 'unknown reason'}`);
  process.exit(1);
}
saveToken(tokens.refresh_token);
console.log('Saved GOOGLE_ADS_REFRESH_TOKEN in .env.local.');

if (!developerToken) {
  console.log('Add GOOGLE_ADS_DEVELOPER_TOKEN, then run npm run doctor.');
  process.exit(0);
}
const { GoogleAdsApi } = createRequire(import.meta.url)('google-ads-api');
const api = new GoogleAdsApi({ client_id: clientId, client_secret: clientSecret, developer_token: developerToken });
const { resource_names: names = [] } = await api.listAccessibleCustomers(tokens.refresh_token);
console.log(`\nThis login can reach ${names.length} account(s) directly:`);
for (const name of names) console.log(`  ${name.replace('customers/', '')}`);
