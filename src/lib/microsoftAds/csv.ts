// Microsoft Advertising report files: a zip with one CSV (FormatVersion 2.0,
// header row, no report header or footer). Pure, tested in csv.test.ts.
import { inflateRawSync } from 'node:zlib';

// The first entry of a zip, located through the central directory (the local
// header may carry zero sizes when a data descriptor follows).
export function unzipFirst(zip: Buffer): Buffer {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Report download is not a zip file');
  const cd = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt32LE(cd) !== 0x02014b50) throw new Error('Zip central directory not found');
  const method = zip.readUInt16LE(cd + 10);
  const size = zip.readUInt32LE(cd + 20);
  const local = zip.readUInt32LE(cd + 42);
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + size);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported zip compression method ${method}`);
}

// RFC 4180 CSV with quoted fields; returns one object per data row keyed on the header.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const body = text.replace(/^﻿/, '');
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  const [header, ...data] = rows;
  if (!header) return [];
  return data.map(values => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ''])));
}

// Numbers come as "1234.56", sometimes with thousands separators ("1,234.56",
// seen on AllRevenue) and "--" or "" for none.
export const msNum = (value: string | undefined): number => {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

// Percentages come as "66.67%" and are stored as fractions like Google's; empty = null.
export const msShare = (value: string | undefined): number | null => {
  const raw = String(value ?? '').replace(/[%,]/g, '').trim();
  if (raw === '' || raw === '--') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n / 100 : null;
};
