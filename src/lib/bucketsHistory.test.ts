import { describe, expect, it } from 'vitest';
import { buildBucketHistory, LabelDayTuple } from './bucketsHistory';
import type { FeedProductInfo } from './productsShaping';

const t = (date: string, id: string, label: string, cost: number, value = 0, type = 'garden chairs > dining chairs'): LabelDayTuple =>
  [date, id, label, 100, 10, cost, value > 0 ? 1 : 0, value, type];

const feed = (item_id: string, custom_label_2: string, product_type = 'garden chairs > dining chairs'): FeedProductInfo => ({
  item_id, feed_label: 'NL', title: `Title ${item_id}`, link: `https://shop.test/${item_id}`, image_link: null, product_type,
  brand: null, availability: 'IN_STOCK', ads_status: 'ELIGIBLE', custom_label_2,
});

// p1: hero two days then villain (and still villain in the feed); p2: sidekick throughout; p3: outlet zombie.
const tuples: LabelDayTuple[] = [
  t('2026-10-01', 'p1', 'heroes', 300, 900),
  t('2026-10-02', 'p1', 'heroes', 300, 0),
  t('2026-10-06', 'p1', 'villains', 80, 300),
  t('2026-10-07', 'p1', 'villains', 60, 0),
  t('2026-10-01', 'p2', 'sidekicks', 20, 100),
  t('2026-10-07', 'p2', 'sidekicks', 20, 0),
  t('2026-10-03', 'p3', 'zombies', 5, 0, 'outlet'),
];
const base = { tuples, feed: [feed('p1', 'villains'), feed('p2', 'heroes'), feed('p3', 'zombies', 'outlet')], start: '2026-10-01', end: '2026-10-07', filter: { l1: null, l2: [] }, excludedByDefault: ['outlet'] };

describe('buildBucketHistory', () => {
  const view = buildBucketHistory(base);

  it('applies the product type default and reports it', () => {
    expect(view.type_filter).toEqual({ isDefault: true, excluded: ['outlet'], active: true });
    expect(view.distribution.moment.map(d => d.label)).toEqual(['H', 'S', 'V']);
  });

  it('counts the day label at the moment, and the feed label for current', () => {
    expect(view.distribution.moment.map(d => [d.label, d.products, d.cost])).toEqual([['H', 1, 600], ['S', 1, 40], ['V', 1, 140]]);
    // p2 is a hero in the feed now, p1 a villain: the whole period moves under those labels.
    expect(view.distribution.current.map(d => [d.label, d.products, d.cost])).toEqual([['H', 1, 40], ['V', 1, 740]]);
    expect(view.distribution.current.find(d => d.label === 'V')!.cost_share).toBe(0.9487);
    // Total: p1 counts once although it shows under H and V at the moment.
    expect(view.distribution_total).toMatchObject({ name: 'Total', products: 2, cost: 780, cost_share: 1 });
  });

  it('builds the transitions from first to last label, with cost and movers per cell', () => {
    expect(view.transitions.cells).toEqual([{ from: 'H', to: 'V', count: 1, cost: 740, moved: 1 }, { from: 'S', to: 'S', count: 1, cost: 40, moved: 0 }]);
  });

  it('lists movers with before and after the last switch', () => {
    expect(view.movers_count).toBe(1);
    expect(view.movers[0]).toMatchObject({ id: 'p1', path: ['H', 'V'], from: 'H', to: 'V', direction: 'down', switchDate: '2026-10-06', cost: 740 });
    // One char per day: H on 1-2, carried h on 3-5 (no data), V on 6-7.
    expect(view.movers[0].strip).toBe('HHhhhVV');
    expect(view.movers[0].before).toMatchObject({ activeDays: 2, costPerDay: 300, roas: 1.5 });
    expect(view.movers[0].after).toMatchObject({ activeDays: 2, costPerDay: 70, roas: 2.1429 });
    expect(view.products.p1).toMatchObject({ title: 'Title p1', label: 'V', type_l1: 'garden chairs', link: 'https://shop.test/p1' });
  });

  it('draws the history per day for short periods and per Monday week for long ones', () => {
    expect(view.grain).toBe('day');
    expect(view.history.find(h => h.period === '2026-10-01')).toMatchObject({ cost_H: 300, cost_S: 20, products_H: 1 });
    const long = buildBucketHistory({ ...base, start: '2026-08-01', end: '2026-10-07' });
    expect(long.grain).toBe('week');
    expect(long.history.map(h => [h.period, h.cost_H, h.cost_V, !!h.partial])).toEqual([
      ['2026-09-28', 600, undefined, false],
      ['2026-10-05', undefined, 140, true],
    ]);
  });

  it('leaves days without a label out of every block', () => {
    const v = buildBucketHistory({ ...base, tuples: [...tuples, t('2026-10-04', 'p1', '', 50), t('2026-10-02', 'p8', null as unknown as string, 9)] });
    expect(v.distribution.moment.map(d => d.label)).toEqual(['H', 'S', 'V']);
    expect(v.distribution_total).toMatchObject({ products: 2, cost: 780 });
    expect(v.movers[0].path).toEqual(['H', 'V']);
  });

  it('keeps a flip-flop path and uses the last run as after', () => {
    const flip = buildBucketHistory({ ...base, tuples: [t('2026-10-01', 'p9', 'heroes', 10), t('2026-10-02', 'p9', 'villains', 10), t('2026-10-03', 'p9', 'heroes', 30)] });
    expect(flip.movers[0]).toMatchObject({ path: ['H', 'V', 'H'], from: 'H', to: 'H', direction: 'up', switchDate: '2026-10-03' });
    // Before = the run right before the last switch (the V day), not everything before it.
    expect(flip.movers[0].before).toMatchObject({ activeDays: 1, cost: 10 });
    expect(flip.transitions.cells).toEqual([{ from: 'H', to: 'H', count: 1, cost: 50, moved: 1 }]);
  });

  it('summarises what a switch does on complete days only', () => {
    const v = buildBucketHistory({ ...base, lagCutoff: '2026-10-06' });
    expect(v.effects_cutoff).toBe('2026-10-06');
    // p1: H 300 + 300 on two days, then V 80 on the 6th; the 7th is in the lag and left out.
    expect(v.effects).toHaveLength(1);
    expect(v.effects[0]).toMatchObject({ from: 'H', to: 'V', direction: 'down', products: 1, costPerDayChange: -0.7333 });
    expect(v.effects[0].before).toMatchObject({ costPerDay: 300, roas: 1.5 });
    expect(v.effects[0].after).toMatchObject({ costPerDay: 80, roas: 3.75 });
    expect(v.effects[0].roasChange).toBe(1.5);
    // Switch inside the lag: nothing complete after it, so no effect row.
    expect(buildBucketHistory({ ...base, lagCutoff: '2026-10-05' }).effects).toEqual([]);
  });

  it('measures label stability: switches per product, days in a label, switches per week', () => {
    const v = buildBucketHistory(base);
    // p1 switched once (H on 1 Oct, V from 6 Oct), p2 never; p3 is outlet (excluded).
    expect(v.stability.summary).toMatchObject({ products: 2, completedRuns: 1, meanRunDays: 5, medianRunDays: 5 });
    expect(v.stability.summary.bySwitches.map(b => [b.switches, b.products])).toEqual([[0, 1], [1, 1], [2, 0], [3, 0]]);
    expect(v.stability.weeks).toEqual([
      { period: '2026-09-28', partial: true, switches: 0, products: 2, share: 0 },
      { period: '2026-10-05', partial: true, switches: 1, products: 2, share: 0.5 },
    ]);
    const flip = buildBucketHistory({ ...base, tuples: [t('2026-10-01', 'p9', 'heroes', 1), t('2026-10-02', 'p9', 'villains', 1), t('2026-10-03', 'p9', 'heroes', 1), t('2026-10-04', 'p9', 'zombies', 1)] });
    expect(flip.stability.summary.bySwitches.find(b => b.switches === 3)!.products).toBe(1);
    expect(flip.stability.summary.medianRunDays).toBe(1);
  });
});
