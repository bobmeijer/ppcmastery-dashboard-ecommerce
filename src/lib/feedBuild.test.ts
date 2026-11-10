import { describe, expect, it } from 'vitest';
import { AdsProduct, blockedItems, buildFeedSnapshot, feedDestinations, feedIssues, feedTotals, MerchantProduct, mergeFeedProducts } from './feedBuild';

const attrs = {
  title: '', image_link: null, price: null, currency: null, availability: null, brand: null, product_type: null,
  custom_label_0: null, custom_label_1: null, custom_label_2: null, custom_label_3: null, custom_label_4: null,
};

const ads = (item_id: string, over: Partial<AdsProduct> = {}): AdsProduct => ({
  ...attrs, feed_label: 'NL', item_id, title: `Ads ${item_id}`, status: 'ELIGIBLE', issues: [], ...over,
});

const merchant = (item_id: string, over: Partial<MerchantProduct> = {}): MerchantProduct => ({
  ...attrs, feed_label: 'NL', item_id, title: `MC ${item_id}`, link: `https://shop.test/${item_id}`,
  destinations: { SHOPPING_ADS: 'APPROVED', FREE_LISTINGS: 'APPROVED' }, issues: [], ...over,
});

describe('mergeFeedProducts', () => {
  it('joins on feed label and item id, case-insensitive, with Google Ads attributes leading', () => {
    const rows = mergeFeedProducts(
      [ads('ABC1', { image_link: 'https://img/ads.jpg', custom_label_2: 'heroes' })],
      [merchant('abc1', { image_link: 'https://img/mc.jpg', price: 49 })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      item_id: 'ABC1', title: 'Ads ABC1', image_link: 'https://img/ads.jpg', price: 49,
      link: 'https://shop.test/abc1', custom_label_2: 'heroes', ads_status: 'ELIGIBLE', merchant_status: 'APPROVED',
    });
  });

  it('keeps the same item in two feed labels apart', () => {
    const rows = mergeFeedProducts([ads('1', { feed_label: 'NL' }), ads('1', { feed_label: 'BE' })], []);
    expect(rows.map(r => r.feed_label)).toEqual(['BE', 'NL']);
  });

  it('adds Merchant-only products without a Google Ads status', () => {
    const rows = mergeFeedProducts([ads('1')], [merchant('1'), merchant('2', { destinations: { SHOPPING_ADS: 'DISAPPROVED' } })]);
    expect(rows.find(r => r.item_id === '2')).toMatchObject({ ads_status: null, merchant_status: 'DISAPPROVED', title: 'MC 2' });
  });

  it('merges issues per code, blocking wins', () => {
    const rows = mergeFeedProducts(
      [ads('1', { status: 'NOT_ELIGIBLE', issues: [{ code: 'missing_shipping', source: 'ads', severity: 'warning', description: 'a' }] })],
      [merchant('1', { issues: [{ code: 'missing_shipping', source: 'merchant', severity: 'blocking', description: 'b' }] })],
    );
    expect(rows[0].issues).toEqual([{ code: 'missing_shipping', source: 'merchant', severity: 'blocking', description: 'b' }]);
  });
});

describe('feed totals and issues', () => {
  const rows = mergeFeedProducts(
    [
      ads('1'),
      ads('2', { status: 'ELIGIBLE_LIMITED' }),
      ads('3', { status: 'NOT_ELIGIBLE', issues: [{ code: 'not_eligible_in_any_campaign', source: 'ads', severity: 'blocking', description: 'No campaigns' }] }),
    ],
    [
      merchant('1'),
      merchant('2', { destinations: { SHOPPING_ADS: 'PENDING' } }),
      merchant('3', { issues: [{ code: 'some_new_code', source: 'merchant', severity: 'warning', description: 'Something new' }] }),
    ],
  );

  it('counts serving status from Google Ads and approval from Merchant', () => {
    expect(feedTotals(rows)).toEqual({
      itemsInFeed: 3, eligible: 2, blocked: 1, pending: 1,
      merchantProducts: 3, merchantApproved: 2, merchantDisapproved: 0, merchantPending: 1,
    });
  });

  it('falls back to Merchant for the feed size when Google Ads lists nothing', () => {
    expect(feedTotals(mergeFeedProducts([], [merchant('1'), merchant('2')])).itemsInFeed).toBe(2);
  });

  it('uses the curated copy when known and Google text otherwise', () => {
    const issues = feedIssues(rows);
    const known = issues.find(i => i.code === 'not_eligible_in_any_campaign')!;
    expect(known).toMatchObject({ description: 'Not included in a campaign', severity: 'blocking', products: 1, blocked: 1 });
    expect(issues.find(i => i.code === 'some_new_code')).toMatchObject({ description: 'Something new', severity: 'warning', blocked: 1 });
  });

  it('lists only items Google Ads will not serve', () => {
    const { items, total } = blockedItems(rows, false);
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ offerId: '3', feedLabel: null, link: 'https://shop.test/3', merchantStatus: 'APPROVED' });
    expect(items[0].issueCodes.sort()).toEqual(['not_eligible_in_any_campaign', 'some_new_code']);
  });

  it('counts destinations from Merchant and drops empty ones', () => {
    const d = feedDestinations([merchant('1'), merchant('2', { destinations: { SHOPPING_ADS: 'DISAPPROVED' } })]);
    expect(d).toEqual([
      { destination: 'SHOPPING_ADS', label: 'Shopping ads', active: 1, pending: 0, disapproved: 1 },
      { destination: 'FREE_LISTINGS', label: 'Free listings', active: 1, pending: 0, disapproved: 0 },
    ]);
  });

  it('builds a live snapshot with history from the daily rows', () => {
    const totals = feedTotals(rows);
    const snapshot = buildFeedSnapshot({
      label: 'shopa', merchantId: '2000000001', rows, fetchedAt: '2026-10-15T05:20:00Z',
      daily: [
        { date: '2026-10-14', totals: { ...totals, blocked: 4 }, by_destination: [] },
        { date: '2026-10-15', totals, by_destination: [] },
      ],
    });
    expect(snapshot.source).toBe('merchant-sync');
    expect(snapshot.snapshotDate).toBe('2026-10-15');
    expect(snapshot.history).toEqual([{ date: '2026-10-14', eligible: 2, blocked: 4 }, { date: '2026-10-15', eligible: 2, blocked: 1 }]);
    expect(snapshot.audit).toBeNull();
  });
});
