#!/usr/bin/env node
// Backfills auction insights from a Google Ads CSV export (Report Editor:
// campaign x day x competitor) through the import endpoint.
//
//   node scripts/import-auction.mjs --account gardenweb --file "path/to/export.csv" [--lines 20000]
//
// DASHBOARD_BASE_URL (default http://localhost:3000) and CRON_SECRET come from
// the environment or .env.local. The file is split into chunks of --lines data
// rows; every chunk carries the header row, the endpoint upserts it. Safe to
// rerun: rows are keyed on network, day, campaign and competitor.
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) {
      const key = line.slice(0, i).trim();
      if (!process.env[key]) process.env[key] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => {
  if (!a.startsWith('--')) return [];
  const [k, v] = a.slice(2).split('=');
  return [k, v ?? (all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true')];
}).filter(e => e.length));

const base = process.env.DASHBOARD_BASE_URL || 'http://localhost:3000';
const secret = process.env.CRON_SECRET;
if (!secret) { console.error('CRON_SECRET is required'); process.exit(1); }
if (!args.account || !args.file) { console.error('--account and --file are required'); process.exit(1); }
const perChunk = Number(args.lines) > 0 ? Number(args.lines) : 20000;

const lines = readFileSync(args.file, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
const headerIndex = lines.findIndex(l => /^(Campaign|Store display name),/.test(l) || /,Campaign,/.test(l));
if (headerIndex < 0) { console.error('No header row found'); process.exit(1); }
const header = lines[headerIndex];
const data = lines.slice(headerIndex + 1).filter(l => l.trim());
console.log(`${args.file}: ${data.length} rows, chunks of ${perChunk}`);

let total = 0;
for (let i = 0; i < data.length; i += perChunk) {
  const body = [header, ...data.slice(i, i + perChunk)].join('\n');
  const response = await fetch(`${base}/api/cron/auction/import?account=${encodeURIComponent(args.account)}`, {
    method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'text/csv' }, body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.ok) {
    console.error(`Chunk starting at row ${i} failed (${response.status}): ${json.error || 'no body'}`);
    process.exit(1);
  }
  total += json.rows;
  console.log(`  rows ${i + 1}-${Math.min(i + perChunk, data.length)}: ${json.rows} written (${json.network}${json.skipped ? `, ${json.skipped} skipped` : ''})`);
}
console.log(`Done: ${total} rows`);
