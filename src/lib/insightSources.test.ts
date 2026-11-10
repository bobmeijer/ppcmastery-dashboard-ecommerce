import { describe, expect, it } from 'vitest';
import { citeResult, resolveSources, type ToolCall } from './insightSources';

const calls: ToolCall[] = [
  { name: 'campaign_data', input: { start: '2026-08-01', end: '2026-09-30', group_by: 'week', network: 'Performance Max' }, text: 'week of 2026-08-03: cost €1,000' },
  { name: 'account_context', input: { start: '2026-09-01', end: '2026-09-30' }, text: [
    '[pmax-auditor, 2026-10-21, covering 2026-08-24 to 2026-09-20, high] Gmail took 13,325 clicks. Evidence: 1 purchase of €25.',
    '[daily-note, 2026-10-15, notable] Display cost €3,051.',
  ].join('\n') },
  { name: 'communication', input: { start: '2026-10-01', end: '2026-10-31' }, text: '2026-10-14 meeting "Progress": Brand out of PMax discussed.' },
  { name: 'feed_status', input: {}, text: 'As of 2026-10-21: 1,200 products' },
];

describe('citeResult', () => {
  it('heads a data table with one reference', () => {
    expect(citeResult(3, 'campaign_data', 'a\nb')).toBe('[T3]\na\nb');
  });
  it('numbers each finding line', () => {
    expect(citeResult(2, 'account_context', 'x\ny')).toBe('[T2.1] x\n[T2.2] y');
  });
});

describe('resolveSources', () => {
  it('turns a data reference into the page with that period and network', () => {
    expect(resolveSources(['T1'], calls)).toEqual([{
      kind: 'data', label: 'Campaign data per week, Performance Max, 1 Aug 2026 to 30 Sep 2026', path: '/trends',
      params: { preset: 'custom', start: '2026-08-01', end: '2026-09-30', networks: 'Performance Max' },
    }]);
  });
  it('turns a finding line into its source, date and text', () => {
    expect(resolveSources(['[T2.1]', 'T2.2'], calls)).toEqual([
      { kind: 'context', source: 'PMax audit', date: '2026-10-21', text: 'Gmail took 13,325 clicks. Evidence: 1 purchase of €25.' },
      { kind: 'context', source: "the account manager's daily note", date: '2026-10-15', text: 'Display cost €3,051.' },
    ]);
  });
  it('reads a meeting line', () => {
    expect(resolveSources(['T3.1'], calls)).toEqual([{ kind: 'context', source: 'Meeting "Progress"', date: '2026-10-14', text: 'Brand out of PMax discussed.' }]);
  });
  it('drops unknown, malformed and whole-list references and duplicates', () => {
    expect(resolveSources(['T9', 'T2', 'T2.7', 'source', 'T1', 'T1'], calls)).toHaveLength(1);
  });
  it('links a dateless tool without period params', () => {
    expect(resolveSources(['T4'], calls)).toEqual([{ kind: 'data', label: 'Merchant Center feed', path: '/feed', params: {} }]);
  });
});
