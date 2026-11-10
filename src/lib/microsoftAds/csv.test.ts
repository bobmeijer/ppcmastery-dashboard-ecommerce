import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { msNum, msShare, parseCsv, unzipFirst } from './csv';

// Minimal one-entry zip (deflate), with zero sizes in the local header as when a data descriptor follows.
function zip(name: string, content: string): Buffer {
  const data = deflateRawSync(Buffer.from(content, 'utf8'));
  const fileName = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(fileName.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(Buffer.byteLength(content), 24);
  cd.writeUInt16LE(fileName.length, 28);
  cd.writeUInt32LE(0, 42);
  const cdOffset = local.length + fileName.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length + fileName.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, fileName, data, cd, fileName, eocd]);
}

describe('unzipFirst', () => {
  it('reads the first entry through the central directory', () => {
    expect(unzipFirst(zip('report.csv', '"a","b"\r\n"1","2"\r\n')).toString('utf8')).toBe('"a","b"\r\n"1","2"\r\n');
  });
  it('rejects a non-zip download', () => {
    expect(() => unzipFirst(Buffer.from('<html>'))).toThrow(/not a zip/);
  });
});

describe('parseCsv', () => {
  it('parses quoted fields, embedded commas and quotes, BOM and CRLF', () => {
    const rows = parseCsv('﻿"TimePeriod","CampaignName","AllRevenue"\r\n"2026-10-01","02 | Teak, ""Loft""","1,234.56"\r\n\r\n');
    expect(rows).toEqual([{ TimePeriod: '2026-10-01', CampaignName: '02 | Teak, "Loft"', AllRevenue: '1,234.56' }]);
  });
  it('returns no rows for a header-only file', () => {
    expect(parseCsv('"a","b"\r\n')).toEqual([]);
  });
});

describe('numbers', () => {
  it('strips thousands separators and treats -- as zero', () => {
    expect(msNum('382,241.59')).toBe(382241.59);
    expect(msNum('--')).toBe(0);
    expect(msNum(undefined)).toBe(0);
  });
  it('turns percentages into fractions, empty into null', () => {
    expect(msShare('66.67%')).toBeCloseTo(0.6667);
    expect(msShare('')).toBeNull();
    expect(msShare('--')).toBeNull();
  });
});
