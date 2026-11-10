import { describe, expect, it } from 'vitest';
import {
  FeedIssue, FeedItem, filterItems, isStale, issueIndex, issueRows, itemSeverity, scoreTone, snapshotAgeDays, summarize,
} from './feedShaping';

const issues: FeedIssue[] = [
  { code: 'missing_potentially_required_attribute', description: 'Recommended attribute missing', action: '', severity: 'warning', products: 374, blocked: 20 },
  { code: 'landing_page_error', description: 'Product page unreachable', action: '', severity: 'blocking', products: 60, blocked: 60 },
  { code: 'missing_shipping', description: 'Shipping costs missing', action: '', severity: 'blocking', products: 2, blocked: 2 },
  { code: 'not_eligible_out_of_stock', description: 'Out of stock', action: '', severity: 'warning', products: 56, blocked: 56 },
];

const items: FeedItem[] = [
  { offerId: '71483', title: 'Slat cushion 56 x 56 cm', link: 'https://example.nl/a', issueCodes: ['landing_page_error', 'not_eligible_out_of_stock'], adsStatus: 'NOT_ELIGIBLE', merchantStatus: 'DISAPPROVED', availability: 'OUT_OF_STOCK' },
  { offerId: '7200', title: 'Sample cushion - white', link: null, issueCodes: ['not_eligible_out_of_stock'], adsStatus: 'NOT_ELIGIBLE', merchantStatus: 'APPROVED', availability: 'OUT_OF_STOCK' },
  { offerId: '118356', title: 'Steel Fire Bowl - Black', link: 'https://example.nl/c', issueCodes: ['missing_shipping'], adsStatus: 'NOT_ELIGIBLE', merchantStatus: 'DISAPPROVED', availability: 'IN_STOCK' },
];

describe('summarize', () => {
  it('derives shares against items in the feed and flags blocked above 5%', () => {
    const s = summarize({ totals: { itemsInFeed: 293, eligible: 261, blocked: 32, pending: 0, merchantProducts: 293, merchantApproved: 288, merchantDisapproved: 5, merchantPending: 0 } });
    expect(s.eligibleShare).toBeCloseTo(261 / 293, 6);
    expect(s.blockedShare).toBeCloseTo(32 / 293, 6);
    expect(s.blockedAlarm).toBe(true);
  });

  it('does not alarm at or below the 5% threshold and handles an empty feed', () => {
    const under = summarize({ totals: { itemsInFeed: 1914, eligible: 1822, blocked: 92, pending: 1, merchantProducts: 1913, merchantApproved: 1845, merchantDisapproved: 67, merchantPending: 1 } });
    expect(under.blockedShare).toBeCloseTo(92 / 1914, 6);
    expect(under.blockedAlarm).toBe(false);
    const exact = summarize({ totals: { itemsInFeed: 100, eligible: 95, blocked: 5, pending: 0, merchantProducts: 100, merchantApproved: 100, merchantDisapproved: 0, merchantPending: 0 } });
    expect(exact.blockedAlarm).toBe(false);
    const empty = summarize({ totals: { itemsInFeed: 0, eligible: 0, blocked: 0, pending: 0, merchantProducts: 0, merchantApproved: 0, merchantDisapproved: 0, merchantPending: 0 } });
    expect(empty.eligibleShare).toBeNull();
    expect(empty.blockedAlarm).toBe(false);
  });
});

describe('issueRows', () => {
  it('puts blocking codes first, then the largest counts, and computes share', () => {
    const rows = issueRows({ issues, totals: { itemsInFeed: 1914, eligible: 0, blocked: 0, pending: 0, merchantProducts: 0, merchantApproved: 0, merchantDisapproved: 0, merchantPending: 0 } });
    expect(rows.map(r => r.code)).toEqual(['landing_page_error', 'missing_shipping', 'missing_potentially_required_attribute', 'not_eligible_out_of_stock']);
    expect(rows[0].share).toBeCloseTo(60 / 1914, 6);
  });
});

describe('filterItems and itemSeverity', () => {
  const index = issueIndex(issues);

  it('filters by issue code', () => {
    expect(filterItems(items, { issue: 'landing_page_error' }).map(i => i.offerId)).toEqual(['71483']);
  });

  it('searches title, offer id and the issue description, case-insensitively', () => {
    expect(filterItems(items, { query: 'fire bowl' }).map(i => i.offerId)).toEqual(['118356']);
    expect(filterItems(items, { query: '7200' }).map(i => i.offerId)).toEqual(['7200']);
    expect(filterItems(items, { query: 'shipping costs' }, index).map(i => i.offerId)).toEqual(['118356']);
    expect(filterItems(items, { query: '   ' })).toHaveLength(3);
  });

  it('combines issue and query', () => {
    expect(filterItems(items, { issue: 'not_eligible_out_of_stock', query: 'sample' }).map(i => i.offerId)).toEqual(['7200']);
  });

  it('marks an item blocking when any code is blocking', () => {
    expect(itemSeverity(items[0], index)).toBe('blocking');
    expect(itemSeverity(items[1], index)).toBe('warning');
    expect(itemSeverity({ issueCodes: ['unknown_code'] }, index)).toBe('warning');
  });
});

describe('snapshot age and score tone', () => {
  it('counts whole days in UTC and treats anything older than two days as stale', () => {
    const today = new Date(Date.UTC(2026, 9, 13, 9, 0, 0));
    expect(snapshotAgeDays('2026-10-13', today)).toBe(0);
    expect(snapshotAgeDays('2026-06-17', today)).toBe(118);
    expect(isStale('2026-10-12', today)).toBe(false);
    expect(isStale('2026-10-10', today)).toBe(true);
  });

  it('bands scores', () => {
    expect(scoreTone(94)).toBe('good');
    expect(scoreTone(70)).toBe('warn');
    expect(scoreTone(0)).toBe('bad');
    expect(scoreTone(null)).toBe('none');
  });
});
