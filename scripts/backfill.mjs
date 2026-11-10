#!/usr/bin/env node
// Backfills Google Ads (or, with --source microsoft, Microsoft Ads) history month by month through the cron endpoint.
//
//   DASHBOARD_BASE_URL=https://your-dashboard.example.com CRON_SECRET=... \
//   node scripts/backfill.mjs --from 2024-01-01 [--to 2026-09-30] [--datasets campaign,conversions,geo,device] [--grain month] [--accounts gardenweb] [--days 7] [--source google|microsoft]
//
// Newest month first, so an interrupted run leaves the recent data in place.
// Stops on the first failed month; rerun with --to to resume.
import { readFileSync, existsSync } from 'node:fs';

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

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => {
  if (!a.startsWith('--')) return [];
  const [k, v] = a.slice(2).split('=');
  return [k, v ?? (all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true')];
}).filter(e => e.length));

const base = process.env.DASHBOARD_BASE_URL || 'http://localhost:3000';
const secret = process.env.CRON_SECRET;
if (!secret) { console.error('CRON_SECRET is required'); process.exit(1); }
const from = args.from;
if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '')) { console.error('--from YYYY-MM-DD is required'); process.exit(1); }
const to = args.to || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const datasets = (args.datasets || 'campaign,conversions,geo,device').split(',');
const grain = args.grain === 'month' ? 'month' : 'day';
const endpoint = args.source === 'microsoft' ? 'microsoft-ads' : 'google-ads';
const accounts = args.accounts ? `&accounts=${encodeURIComponent(args.accounts)}` : '';

// --days N splits each month into windows of N days (day grain only): a full
// month of product rows can take longer than fetch's 300 s header timeout.
const chunkDays = grain === 'day' && Number(args.days) > 0 ? Number(args.days) : null;

const months = [];
let cursor = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
const first = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
while (cursor >= first) {
  const start = cursor.toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
  const end = endDate.toISOString().slice(0, 10);
  const window = { start: start < from ? from : start, end: end > to ? to : end };
  if (!chunkDays) months.push(window);
  else {
    // Newest piece first, like the months.
    const pieces = [];
    for (let d = new Date(`${window.start}T00:00:00Z`); d.toISOString().slice(0, 10) <= window.end; d.setUTCDate(d.getUTCDate() + chunkDays)) {
      const pieceEnd = new Date(d); pieceEnd.setUTCDate(pieceEnd.getUTCDate() + chunkDays - 1);
      const e = pieceEnd.toISOString().slice(0, 10);
      pieces.push({ start: d.toISOString().slice(0, 10), end: e > window.end ? window.end : e });
    }
    months.push(...pieces.reverse());
  }
  cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1));
}

for (const dataset of datasets) {
  for (const month of months) {
    const url = `${base}/api/cron/${endpoint}?dataset=${dataset}&grain=${grain}&startDate=${month.start}&endDate=${month.end}${accounts}`;
    const startedAt = Date.now();
    process.stdout.write(`${dataset} ${month.start}..${month.end} ... `);
    const response = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
    const body = await response.json().catch(() => ({}));
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (!response.ok || !body.ok) {
      console.log(`FAILED (${seconds}s)`);
      console.error(JSON.stringify(body.errors || body, null, 2));
      process.exit(1);
    }
    const rows = (body.results || []).map(r => `${r.accountId}:${r.rows}`).join(' ');
    console.log(`ok ${rows} (${seconds}s)`);
  }
}
console.log('Backfill complete');
