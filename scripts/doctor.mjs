#!/usr/bin/env node
// Checks each connection and names the exact fix. Prints no secret values.
//   npm run doctor
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadEnv } from './env.mjs';

const require = createRequire(import.meta.url);
loadEnv();
const env = process.env;

let failed = 0;
const pass = message => console.log(`  ok    ${message}`);
const warn = message => console.log(`  warn  ${message}`);
const fail = (message, fix) => { failed += 1; console.log(`  FAIL  ${message}\n        Fix: ${fix}`); };
const section = title => console.log(`\n${title}`);

// The config is TypeScript, so read the values this script needs as text.
const configText = readFileSync('dashboard.config.ts', 'utf8');
const modulesBlock = configText.match(/modules:\s*\{([^}]*)\}/)?.[1] ?? '';
const moduleOn = name => new RegExp(`\\b${name}:\\s*true`).test(modulesBlock);
const configLabels = [...configText.matchAll(/\{\s*label:\s*'([^']+)'/g)].map(m => m[1]);
const configCurrency = configText.match(/^\s*currency:\s*'([^']+)'/m)?.[1];
const configTimeZone = configText.match(/^\s*timeZone:\s*'([^']+)'/m)?.[1];

function requireVars(names, fix) {
  const missing = names.filter(name => !env[name]);
  if (missing.length) fail(`Missing: ${missing.join(', ')}`, fix);
  return missing.length === 0;
}

function explainGoogle(error) {
  const text = JSON.stringify(error?.errors ?? error?.message ?? error);
  if (text.includes('invalid_grant')) return ['The refresh token is expired or revoked.', 'If the OAuth app in Google Cloud is still in Testing, publish it first, because tokens expire after 7 days there. Then run npm run google:auth again.'];
  if (text.includes('CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION')) return ['This Google Cloud project only has Test access.', 'Apply for Explorer access on the Google Ads API Overview page in Google Cloud.'];
  if (text.includes('USER_PERMISSION_DENIED')) return ['This login cannot reach the account.', 'Give the Google user access, and check GOOGLE_ADS_LOGIN_CUSTOMER_ID is the manager above this account.'];
  if (text.includes('CUSTOMER_NOT_ENABLED')) return ['The account is not active.', 'Enable it, or set enabled = false for it in the accounts table.'];
  if (text.includes('SERVICE_DISABLED') || text.includes('has not been used in project')) return ['The Google Ads API is off in this Google Cloud project.', 'Enable it in Google Cloud under APIs and services.'];
  return ['Google returned an error.', text.slice(0, 300)];
}

section('Runtime');
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) pass(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} is too old`, 'Install Node 20 or newer.');
if (env.DASHBOARD_DEMO === '1') fail('DASHBOARD_DEMO=1 is set', 'Remove it to use real data.');

section('Login');
if (requireVars(['NEXTAUTH_SECRET', 'NEXTAUTH_URL'], 'Add them to your environment file. See docs/SETUP.md.')) pass('NEXTAUTH settings present');

section('Sync');
if (requireVars(['CRON_SECRET'], 'Run openssl rand -base64 32 and add it as CRON_SECRET.')) pass('CRON_SECRET present');

section('Database');
let accounts = [];
let db = null;
if (requireVars(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], 'Copy them from your Supabase project settings.')) {
  const { createClient } = require('@supabase/supabase-js');
  db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await db.from('accounts').select('*');
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) fail('The tables are missing', 'Run the SQL in supabase/migrations on your project.');
    else if (/Invalid API key|JWT/i.test(error.message)) fail('The service role key was rejected', 'Copy the service role key, not the anon key, from Supabase.');
    else if (/permission denied/i.test(error.message)) fail('This key cannot read the tables', 'Use the service role key, not the anon or publishable key.');
    else fail('Could not read the database', error.message);
  } else {
    accounts = data;
    pass('Connected, tables found');
    if (!accounts.length) fail('No accounts in the database', 'Run npm run accounts:add. See docs/SETUP.md.');
    const known = new Set(accounts.map(a => a.label));
    for (const label of configLabels) {
      if (!known.has(label)) fail(`"${label}" is in dashboard.config.ts but not in the database`, 'Run npm run accounts:add with this label, or remove it from the config.');
    }
    for (const account of accounts) {
      if (!configLabels.includes(account.label)) fail(`"${account.label}" is in the database but not in dashboard.config.ts`, 'Add it to accounts in dashboard.config.ts.');
    }
    const { count } = await db.from('users').select('*', { count: 'exact', head: true });
    if (count) pass(`${count} login(s) created`);
    else warn('No logins yet. Run npm run users:add.');
  }
}

section('Google Ads');
if (requireVars(['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'], 'See "Connect Google Ads" in docs/SETUP.md.') && accounts.length) {
  const { GoogleAdsApi } = require('google-ads-api');
  const api = new GoogleAdsApi({ client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET });
  for (const account of accounts.filter(a => a.enabled)) {
    try {
      const customer = api.Customer({
        customer_id: account.id,
        login_customer_id: (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || account.login_customer_id).replace(/-/g, ''),
        refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
      });
      const [row] = await customer.query('SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1');
      pass(`"${account.label}" reachable`);
      if (configCurrency && row.customer.currency_code !== configCurrency) warn(`"${account.label}" reports in ${row.customer.currency_code}, the config says ${configCurrency}.`);
      if (configTimeZone && row.customer.time_zone !== configTimeZone) warn(`"${account.label}" uses ${row.customer.time_zone}, the config says ${configTimeZone}.`);
    } catch (error) {
      const [problem, fix] = explainGoogle(error);
      fail(`"${account.label}": ${problem}`, fix);
    }
  }
}

if (db && accounts.length) {
  const { data: campaigns } = await db.from('campaign_dim').select('parsed');
  if (campaigns?.length) {
    const parsed = campaigns.filter(c => c.parsed).length;
    const line = `${parsed} of ${campaigns.length} campaign names match your naming scheme`;
    if (parsed === campaigns.length) pass(line);
    else warn(`${line}. The rest show as Other. See campaignNames in dashboard.config.ts.`);
  }
}

const optional = [
  ['ai', ['ANTHROPIC_API_KEY'], 'Add an Anthropic API key, or switch the ai module off.'],
  ['microsoftAds', ['MSADS_CLIENT_ID', 'MSADS_CLIENT_SECRET', 'MSADS_DEVELOPER_TOKEN', 'MSADS_REFRESH_TOKEN'], 'Run npm run msads:auth, or switch the microsoftAds module off.'],
  ['auctionInsights', ['GOOGLE_SHEETS_SERVICE_ACCOUNT_B64'], 'Add a base64 service account key, or switch the auctionInsights module off.'],
];
const enabled = optional.filter(([name]) => moduleOn(name));
if (enabled.length) {
  section('Optional modules');
  for (const [name, vars, fix] of enabled) if (requireVars(vars, fix)) pass(`${name} settings present`);
}

console.log(failed ? `\n${failed} problem(s) to fix.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
