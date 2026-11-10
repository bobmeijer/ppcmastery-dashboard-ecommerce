import { describe, expect, it } from 'vitest';
import {
  activeDevices, deviceKey, deviceMatrix, DeviceFactRow, deviceTiles, matrixTotal, mobileDesktopFinding, roasByPeriod, shareByPeriod,
} from './devicesShaping';

const row = (over: Partial<DeviceFactRow>): DeviceFactRow => ({
  account_id: '1', period: '2026-09-01', campaign_id: 'c1', campaign_name: 'Campaign 1', status: 'ENABLED', category: 'Stoves', network: 'Shopping', device: 'MOBILE',
  impressions: 100, clicks: 10, cost: 100, conversions: 1, conversions_value: 55, ...over,
});

// Mirrors the Shop B picture: mobile ~84% of cost at ROAS 0.55, desktop ~15% at 2.3.
const sample: DeviceFactRow[] = [
  row({ device: 'MOBILE', cost: 840, conversions: 7, conversions_value: 462, clicks: 700 }),
  row({ device: 'DESKTOP', cost: 150, conversions: 3, conversions_value: 345, clicks: 100 }),
  row({ device: 'TABLET', cost: 10, conversions: 0, conversions_value: 0, clicks: 5 }),
  row({ device: 'MOBILE', period: '2026-09-02', cost: 50, conversions: 1, conversions_value: 50, clicks: 40, category: 'Fire pits', network: 'Search' }),
  row({ device: 'DESKTOP', period: '2026-09-02', cost: 50, conversions: 1, conversions_value: 150, clicks: 20, category: 'Fire pits', network: 'Search' }),
];

describe('deviceKey', () => {
  it('keeps the three main devices and folds the rest into other', () => {
    expect(deviceKey('MOBILE')).toBe('mobile');
    expect(deviceKey('DESKTOP')).toBe('desktop');
    expect(deviceKey('TABLET')).toBe('tablet');
    expect(deviceKey('OTHER')).toBe('other');
    expect(deviceKey('CONNECTED_TV')).toBe('other');
    expect(deviceKey('')).toBe('other');
    expect(deviceKey(undefined)).toBe('other');
  });
});

describe('activeDevices', () => {
  it('lists only devices with cost, in canonical order', () => {
    expect(activeDevices(sample).map(d => d.key)).toEqual(['mobile', 'desktop', 'tablet']);
    expect(activeDevices([row({ device: 'CONNECTED_TV' }), row({ device: 'DESKTOP' })]).map(d => d.key)).toEqual(['desktop', 'other']);
    expect(activeDevices([])).toEqual([]);
  });

  it('ignores OTHER rows that have impressions but no spend (as Google reports them)', () => {
    const rows = [row({ device: 'MOBILE' }), row({ device: 'OTHER', cost: 0, clicks: 0, conversions: 0, conversions_value: 0, impressions: 300 })];
    expect(activeDevices(rows).map(d => d.key)).toEqual(['mobile']);
    expect(deviceTiles(rows, []).map(t => t.key)).toEqual(['mobile', 'desktop', 'tablet']);
  });
});

describe('deviceTiles', () => {
  it('computes share of cost, ROAS and CVR per device', () => {
    const tiles = deviceTiles(sample, []);
    expect(tiles.map(t => t.key)).toEqual(['mobile', 'desktop', 'tablet']);
    const mobile = tiles[0];
    expect(mobile.current.cost).toBe(890);
    expect(mobile.share).toBeCloseTo(890 / 1100);
    expect(mobile.current.roas).toBeCloseTo(512 / 890);
    expect(mobile.current.cvr).toBeCloseTo(8 / 740);
    expect(mobile.previous).toBeNull();
    expect(mobile.previousShare).toBeNull();
    expect(tiles[2].current.roas).toBe(0);
    expect(tiles[2].current.cpa).toBeNull();
  });

  it('keeps tablet at zero and hides other until it carries traffic', () => {
    const tiles = deviceTiles([row({ device: 'MOBILE' })], []);
    expect(tiles.map(t => t.key)).toEqual(['mobile', 'desktop', 'tablet']);
    expect(tiles[1].current.cost).toBe(0);
    expect(tiles[1].share).toBe(0);
    const withTv = deviceTiles([row({ device: 'MOBILE' }), row({ device: 'CONNECTED_TV', cost: 5 })], []);
    expect(withTv.map(t => t.key)).toEqual(['mobile', 'desktop', 'tablet', 'other']);
    expect(withTv[3].current.cost).toBe(5);
  });

  it('attaches the comparison period when present', () => {
    const tiles = deviceTiles(sample, [row({ device: 'MOBILE', cost: 400 }), row({ device: 'DESKTOP', cost: 600 })]);
    expect(tiles[0].previous?.cost).toBe(400);
    expect(tiles[0].previousShare).toBeCloseTo(0.4);
    expect(tiles[2].previous?.cost).toBe(0);
  });

  it('returns null shares on an empty period', () => {
    const tiles = deviceTiles([], []);
    expect(tiles).toHaveLength(3);
    expect(tiles[0].share).toBeNull();
  });
});

describe('shareByPeriod', () => {
  it('yields fractions that sum to one per period', () => {
    const points = shareByPeriod(sample);
    expect(points.map(p => p.period)).toEqual(['2026-09-01', '2026-09-02']);
    expect(points[0].mobile).toBeCloseTo(0.84);
    expect(points[0].desktop).toBeCloseTo(0.15);
    expect(points[0].tablet).toBeCloseTo(0.01);
    expect(points[0].other).toBe(0);
    expect(points[1].mobile).toBeCloseTo(0.5);
    expect((points[1].mobile ?? 0) + (points[1].desktop ?? 0) + (points[1].tablet ?? 0) + (points[1].other ?? 0)).toBeCloseTo(1);
  });

  it('leaves a zero-cost period null instead of dividing by zero', () => {
    const points = shareByPeriod([row({ cost: 0 })]);
    expect(points[0].mobile).toBeNull();
    expect(points[0].desktop).toBeNull();
  });
});

describe('roasByPeriod', () => {
  it('computes ROAS per device per period, null without traffic', () => {
    const points = roasByPeriod(sample);
    expect(points[0].mobile).toBeCloseTo(0.55);
    expect(points[0].desktop).toBeCloseTo(2.3);
    expect(points[0].tablet).toBe(0);
    expect(points[0].other).toBeNull();
    expect(points[1].desktop).toBeCloseTo(3);
    expect(points[1].tablet).toBeNull();
  });
});

describe('deviceMatrix', () => {
  it('builds category x device cells sorted by row cost', () => {
    const rows = deviceMatrix(sample, 'category');
    expect(rows.map(r => r.name)).toEqual(['Stoves', 'Fire pits']);
    expect(rows[0].cost).toBe(1000);
    expect(rows[0].cells.mobile?.cost).toBe(840);
    expect(rows[0].cells.mobile?.roas).toBeCloseTo(0.55);
    expect(rows[0].cells.mobile?.cvr).toBeCloseTo(0.01);
    expect(rows[0].cells.desktop?.roas).toBeCloseTo(2.3);
    expect(rows[1].cells.tablet).toBeUndefined();
    expect(rows[1].cells.other).toBeUndefined();
  });

  it('builds display-network x device cells in NETWORK_ORDER and falls back to Other for blanks', () => {
    const rows = deviceMatrix([...sample, row({ network: '', cost: 1 })], 'network');
    expect(rows.map(r => r.name)).toEqual(['Non-Branded Search', 'Non-Branded Shopping', 'Other']);
    expect(rows[0].cells.mobile?.cost).toBe(50);
    expect(rows[1].cost).toBe(1000);
  });

  it('splits Search and Shopping on Brand, PMax counts as Shopping', () => {
    const rows = deviceMatrix([
      row({ network: 'PMax', cost: 30 }),
      row({ network: 'Shopping', category: 'Brand', cost: 2 }),
      row({ network: 'Search', category: 'Brand', cost: 4 }),
    ], 'network');
    expect(rows.map(r => r.name)).toEqual(['Branded Search', 'Branded Shopping', 'Non-Branded Shopping']);
  });

  it('attaches the comparison-period cells per row', () => {
    const previous = [row({ device: 'MOBILE', cost: 400 }), row({ device: 'DESKTOP', cost: 60 })];
    const rows = deviceMatrix(sample, 'category', previous);
    expect(rows[0].previous?.cost).toBe(460);
    expect(rows[0].previous?.cells.mobile?.cost).toBe(400);
    expect(rows[1].previous?.cost).toBe(0);
    expect(deviceMatrix(sample, 'category')[0].previous).toBeNull();
    expect(matrixTotal(sample, previous).previous?.cells.desktop?.cost).toBe(60);
  });

  it('totals per device across the whole period', () => {
    const total = matrixTotal(sample);
    expect(total.name).toBe('Total');
    expect(total.cost).toBe(1100);
    expect(total.cells.mobile?.cost).toBe(890);
    expect(total.cells.desktop?.conversions).toBe(4);
    expect(total.cells.other).toBeUndefined();
  });
});

describe('mobileDesktopFinding', () => {
  it('fires when mobile ROAS is below half of desktop ROAS', () => {
    const finding = mobileDesktopFinding(deviceTiles(sample, []));
    expect(finding).not.toBeNull();
    expect(finding?.mobileRoas).toBeCloseTo(512 / 890);
    expect(finding?.desktopRoas).toBeCloseTo(495 / 200);
    expect(finding?.text).toContain('below half');
    expect(finding?.text).toContain('Mobile');
    expect(finding?.text).toContain('Desktop');
    expect(finding?.text).not.toMatch(/advice|should|must/i);
  });

  it('stays quiet at or above half', () => {
    const even = [row({ device: 'MOBILE', cost: 100, conversions_value: 120 }), row({ device: 'DESKTOP', cost: 100, conversions_value: 240 })];
    expect(mobileDesktopFinding(deviceTiles(even, []))).toBeNull();
    const better = [row({ device: 'MOBILE', cost: 100, conversions_value: 300 }), row({ device: 'DESKTOP', cost: 100, conversions_value: 240 })];
    expect(mobileDesktopFinding(deviceTiles(better, []))).toBeNull();
  });

  it('needs both devices with spend and desktop revenue', () => {
    expect(mobileDesktopFinding(deviceTiles([row({ device: 'MOBILE' })], []))).toBeNull();
    expect(mobileDesktopFinding(deviceTiles([row({ device: 'MOBILE' }), row({ device: 'DESKTOP', conversions_value: 0 })], []))).toBeNull();
    expect(mobileDesktopFinding(deviceTiles([], []))).toBeNull();
  });

  it('fires on zero mobile revenue with mobile spend', () => {
    const rows = [row({ device: 'MOBILE', cost: 100, conversions: 0, conversions_value: 0 }), row({ device: 'DESKTOP', cost: 100, conversions_value: 240 })];
    expect(mobileDesktopFinding(deviceTiles(rows, []))?.mobileRoas).toBe(0);
  });
});
