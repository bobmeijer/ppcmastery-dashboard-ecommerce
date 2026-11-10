import 'server-only';
import { enums, type Customer } from 'google-ads-api';
import { micros, num, queryWithRetry } from './client';

// Quality Score: per keyword per day the historical Quality Score
// of that day with its three components, and the keyword dimension with the
// current Quality Score. Components keep Google's QualityScoreBucket number
// (2 below average, 3 average, 4 above average); 0 / 1 (unspecified, unknown) become null.

const bucket = (value: unknown): number | null => {
  const n = Number(value);
  return n >= 2 && n <= 4 ? n : null;
};
const score = (value: unknown): number | null => {
  const n = Number(value);
  return n >= 1 && n <= 10 ? n : null;
};

export interface KeywordQualityRow {
  fact_date: string;
  campaign_id: string;
  ad_group_id: string;
  criterion_id: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  quality_score: number | null;
  expected_ctr: number | null;
  ad_relevance: number | null;
  landing_page: number | null;
}

// Only days with impressions: a keyword without impressions has no Quality Score that day.
export async function fetchKeywordQualityDaily(customer: Customer, label: string, start: string, end: string): Promise<KeywordQualityRow[]> {
  const rows = await queryWithRetry(() => customer.query(`
    SELECT segments.date, campaign.id, ad_group.id, ad_group_criterion.criterion_id,
      metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value,
      metrics.historical_quality_score, metrics.historical_search_predicted_ctr,
      metrics.historical_creative_quality_score, metrics.historical_landing_page_quality_score
    FROM keyword_view
    WHERE segments.date BETWEEN '${start}' AND '${end}' AND metrics.impressions > 0
  `), `${label} keyword quality ${start}..${end}`);
  return rows.map((row: any) => ({
    fact_date: String(row.segments.date),
    campaign_id: String(row.campaign.id),
    ad_group_id: String(row.ad_group.id),
    criterion_id: String(row.ad_group_criterion.criterion_id),
    impressions: num(row.metrics.impressions),
    clicks: num(row.metrics.clicks),
    cost: micros(row.metrics.cost_micros),
    conversions: num(row.metrics.conversions),
    conversions_value: num(row.metrics.conversions_value),
    quality_score: score(row.metrics.historical_quality_score),
    expected_ctr: bucket(row.metrics.historical_search_predicted_ctr),
    ad_relevance: bucket(row.metrics.historical_creative_quality_score),
    landing_page: bucket(row.metrics.historical_landing_page_quality_score),
  }));
}

export interface KeywordDimRow {
  ad_group_id: string;
  criterion_id: string;
  campaign_id: string;
  ad_group_name: string;
  keyword_text: string;
  match_type: string | null;
  status: string | null;
  quality_score: number | null;
  expected_ctr: number | null;
  ad_relevance: number | null;
  landing_page: number | null;
}

// Every positive keyword, removed ones included, so history rows keep their text.
export async function fetchKeywordDim(customer: Customer, label: string): Promise<KeywordDimRow[]> {
  const rows = await queryWithRetry(() => customer.query(`
    SELECT campaign.id, ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.quality_info.quality_score,
      ad_group_criterion.quality_info.search_predicted_ctr, ad_group_criterion.quality_info.creative_quality_score,
      ad_group_criterion.quality_info.post_click_quality_score
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = FALSE
  `), `${label} keyword dim`);
  return rows.map((row: any) => {
    const c = row.ad_group_criterion;
    return {
      ad_group_id: String(row.ad_group.id),
      criterion_id: String(c.criterion_id),
      campaign_id: String(row.campaign.id),
      ad_group_name: String(row.ad_group.name || ''),
      keyword_text: String(c.keyword?.text || ''),
      match_type: enums.KeywordMatchType[Number(c.keyword?.match_type)] as string ?? null,
      status: enums.AdGroupCriterionStatus[Number(c.status)] as string ?? null,
      quality_score: score(c.quality_info?.quality_score),
      expected_ctr: bucket(c.quality_info?.search_predicted_ctr),
      ad_relevance: bucket(c.quality_info?.creative_quality_score),
      landing_page: bucket(c.quality_info?.post_click_quality_score),
    };
  });
}
