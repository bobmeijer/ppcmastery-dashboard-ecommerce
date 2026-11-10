import { describe, expect, it } from 'vitest';
import { applyChip, buildProductsReport, FeedProductInfo, ProductFactRow, searchProducts } from './productsShaping';

const row = (over: Partial<ProductFactRow>): ProductFactRow => ({
  account_id: '1000000001', campaign_id: '1', campaign_name: '08 | Garden Chairs [H+S]', network: 'PMax', category: 'Garden Chairs', campaign_bucket: 'H+S',
  product_item_id: 'p1', product_title: 'Product 1', product_type: 'garden chairs > dining chairs', brand: 'Shop A',
  custom_label_0: null, custom_label_1: null, custom_label_2: 'heroes', custom_label_3: null, custom_label_4: null,
  country_code: 'NL', impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0, source: 'daily',
  ...over,
});

const feed = (over: Partial<FeedProductInfo>): FeedProductInfo => ({
  item_id: 'p1', feed_label: 'NL', title: 'Feed title 1', link: 'https://shop.test/p1', image_link: 'https://img.test/p1.jpg',
  product_type: 'garden chairs > dining chairs', brand: 'Shop A', availability: 'IN_STOCK', ads_status: 'ELIGIBLE', custom_label_2: 'villains',
  ...over,
});

describe('buildProductsReport', () => {
  const rows: ProductFactRow[] = [
    // p1: hero until the switch, villain after; strings like the RPC returns
    row({ impressions: '1000', clicks: '50', cost: '300', conversions: '3', conversions_value: '900' }),
    row({ campaign_name: '08 | Garden Chairs [V+Z]', campaign_bucket: 'V+Z', custom_label_2: 'villains', impressions: 400, clicks: 20, cost: 80, conversions: 0, conversions_value: 0 }),
    // p2: spends above 25 with no purchase
    row({ product_item_id: 'p2', product_title: 'Product 2', custom_label_2: 'sidekicks', product_type: 'benches > teak benches', impressions: 800, clicks: 40, cost: 30 }),
    // p3: impressions, no clicks
    row({ product_item_id: 'p3', product_title: 'Product 3', custom_label_2: 'zombies', product_type: 'outlet', impressions: 50 }),
  ];
  const feedRows = [
    feed({}),
    feed({ feed_label: 'BE', title: 'BE title' }),
    feed({ item_id: 'p2', title: 'Product 2', product_type: 'benches > teak benches', custom_label_2: 'sidekicks', link: null, image_link: null }),
    // p4: in the feed, never shown in the period
    feed({ item_id: 'p4', title: 'Product 4', product_type: 'benches > steel benches', custom_label_2: 'zombies' }),
  ];

  it('uses the current feed label, keeps the split per label and the NL feed row', () => {
    const report = buildProductsReport(rows, feedRows);
    const p1 = report.products.find(p => p.id === 'p1')!;
    expect(p1).toMatchObject({ title: 'Feed title 1', link: 'https://shop.test/p1', image: 'https://img.test/p1.jpg', label: 'V', cost: 380, conversions_value: 900, roas: 2.3684, type_l1: 'garden chairs', type_l2: 'dining chairs' });
    expect(p1.label_split).toEqual([{ label: 'H', cost: 300, conversions_value: 900 }, { label: 'V', cost: 80, conversions_value: 0 }]);
  });

  it('adds feed products without impressions and keeps products that left the feed', () => {
    const report = buildProductsReport(rows, feedRows);
    expect(report.products.map(p => p.id).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(report.products.find(p => p.id === 'p4')).toMatchObject({ in_feed: true, impressions: 0, label: 'Z' });
    expect(report.products.find(p => p.id === 'p3')).toMatchObject({ in_feed: false, label: 'Z' });
  });

  it('summarises per current bucket in H, S, V, Z order', () => {
    const report = buildProductsReport(rows, feedRows);
    expect(report.labelled).toBe(true);
    expect(report.buckets.map(b => [b.label, b.name, b.products, b.cost])).toEqual([['S', 'Sidekicks', 1, 30], ['V', 'Villains', 1, 380], ['Z', 'Zombies', 2, 0]]);
    expect(report.buckets.find(b => b.label === 'V')!.revenue_share).toBe(1);
  });

  it('leaves out the default exclusions and reports them', () => {
    const report = buildProductsReport(rows, feedRows, { l1: null, l2: [] }, ['outlet']);
    expect(report.products.map(p => p.id).sort()).toEqual(['p1', 'p2', 'p4']);
    expect(report.type_filter).toEqual({ isDefault: true, excluded: ['outlet'] });
    expect(report.type_options.find(o => o.l1 === 'outlet')).toMatchObject({ excludedByDefault: true, products: 1 });
  });

  it('rolls up on level 2 when one level 1 is chosen', () => {
    const report = buildProductsReport(rows, feedRows, { l1: ['benches'], l2: [] }, ['outlet']);
    expect(report.by_type_level).toBe(2);
    expect(report.by_type.map(t => [t.name, t.products])).toEqual([['teak benches', 1], ['steel benches', 1]]);
    const narrowed = buildProductsReport(rows, feedRows, { l1: ['benches'], l2: ['teak benches'] }, []);
    expect(narrowed.products.map(p => p.id)).toEqual(['p2']);
  });

  it('handles an empty period without a feed', () => {
    const report = buildProductsReport([], []);
    expect(report).toMatchObject({ source: null, labelled: false, products: [], buckets: [] });
  });
});

describe('client helpers', () => {
  const report = buildProductsReport([row({ cost: 10, impressions: 10 })], [feed({}), feed({ item_id: 'p9', title: 'Another item', custom_label_2: null })]);

  it('filters on bucket chips', () => {
    expect(applyChip(report.products, { kind: 'label', label: 'V' }).map(p => p.id)).toEqual(['p1']);
    expect(applyChip(report.products, { kind: 'label', label: '' }).map(p => p.id)).toEqual(['p9']);
    expect(applyChip(report.products, { kind: 'all' })).toHaveLength(2);
  });

  it('searches on title, id and brand', () => {
    expect(searchProducts(report.products, 'another').map(p => p.id)).toEqual(['p9']);
    expect(searchProducts(report.products, 'P1').map(p => p.id)).toEqual(['p1']);
  });
});
