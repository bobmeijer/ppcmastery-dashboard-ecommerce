#!/usr/bin/env node
// Creates or updates a dashboard user with a bcrypt password hash.
//   node scripts/add-user.mjs <email> <admin|client> "<name>"
// Prompts for the password (not echoed). Reads Supabase settings from .env.local.
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) {
      const key = line.slice(0, i).trim();
      // Values may be quoted ("...") and lines may end in \r on Windows.
      if (!process.env[key]) process.env[key] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const [email, role, name] = process.argv.slice(2);
if (!email || !['admin', 'client'].includes(role)) {
  console.error('usage: node scripts/add-user.mjs <email> <admin|client> "<name>"');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'); process.exit(1); }

const password = await new Promise(resolve => {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write('Password: ');
  const stdin = process.stdin;
  let value = '';
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  // A piped password arrives as one chunk, typed keys arrive one at a time.
  const onData = chunk => {
    for (const ch of chunk) {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.setRawMode?.(false); stdin.removeListener('data', onData); rl.close(); process.stdout.write('\n'); resolve(value);
        return;
      }
      if (ch === '\u0003') process.exit(1);
      if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
      else value += ch;
    }
  };
  stdin.on('data', onData);
});
if (password.length < 10) { console.error('Use at least 10 characters'); process.exit(1); }

const password_hash = await bcrypt.hash(password, 12);
const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data: saved, error } = await supabase.from('users').upsert(
  { email: email.toLowerCase(), role, name: name || null, password_hash }, { onConflict: 'email' },
).select('id').single();
if (error) { console.error(error.message); process.exit(1); }
// A new password signs the user out everywhere: bumping session_version invalidates every
// session token issued with the old one (also when this only resets an existing user).
const { error: bumpError } = await supabase.rpc('bump_session_version', { p_user_id: saved.id });
if (bumpError) { console.error(`Password saved, but old sessions are still valid: ${bumpError.message}`); process.exit(1); }
console.log(`User ${email} (${role}) saved`);
