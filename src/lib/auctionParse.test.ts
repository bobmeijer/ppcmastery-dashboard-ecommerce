import { describe, expect, it } from 'vitest';
import { parseAuctionReport, parseCsv, parsePercent, parseReportDate } from './auctionParse';

const SEARCH_CSV = `Shop A - Auction Insights - Search
"January 1, 2024 - October 15, 2026"
Campaign,Day,Display URL domain,Search Impr. share (Auction Insights),Search overlap rate,Position above rate,Top of page rate,Abs. Top of page rate,Search outranking share
01 | Brand,2024-01-01,You,97.14%, --, --,99.02%,99.02%, --
02 | Garden Chairs,2025-07-30,competitor-b.nl,< 10%,11.26%,54.65%,81.47%,15.95%,16.71%
02 | Garden Chairs,2025-07-31,competitor-a.com,29.6%,31.85%,49.39%,75.95%,21.36%,24.48%
`;

const SHOPPING_SHEET = [
  ['Shop A - Auction Insights - Shopping'],
  ['October 9, 2026 - October 15, 2026'],
  ['Store display name', 'Campaign', 'Day', 'Shopping Impr. share (Auction Insights)', 'Shopping overlap rate', 'Shopping outranking share'],
  ['You', '08 | Garden Tables [H+S]', '2026-10-09', '87%', '--', '--'],
  ['Acme & Co', '08 | Garden Tables [H+S]', '2026-10-10', '< 10%', '7,82%', '85.61%'],
  ['', '', '', '', '', ''],
  ['Broken', '', '2026-10-10', '12%', '1%', '1%'],
];

describe('parsePercent', () => {
  it('reads percentages as fractions', () => {
    expect(parsePercent('97.14%')).toEqual({ value: 0.9714, capped: false });
    expect(parsePercent('99%')).toEqual({ value: 0.99, capped: false });
    expect(parsePercent('7,82%')).toEqual({ value: 0.0782, capped: false });
  });
  it('treats "--" and empty as null and "< 10%" as the capped ceiling', () => {
    expect(parsePercent(' --')).toEqual({ value: null, capped: false });
    expect(parsePercent('')).toEqual({ value: null, capped: false });
    expect(parsePercent('< 10%')).toEqual({ value: 0.1, capped: true });
    expect(parsePercent('> 90%')).toEqual({ value: 0.9, capped: false });
  });
});

describe('parseReportDate', () => {
  it('handles the English long form and ISO', () => {
    expect(parseReportDate('October 9, 2026')).toBe('2026-10-09');
    expect(parseReportDate('2024-01-01')).toBe('2024-01-01');
    expect(parseReportDate('9 Oct 2026')).toBeNull();
  });
});

describe('parseAuctionReport', () => {
  it('parses a Search CSV with its date range', () => {
    const r = parseAuctionReport(parseCsv(SEARCH_CSV));
    expect(r.network).toBe('Search');
    expect(r.span).toEqual({ start: '2024-01-01', end: '2026-10-15' });
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ campaign: '01 | Brand', competitor: 'You', impression_share: 0.9714, overlap_rate: null, top_of_page_rate: 0.9902 });
    expect(r.rows[1]).toMatchObject({ competitor: 'competitor-b.nl', impression_share: 0.1, is_capped: true, position_above_rate: 0.5465, outranking_share: 0.1671 });
  });

  it('parses a Shopping sheet, skips blank and incomplete rows', () => {
    const r = parseAuctionReport(SHOPPING_SHEET);
    expect(r.network).toBe('Shopping');
    expect(r.span).toEqual({ start: '2026-10-09', end: '2026-10-15' });
    expect(r.rows).toHaveLength(2);
    expect(r.skipped).toBe(1);
    expect(r.rows[1]).toMatchObject({ competitor: 'Acme & Co', is_capped: true, overlap_rate: 0.0782, position_above_rate: null, top_of_page_rate: null });
  });

  it('drops repeated day x campaign x competitor rows, keeping the bigger share', () => {
    const r = parseAuctionReport([...SHOPPING_SHEET, ['Acme & Co', '08 | Garden Tables [H+S]', '2026-10-10', '31%', '20%', '40%']]);
    expect(r.rows).toHaveLength(2);
    expect(r.duplicates).toBe(1);
    expect(r.rows[1]).toMatchObject({ competitor: 'Acme & Co', impression_share: 0.31, is_capped: false });
  });

  it('falls back to the min and max day without a range row', () => {
    const r = parseAuctionReport(SHOPPING_SHEET.slice(2));
    expect(r.span).toEqual({ start: '2026-10-09', end: '2026-10-10' });
  });

  it('throws without a header row', () => {
    expect(() => parseAuctionReport([['nothing here']])).toThrow(/header/);
  });
});

describe('parseCsv', () => {
  it('handles quotes, doubled quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3')).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  });
});
