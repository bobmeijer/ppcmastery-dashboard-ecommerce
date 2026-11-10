import { describe, expect, it } from 'vitest';
import { beVsNlFinding, countryKey, countryMatrix, countrySummaries, geoChartData, matrixTotals, otherBreakdown, GeoRow } from './geoShaping';

const row = (over: Partial<GeoRow>): GeoRow => ({
  account_id: '1', period: '2026-09-01', campaign_id: 'c1', campaign_name: 'Campaign 1', status: 'ENABLED', category: 'Parasols', network: 'Shopping', country_code: 'NL',
  impressions: 1000, clicks: 100, cost: 100, conversions: 2, conversions_value: 400, ...over,
});

const rows: GeoRow[] = [
  row({ country_code: 'NL', cost: 700, conversions_value: 2800, conversions: 7 }),
  row({ country_code: 'BE', cost: 200, conversions_value: 300, conversions: 1, category: 'Parasols' }),
  row({ country_code: 'BE', cost: 50, conversions_value: 200, conversions: 1, category: 'Planters', network: 'Search', period: '2026-09-02' }),
  row({ country_code: 'DE', cost: 30, conversions_value: 0, conversions: 0, category: 'Planters', network: 'Search' }),
  row({ country_code: 'FR', cost: 20, conversions_value: 100, conversions: 1, category: 'Parasols', network: 'PMax' }),
];

describe('countryKey', () => {
  it('folds everything but NL and BE into Other', () => {
    expect(countryKey('NL')).toBe('NL');
    expect(countryKey('BE')).toBe('BE');
    expect(countryKey('DE')).toBe('Other');
    expect(countryKey(null)).toBe('Other');
  });
});

describe('countrySummaries', () => {
  it('computes totals, shares and comparison per country', () => {
    const compare = [row({ country_code: 'NL', cost: 500, conversions_value: 1000 }), row({ country_code: 'BE', cost: 500, conversions_value: 500 })];
    const s = countrySummaries(rows, compare);
    expect(s.NL.cost).toBe(700);
    expect(s.NL.share).toBeCloseTo(0.7);
    expect(s.NL.roas).toBe(4);
    expect(s.BE.cost).toBe(250);
    expect(s.BE.roas).toBe(2);
    expect(s.Other.cost).toBe(50);
    expect(s.Other.share).toBeCloseTo(0.05);
    expect(s.NL.previous?.share).toBeCloseTo(0.5);
    expect(s.BE.previous?.roas).toBe(1);
  });

  it('leaves the comparison null without compare rows', () => {
    const s = countrySummaries(rows, []);
    expect(s.NL.previous).toBeNull();
  });

  it('yields null shares and ratios on an empty period', () => {
    const s = countrySummaries([], []);
    expect(s.NL.cost).toBe(0);
    expect(s.NL.share).toBeNull();
    expect(s.BE.roas).toBeNull();
  });
});

describe('otherBreakdown', () => {
  it('lists the real countries behind Other, largest first', () => {
    const lines = otherBreakdown(rows);
    expect(lines.map(l => l.code)).toEqual(['DE', 'FR']);
    expect(lines[0].name).toBe('Germany');
    expect(lines[0].share).toBeCloseTo(0.03);
    expect(lines[1].roas).toBe(5);
  });
});

describe('geoChartData', () => {
  it('stacks the chosen metric per country and carries ROAS per country', () => {
    const points = geoChartData(rows, 'conversions_value');
    expect(points.map(p => p.period)).toEqual(['2026-09-01', '2026-09-02']);
    expect(points[0].NL).toBe(2800);
    expect(points[0].BE).toBe(300);
    expect(points[0].Other).toBe(100);
    expect(points[0].NL_roas).toBe(4);
    expect(points[1].NL).toBeNull();
    expect(points[1].BE).toBe(200);
    expect(points[1].BE_roas).toBe(4);
  });

  it('switches the bar metric', () => {
    const points = geoChartData(rows, 'cost');
    expect(points[0].NL).toBe(700);
  });
});

describe('countryMatrix', () => {
  it('builds category rows with NL / BE / Other cells sorted by total cost', () => {
    const matrix = countryMatrix(rows, 'category');
    expect(matrix.map(r => r.name)).toEqual(['Parasols', 'Planters']);
    expect(matrix[0].NL?.cost).toBe(700);
    expect(matrix[0].BE?.roas).toBe(1.5);
    expect(matrix[0].Other?.cost).toBe(20);
    expect(matrix[1].NL).toBeNull();
    expect(matrix[1].Other?.roas).toBe(0);
  });

  it('builds display-network rows (PMax counts as Shopping) and a totals row', () => {
    const matrix = countryMatrix(rows, 'network');
    expect(matrix.map(r => r.name)).toEqual(['Non-Branded Search', 'Non-Branded Shopping']);
    expect(matrix[1].total.cost).toBe(920);
    expect(matrix[1].Other?.cost).toBe(20);
    const totals = matrixTotals(rows);
    expect(totals.total.cost).toBe(1000);
    expect(totals.BE?.cost).toBe(250);
    expect(totals.previous).toBeNull();
  });

  it('splits Search and Shopping on Brand and keeps NETWORK_ORDER', () => {
    const withBrand = [
      ...rows,
      row({ category: 'Brand', network: 'Search', cost: 5 }),
      row({ category: 'Brand', network: 'Shopping', cost: 3 }),
      row({ category: 'Other', network: 'Display', cost: 900 }),
    ];
    expect(countryMatrix(withBrand, 'network').map(r => r.name))
      .toEqual(['Branded Search', 'Branded Shopping', 'Non-Branded Search', 'Non-Branded Shopping', 'Display']);
  });

  it('attaches the comparison-period cells per row', () => {
    const previous = [row({ country_code: 'NL', cost: 500 }), row({ country_code: 'BE', cost: 40, network: 'Search', category: 'Planters' })];
    const matrix = countryMatrix(rows, 'category', previous);
    expect(matrix[0].previous?.NL?.cost).toBe(500);
    expect(matrix[0].previous?.BE).toBeNull();
    expect(matrix[1].previous?.BE?.cost).toBe(40);
    expect(countryMatrix(rows, 'category')[0].previous).toBeNull();
    expect(matrixTotals(rows, previous).previous?.total.cost).toBe(540);
  });
});

describe('beVsNlFinding', () => {
  it('flags when BE ROAS is below 60% of NL ROAS', () => {
    const s = countrySummaries(rows, []);
    const finding = beVsNlFinding(s.NL, s.BE);
    expect(finding?.flagged).toBe(true);
    expect(finding?.ratio).toBeCloseTo(0.5);
    expect(finding?.text).toContain('below the threshold');
    expect(finding?.text).not.toMatch(/advise|should|increase|decrease/i);
  });

  it('does not flag at or above the threshold', () => {
    const s = countrySummaries([row({ country_code: 'NL', cost: 100, conversions_value: 400 }), row({ country_code: 'BE', cost: 100, conversions_value: 300 })], []);
    const finding = beVsNlFinding(s.NL, s.BE);
    expect(finding?.flagged).toBe(false);
    expect(finding?.ratio).toBeCloseTo(0.75);
    expect(finding?.text).toContain('above the threshold');
  });

  it('flags BE spend with zero revenue (ROAS 0)', () => {
    const s = countrySummaries([row({ country_code: 'NL' }), row({ country_code: 'BE', conversions_value: 0, conversions: 0 })], []);
    const finding = beVsNlFinding(s.NL, s.BE);
    expect(finding?.flagged).toBe(true);
    expect(finding?.ratio).toBe(0);
  });

  it('returns a plain note without BE cost, and null on an empty period', () => {
    const s = countrySummaries([row({ country_code: 'NL' })], []);
    const finding = beVsNlFinding(s.NL, s.BE);
    expect(finding?.flagged).toBe(false);
    expect(finding?.ratio).toBeNull();
    expect(finding?.text).toContain('No Belgian cost');
    expect(beVsNlFinding(countrySummaries([], []).NL, countrySummaries([], []).BE)).toBeNull();
  });
});
