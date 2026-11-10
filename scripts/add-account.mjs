#!/usr/bin/env node
// Adds or updates an ad account in the database.
//   npm run accounts:add -- --label shop --name "My shop" --id XXX-XXX-XXXX [--login YYY-YYY-YYYY] [--currency EUR] [--lag 7] [--merchant 12345]
// --label must match a label in dashboard.config.ts. --login is your manager account;
// leave it out when you connect straight to the account.
import { createRequire } from 'node:module';
import { loadEnv } from './env.mjs';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
loadEnv();

const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const digits = value => (value || '').replace(/-/g, '');

const id = digits(arg('id') || process.env.ACCOUNT_ID);
const label = arg('label');
const name = arg('name');
if (!/^\d{10}$/.test(id) || !label || !name) {
  console.error('usage: npm run accounts:add -- --label shop --name "My shop" --id XXX-XXX-XXXX [--login YYY-YYY-YYYY] [--currency EUR] [--lag 7] [--merchant 12345]');
  process.exit(1);
}
const login = digits(arg('login') || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) || id;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'); process.exit(1); }

const { error } = await createClient(url, key, { auth: { persistSession: false } }).from('accounts').upsert({
  id, label, display_name: name, login_customer_id: login,
  merchant_id: arg('merchant') ?? null,
  currency: arg('currency') || 'EUR',
  lag_days: Number(arg('lag')) || 7,
});
if (error) { console.error(`Could not save the account: ${error.message}`); process.exit(1); }
console.log(`Saved account "${label}".`);
