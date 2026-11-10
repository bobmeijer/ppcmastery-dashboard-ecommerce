import { describe, expect, it } from 'vitest';
import { classifyCampaign, normaliseBucket } from './campaignParser';

describe('classifyCampaign', () => {
  it('parses a PMax bucket campaign', () => {
    expect(classifyCampaign('08 | Garden Chairs [H+S]', 'PERFORMANCE_MAX')).toEqual({
      network: 'PMax', category: 'Garden Chairs', bucket: 'H+S', parsed: true,
    });
  });

  it('parses Search campaigns with variants in angle brackets', () => {
    expect(classifyCampaign('02 | Garden Tables <STM ON + UI config>', 'SEARCH')).toEqual({
      network: 'Search', category: 'Garden Tables', bucket: '', parsed: true,
    });
  });

  it('maps prefix 01 to Brand Search and 05 to Shopping', () => {
    expect(classifyCampaign('01 | Brand', 'SEARCH').category).toBe('Brand');
    expect(classifyCampaign('05 | Brand', 'SHOPPING').network).toBe('Shopping');
  });

  it('collapses the Boost feeder bucket', () => {
    expect(classifyCampaign('05 | Stoves [Boost - Feeder]', 'SHOPPING')).toEqual({
      network: 'Shopping', category: 'Stoves', bucket: 'Boost', parsed: true,
    });
  });

  it('keeps combined buckets and the All bucket', () => {
    expect(classifyCampaign('08 | Stoves [H+S+V]', 'PERFORMANCE_MAX').bucket).toBe('H+S+V');
    expect(classifyCampaign('08 | Benches [All]', 'PERFORMANCE_MAX').bucket).toBe('All');
  });

  it('falls back to the channel type when the name does not match', () => {
    expect(classifyCampaign('Shopping - all products', 'SHOPPING')).toEqual({
      network: 'Shopping', category: 'Other', bucket: '', parsed: false,
    });
    expect(classifyCampaign('', 10).network).toBe('PMax');
  });

  it('normalises old category spellings', () => {
    expect(classifyCampaign('02 | Fire pits', 'SEARCH').category).toBe('Stoves');
    expect(classifyCampaign('08 | Planters [V+Z]', 'PERFORMANCE_MAX').category).toBe('Planters + Pots');
  });

  it('keeps unknown bucket text instead of dropping it', () => {
    expect(normaliseBucket('tROAS 575%')).toBe('tROAS 575%');
  });

  it('lets an unambiguous channel type win over the prefix', () => {
    expect(classifyCampaign('03 | Display', 'DISPLAY').network).toBe('Display');
    expect(classifyCampaign('04 | YouTube', 'VIDEO').network).toBe('Video');
    expect(classifyCampaign('02 | Stoves', 'SEARCH').network).toBe('Search');
    expect(classifyCampaign('08 | Garden Chairs [H]', 'PERFORMANCE_MAX').network).toBe('PMax');
  });
});
