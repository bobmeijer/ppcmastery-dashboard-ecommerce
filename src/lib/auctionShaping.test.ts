import { describe, expect, it } from 'vitest';
import { assignColors, AuctionRow, COMPETITOR_COLORS, defaultGrain, metricsFor, newPlayers, onWatchlist, rankCompetitors, topCompetitors, trendPoints, watchKey } from './auctionShaping';

const row = (competitor: string, period: string, impression_share: number | null, overlap_rate: number | null, extra: Partial<AuctionRow> = {}): AuctionRow => ({
  period, network: 'Search', category: 'Garden Chairs', competitor, impression_share, is_capped: false, overlap_rate,
  position_above_rate: null, top_of_page_rate: null, abs_top_rate: null, outranking_share: null, eligible: 100, campaign_days: 7, ...extra,
});

describe('watchKey / onWatchlist', () => {
  it('matches Shopping store names to watch-list domains', () => {
    expect(watchKey('Acme & Co')).toBe(watchKey('acmeenco.nl'));
    expect(watchKey('Sample shop B.V.')).toBe(watchKey('sampleshop.nl'));
    expect(watchKey('Other Store')).toBe(watchKey('otherstore.nl'));
    expect(onWatchlist('SHOPX.nl', ['shopx.nl'])).toBe(true);
    expect(onWatchlist('bol.com', ['shopx.nl'])).toBe(false);
  });
});

describe('rankCompetitors / topCompetitors', () => {
  const totals = [row('You', 'p', 0.3, null), row('a.nl', 'p', 0.2, 0.3), row('b.nl', 'p', 0.4, 0.3), row('c.nl', 'p', 0.1, 0.5)];
  it('sorts on overlap, then impression share, and drops the own row', () => {
    expect(rankCompetitors(totals).map(r => r.competitor)).toEqual(['c.nl', 'b.nl', 'a.nl']);
  });
  it('narrows to the watch list before taking the top N', () => {
    expect(topCompetitors(totals, 1, ['a.nl'])).toEqual(['a.nl']);
    expect(topCompetitors(totals, 2)).toEqual(['c.nl', 'b.nl']);
  });
});

describe('trendPoints', () => {
  it('builds one point per period with nulls for missing competitors', () => {
    const rows = [row('You', '2026-10-01', 0.3, null), row('a.nl', '2026-10-01', 0.2, 0.1), row('You', '2026-10-02', 0.35, null)];
    expect(trendPoints(rows, ['You', 'a.nl'])).toEqual([
      { period: '2026-10-01', You: 0.3, 'a.nl': 0.2 },
      { period: '2026-10-02', You: 0.35, 'a.nl': null },
    ]);
  });
  it('reads the chosen metric', () => {
    const rows = [row('You', '2026-10-01', 0.3, null), row('a.nl', '2026-10-01', 0.2, 0.4)];
    expect(trendPoints(rows, ['You', 'a.nl'], 'overlap_rate')).toEqual([{ period: '2026-10-01', You: null, 'a.nl': 0.4 }]);
  });
  it('offers no position metrics for Shopping', () => {
    expect(metricsFor('Shopping').map(m => m.key)).toEqual(['impression_share', 'overlap_rate', 'outranking_share']);
    expect(metricsFor('Search')).toHaveLength(6);
  });
});

describe('newPlayers', () => {
  it('lists competitors absent in the comparison period', () => {
    const now = [row('a.nl', 'p', 0.2, 0.3), row('new.nl', 'p', 0.1, 0.2, { is_capped: true })];
    expect(newPlayers(now, [row('a.nl', 'q', 0.2, 0.3)]).map(p => p.competitor)).toEqual(['new.nl']);
    expect(newPlayers(now, null)).toEqual([]);
  });
});

describe('assignColors', () => {
  it('keeps the base slot for top competitors and fills free slots for others', () => {
    const colors = assignColors(['b', 'x'], ['a', 'b']);
    expect(colors.b).toBe(COMPETITOR_COLORS[1]);
    expect(colors.x).toBe(COMPETITOR_COLORS[0]);
  });
});

describe('defaultGrain', () => {
  it('picks day, week or month from the period length', () => {
    expect(defaultGrain('2026-09-01', '2026-09-30')).toBe('day');
    expect(defaultGrain('2026-04-01', '2026-09-30')).toBe('week');
    expect(defaultGrain('2025-01-01', '2026-09-30')).toBe('month');
  });
});
