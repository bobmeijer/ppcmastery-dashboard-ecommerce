import { describe, expect, it } from 'vitest';
import {
  component, mapCampaignDaily, mapCampaignDim, mapConversionsDaily, mapDeviceDaily, mapGeoDaily, mapKeywordDim, mapKeywordQualityDaily, mapProducts,
} from './mapping';

// Rows shaped like the probes against ShopA's account.
const traffic = { Impressions: '59', Clicks: '12', Spend: '10.63', ConversionsQualified: '0.16', Revenue: '122.00' };

describe('campaign dimension', () => {
  it('classifies the Demo Group name and maps type and status', () => {
    expect(mapCampaignDim({ CampaignId: '422149267', CampaignName: '02 | Stoves', CampaignType: 'Search & content', CampaignStatus: 'Active' }))
      .toMatchObject({ campaign_id: '422149267', channel_type: 'SEARCH', status: 'ENABLED', network: 'Search', category: 'Stoves', parsed: true });
    expect(mapCampaignDim({ CampaignId: '422187592', CampaignName: '05 | Generic | NL', CampaignType: 'Shopping', CampaignStatus: 'Deleted' }))
      .toMatchObject({ channel_type: 'SHOPPING', status: 'REMOVED', network: 'Shopping' });
  });
});

describe('daily facts', () => {
  it('maps campaign rows with shares as fractions and drops empty rows', () => {
    const rows = mapCampaignDaily([
      { TimePeriod: '2026-10-01', CampaignId: '1', ...traffic, AllConversionsQualified: '0.16', AllRevenue: '1,122.00',
        ImpressionSharePercent: '66.67%', ImpressionLostToBudgetPercent: '0.00%', ImpressionLostToRankAggPercent: '33.33%',
        TopImpressionRatePercent: '76.47%', AbsoluteTopImpressionRatePercent: '' },
      { TimePeriod: '2026-10-01', CampaignId: '2', Impressions: '0', Clicks: '0', Spend: '0.00', ConversionsQualified: '0.00', Revenue: '0.00',
        AllConversionsQualified: '0.00', AllRevenue: '0.00' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cost: 10.63, conversions: 0.16, conversions_value: 122, all_conversions_value: 1122, abs_top_impression_pct: null });
    expect(rows[0].search_impression_share).toBeCloseTo(0.6667);
  });

  it('skips the no-goal rows and takes view-through out of the conversions', () => {
    const rows = mapConversionsDaily([
      { TimePeriod: '2026-09-01', CampaignId: '1', Goal: '', GoalId: '0', AllConversionsQualified: '0.00', AllRevenue: '0.00', ViewThroughConversionsQualified: '0.00' },
      { TimePeriod: '2026-09-01', CampaignId: '1', Goal: 'purchase', GoalId: '172165239', AllConversionsQualified: '1.16', AllRevenue: '1,122.00', ViewThroughConversionsQualified: '1.00' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ conversion_action_id: '172165239', conversion_action_name: 'purchase', conversions_value: 1122, all_conversions: 1.16, all_conversions_value: 1122 });
    expect(rows[0].conversions).toBeCloseTo(0.16);
  });

  it('keeps physical location only and maps countries onto Google criterion ids', () => {
    const rows = mapGeoDaily([
      { TimePeriod: '2026-10-01', CampaignId: '1', Country: 'Netherlands', LocationType: 'Physical location', ...traffic },
      { TimePeriod: '2026-10-01', CampaignId: '1', Country: 'Netherlands', LocationType: 'Location of interest', ...traffic },
      { TimePeriod: '2026-10-01', CampaignId: '1', Country: 'Spain', LocationType: 'Physical location', ...traffic },
    ]);
    expect(rows.map(r => [r.country_criterion_id, r.country_code, r.impressions])).toEqual([['2528', 'NL', 59], ['ms:Spain', 'Other', 59]]);
  });

  it('maps devices onto Google names and sums duplicates', () => {
    const rows = mapDeviceDaily([
      { TimePeriod: '2026-10-01', CampaignId: '1', DeviceType: 'Computer', ...traffic },
      { TimePeriod: '2026-10-01', CampaignId: '1', DeviceType: 'Smartphone', ...traffic },
      { TimePeriod: '2026-10-01', CampaignId: '1', DeviceType: 'Smartphone', ...traffic },
    ]);
    expect(rows.map(r => [r.device, r.clicks])).toEqual([['DESKTOP', 12], ['MOBILE', 24]]);
  });
});

describe('products', () => {
  const base = {
    CampaignId: '605351592', MerchantProductId: 'AB-11000', Title: 'Fire pit - Black', ProductType1: 'Fire pits',
    ProductType2: 'fire pits for gardens', ProductType3: '', Brand: 'ShopA', CustomLabel0: '11000 - Round', CustomLabel1: 'In stock',
    CustomLabel2: 'Heroes', CustomLabel3: '', CustomLabel4: '', CountryOfSale: 'Belgium', ...traffic,
  };
  it('lowercases ids, types and labels like Google, keeps the title', () => {
    const [row] = mapProducts([{ TimePeriod: '2026-04-01', ...base }], 'fact_date');
    expect(row).toMatchObject({
      fact_date: '2026-04-01', product_item_id: 'ab-11000', product_title: 'Fire pit - Black',
      product_type: 'fire pits > fire pits for gardens', brand: 'shopa', custom_label_2: 'heroes', country_code: 'BE',
    });
  });
  it('merges a label change inside a month; metrics sum, the last label wins', () => {
    const rows = mapProducts([
      { TimePeriod: '2026-04-01', ...base },
      { TimePeriod: '2026-04-01', ...base, CustomLabel2: 'Villains' },
    ], 'fact_month');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fact_month: '2026-04-01', custom_label_2: 'villains', impressions: 118, cost: 21.26 });
  });
});

describe('quality score', () => {
  it('shifts Microsoft components (1-3) onto Google buckets (2-4)', () => {
    expect([component('1'), component('2'), component('3'), component('0'), component('--')]).toEqual([2, 3, 4, null, null]);
  });
  it('maps daily keyword rows and the keyword dimension', () => {
    const [day] = mapKeywordQualityDaily([{ TimePeriod: '2026-10-01', CampaignId: '1', AdGroupId: '9', KeywordId: '7', ...traffic,
      HistoricalQualityScore: '10', HistoricalExpectedCtr: '3', HistoricalAdRelevance: '2', HistoricalLandingPageExperience: '1' }]);
    expect(day).toMatchObject({ criterion_id: '7', quality_score: 10, expected_ctr: 4, ad_relevance: 3, landing_page: 2 });
    const [dim] = mapKeywordDim([{ CampaignId: '1', AdGroupId: '9', AdGroupName: 'garden', KeywordId: '7', Keyword: 'garden', BidMatchType: 'Phrase',
      KeywordStatus: 'Active', QualityScore: '', ExpectedCtr: '', AdRelevance: '', LandingPageExperience: '', Impressions: '0' }]);
    expect(dim).toMatchObject({ keyword_text: 'garden', match_type: 'PHRASE', status: 'ENABLED', quality_score: null });
  });
});
