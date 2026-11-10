import { describe, expect, it } from 'vitest';
import { bindingComponent, buildQualityReport, distribution, fixList, QualityRow, QualityTuple, stats, toRow, trend } from './qualityShaping';

const row = (over: Partial<QualityRow>): QualityRow => ({
  date: '2026-10-01', campaign_id: 'c1', campaign_name: '02 | Garden Chairs', status: 'ENABLED', network: 'Search', category: 'Garden Chairs',
  ad_group_id: 'g1', ad_group_name: 'Steel chairs', criterion_id: 'k1', keyword: 'steel chair', match_type: 'PHRASE',
  impressions: 100, clicks: 10, cost: 20, conversions: 1, conversions_value: 300, qs: 8, expected_ctr: 3, ad_relevance: 4, landing_page: 3,
  ...over,
});

const noFilters = { campaigns: [], networks: [], excludeBrand: false, status: '' };

describe('stats', () => {
  it('weights the Quality Score and the component buckets by impressions', () => {
    const s = stats([
      row({ impressions: 300, qs: 8 }),
      row({ criterion_id: 'k2', impressions: 100, qs: 4, cost: 50, expected_ctr: 2, landing_page: 2 }),
      row({ criterion_id: 'k3', impressions: 100, qs: null, expected_ctr: null, ad_relevance: null, landing_page: null }),
    ]);
    expect(s).toMatchObject({ impressions: 500, scored: 400, weightedQs: 7, lowShare: 0.25, lowCost: 50 });
    expect(s.components.expected_ctr).toEqual({ below: 0.25, average: 0.75, above: 0 });
    expect(s.components.ad_relevance).toEqual({ below: 0, average: 0, above: 1 });
  });

  it('handles rows without any score', () => {
    expect(stats([row({ qs: null, expected_ctr: null, ad_relevance: null, landing_page: null })])).toMatchObject({ weightedQs: null, lowShare: null });
  });
});

describe('tuples, trend and distribution', () => {
  it('reads the compact tuple shape of read_keyword_quality_json', () => {
    const t: QualityTuple = ['2026-10-01', 'c1', 'Camp', 'ENABLED', 'Search', 'Brand', 'g1', 'Ad group', 'k1', 'kw', 'EXACT', '10', 2, '1.5', 0, 0, 7, 2, 3, 4];
    expect(toRow(t)).toMatchObject({ category: 'Brand', impressions: 10, cost: 1.5, qs: 7, expected_ctr: 2, landing_page: 4 });
  });

  it('builds a weekly trend with the share below average per component', () => {
    const points = trend([row({ date: '2026-09-29' }), row({ date: '2026-10-06', qs: 4, expected_ctr: 2 })], 'week');
    expect(points.map(p => [p.period, p.qs, p.expected_ctr])).toEqual([['2026-09-28', 8, 0], ['2026-10-05', 4, 1]]);
  });

  it('spreads impressions over QS 1 to 10', () => {
    const d = distribution([row({ impressions: 300 }), row({ criterion_id: 'k2', qs: 4, impressions: 100 })]);
    expect(d).toHaveLength(10);
    expect(d.find(b => b.qs === 8)).toMatchObject({ impressions: 300, share: 0.75, keywords: 1 });
    expect(d.find(b => b.qs === 1)).toMatchObject({ impressions: 0, share: 0 });
  });
});

describe('buildQualityReport', () => {
  const rows = [
    row({ date: '2026-10-01', qs: 6, cost: 30 }),
    row({ date: '2026-10-02', qs: 7, cost: 10 }),
    row({ campaign_id: 'b1', campaign_name: '01 | Brand', category: 'Brand', ad_group_id: 'g9', criterion_id: 'k9', keyword: 'shopa', qs: 10, cost: 5 }),
  ];

  it('applies the top-bar filters (Exclude brand) and keeps the latest score per keyword', () => {
    const report = buildQualityReport({ rows, compareRows: null, start: '2026-10-01', end: '2026-10-07', filters: { ...noFilters, excludeBrand: true } });
    expect(report.grain).toBe('day');
    expect(report.campaigns.map(c => c.name)).toEqual(['02 | Garden Chairs']);
    expect(report.keywords).toHaveLength(1);
    expect(report.keywords[0]).toMatchObject({ keyword: 'steel chair', cost: 40, weightedQs: 6.5 });
    expect(report.keywords[0].latest).toMatchObject({ date: '2026-10-02', qs: 7 });
    expect(report.previous).toBeNull();
  });

  it('compares with the previous period and switches to weeks on long ranges', () => {
    const report = buildQualityReport({ rows, compareRows: [row({ qs: 5 })], start: '2026-07-01', end: '2026-10-07', filters: noFilters });
    expect(report.grain).toBe('week');
    expect(report.previous).toMatchObject({ weightedQs: 5 });
    expect(report.campaigns).toHaveLength(2);
  });
});

describe('fix list', () => {
  const rows = [
    row({ criterion_id: 'k1', impressions: 400, cost: 80, expected_ctr: 2 }),
    row({ criterion_id: 'k1', date: '2026-10-02', impressions: 200, cost: 40, expected_ctr: 2 }),
    row({ criterion_id: 'k2', impressions: 400, cost: 30, expected_ctr: 3 }),
    row({ ad_group_id: 'g2', ad_group_name: 'Bench', criterion_id: 'k3', impressions: 300, cost: 200, landing_page: 2 }),
    row({ ad_group_id: 'g3', criterion_id: 'k4', impressions: 50, cost: 500, ad_relevance: 2 }),
  ];
  const fixes = fixList(rows);

  it('gives one line per ad group and component below average, sorted by the cost at stake', () => {
    expect(fixes.map(f => f.key)).toEqual(['g2|landing_page', 'g1|expected_ctr']);
    expect(fixes[1]).toMatchObject({ component: 'expected_ctr', keywords: 1, impressions: 600, cost: 120, share: 0.6 });
  });

  it('leaves out lines below the impression threshold', () => {
    expect(fixes.some(f => f.adGroupId === 'g3')).toBe(false);
    expect(fixList(rows, 0).some(f => f.adGroupId === 'g3')).toBe(true);
  });

  it('names the component with the largest share below average as binding', () => {
    expect(bindingComponent(stats(rows))).toBe('expected_ctr');
    expect(bindingComponent(stats([row({})]))).toBeNull();
  });
});
