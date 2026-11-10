import { describe, expect, it } from 'vitest';
import { buildSummary, clampChangeWindow, dedupeChangeEvents, localDateTimeToIso, mapChangeEvent } from './changeEvents';

describe('localDateTimeToIso', () => {
  it('converts Amsterdam summer time to UTC', () => {
    expect(localDateTimeToIso('2026-07-01 14:30:00')).toBe('2026-07-01T12:30:00.000Z');
  });
  it('converts Amsterdam winter time to UTC and keeps fractions', () => {
    expect(localDateTimeToIso('2026-01-15 09:00:00.250000')).toBe('2026-01-15T08:00:00.250Z');
  });
  it('rejects garbage', () => {
    expect(localDateTimeToIso('')).toBeNull();
    expect(localDateTimeToIso('yesterday')).toBeNull();
  });
});

describe('buildSummary', () => {
  it('describes a budget change', () => {
    expect(buildSummary({
      resourceType: 'CAMPAIGN_BUDGET', operation: 'UPDATE', fields: ['amount_micros'],
      oldResource: { campaign_budget: { amount_micros: '150000000' } }, newResource: { campaign_budget: { amount_micros: '200000000' } },
    })).toBe('Campaign budget: 150 -> 200 per day');
  });
  it('describes a pause', () => {
    expect(buildSummary({
      resourceType: 'CAMPAIGN', operation: 'UPDATE', fields: ['status'],
      oldResource: { campaign: { status: 2 } }, newResource: { campaign: { status: 3 } },
    })).toBe('Campaign paused');
  });
  it('describes a tROAS change', () => {
    expect(buildSummary({
      resourceType: 'CAMPAIGN', operation: 'UPDATE', fields: ['maximize_conversion_value.target_roas'],
      oldResource: { campaign: { maximize_conversion_value: { target_roas: 4 } } },
      newResource: { campaign: { maximize_conversion_value: { target_roas: 3.5 } } },
    })).toBe('tROAS: 400% -> 350%');
  });
  it('describes ads and keywords', () => {
    expect(buildSummary({ resourceType: 'AD_GROUP_AD', operation: 'CREATE', fields: [], oldResource: {}, newResource: {} }))
      .toBe('Ad added');
    expect(buildSummary({
      resourceType: 'AD_GROUP_CRITERION', operation: 'REMOVE', fields: [],
      oldResource: { ad_group_criterion: { keyword: { text: 'garden bench' } } }, newResource: {},
    })).toBe('Keyword removed: garden bench');
    expect(buildSummary({
      resourceType: 'CAMPAIGN_CRITERION', operation: 'CREATE', fields: [],
      oldResource: {}, newResource: { campaign_criterion: { negative: true, keyword: { text: 'free' } } },
    })).toBe('Negative keyword (campaign) added: free');
  });
  it('names Shopping product partitions and campaign locations', () => {
    expect(buildSummary({
      resourceType: 'AD_GROUP_CRITERION', operation: 'CREATE', fields: ['ad_group', 'listing_group.type', 'negative'],
      oldResource: {}, newResource: { ad_group_criterion: { listing_group: { type: 2 }, negative: false } },
    })).toBe('Product group added');
    expect(buildSummary({
      resourceType: 'AD_GROUP_CRITERION', operation: 'UPDATE', fields: ['cpc_bid_micros'],
      oldResource: { ad_group_criterion: { cpc_bid_micros: 300000 } },
      newResource: { ad_group_criterion: { listing_group: { type: 2 }, cpc_bid_micros: 500000 } },
    })).toBe('Product group bid: 0.3 -> 0.5');
    expect(buildSummary({
      resourceType: 'CAMPAIGN_CRITERION', operation: 'CREATE', fields: ['campaign', 'location.geo_target_constant', 'negative'],
      oldResource: {}, newResource: { campaign_criterion: { location: { geo_target_constant: 'geoTargetConstants/2528' }, negative: true } },
    })).toBe('Location (exclusion) added');
  });
  it('maps the bidding strategy enum on an update and skips it on create', () => {
    expect(buildSummary({
      resourceType: 'CAMPAIGN', operation: 'UPDATE', fields: ['bidding_strategy_type'],
      oldResource: { campaign: { bidding_strategy_type: 6 } }, newResource: { campaign: { bidding_strategy_type: 10 } },
    })).toBe('Bid strategy: MANUAL_CPC -> MAXIMIZE_CONVERSION_VALUE');
    expect(buildSummary({
      resourceType: 'CAMPAIGN', operation: 'CREATE', fields: ['bidding_strategy_type', 'name', 'status'],
      oldResource: {}, newResource: { campaign: { bidding_strategy_type: 3, status: 2, name: 'X' } },
    })).toBe('Campaign created');
  });
  it('falls back to type, operation and field names', () => {
    expect(buildSummary({
      resourceType: 'CAMPAIGN_ASSET', operation: 'UPDATE', fields: ['campaign_asset.status', 'campaign_asset.field_type'],
      oldResource: {}, newResource: {},
    })).toBe('Campaign asset changed (status, field_type)');
  });
});

describe('mapChangeEvent', () => {
  it('maps enum ints and the field mask', () => {
    const row = mapChangeEvent({
      change_event: {
        change_date_time: '2026-10-10 10:00:00', change_resource_type: 6, change_resource_name: 'customers/1/campaignBudgets/2',
        resource_change_operation: 3, changed_fields: { paths: ['amount_micros'] }, client_type: 2, user_email: 'admin@example.com',
        old_resource: { campaign_budget: { amount_micros: 1000000 } }, new_resource: { campaign_budget: { amount_micros: 2000000 } },
      },
      campaign: { id: 99, name: '08 | PMax' },
    });
    expect(row).toMatchObject({
      change_time: '2026-10-10T08:00:00.000Z', resource_type: 'CAMPAIGN_BUDGET', operation: 'UPDATE', campaign_id: '99',
      campaign_name: '08 | PMax', changed_fields: ['amount_micros'], summary: 'Campaign budget: 1 -> 2 per day',
      client_type: 'GOOGLE_ADS_WEB_CLIENT', user_email: 'admin@example.com',
    });
  });
  it('drops rows without a time or name', () => {
    expect(mapChangeEvent({ change_event: { change_resource_name: 'x' } })).toBeNull();
  });
});

describe('dedupeChangeEvents', () => {
  it('merges two operations on one resource in the same second', () => {
    const base = {
      change_time: '2026-10-10T08:00:00.000Z', resource_name: 'customers/1/campaigns/2', resource_type: 'CAMPAIGN', operation: 'UPDATE',
      campaign_id: '2', campaign_name: 'A', user_email: '', client_type: '',
    };
    const rows = dedupeChangeEvents([
      { ...base, changed_fields: ['status'], summary: 'Campaign paused' },
      { ...base, changed_fields: ['name'], summary: 'Campaign name: A -> B' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].changed_fields).toEqual(['status', 'name']);
    expect(rows[0].summary).toBe('Campaign paused; Campaign name: A -> B');
  });
});

describe('clampChangeWindow', () => {
  const today = new Date('2026-10-14T12:00:00Z');
  it('clamps a start older than the reach', () => {
    expect(clampChangeWindow('2026-01-01', '2026-10-13', today)).toEqual({ start: '2026-09-15', end: '2026-10-13' });
  });
  it('keeps a recent window', () => {
    expect(clampChangeWindow('2026-10-12', '2026-10-13', today)).toEqual({ start: '2026-10-12', end: '2026-10-13' });
  });
  it('returns null when the window is entirely out of reach', () => {
    expect(clampChangeWindow('2026-01-01', '2026-02-01', today)).toBeNull();
  });
});
