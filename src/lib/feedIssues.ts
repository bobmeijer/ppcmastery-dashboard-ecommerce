// Client copy per Merchant / Google Ads issue code (first written for the
// feed-audit fixture). Codes without an entry fall back to Google's own text.
export interface IssueText { description: string; action: string }

export const FEED_ISSUE_TEXT: Record<string, IssueText> = {
  attribute_pending_review: { description: 'Attribute under review', action: 'No action: Google is still reviewing the attribute.' },
  attribute_violated_discovery_ads_policy: { description: 'Demand Gen ads policy', action: 'Only relevant for Demand Gen. Change the text if you want to advertise there.' },
  image_link_pending_crawl: { description: 'Image waiting for crawl', action: 'Usually no action: Google will fetch the image soon. If this stays, check the image_link.' },
  image_too_small_for_high_resolution: { description: 'Image too small', action: 'Use an image of at least 500 x 500 pixels; Google will enforce this.' },
  invalid_enum_value: { description: 'Invalid availability value', action: 'Use only in_stock, out_of_stock, preorder or backorder for availability in the feed.' },
  item_missing_required_attribute: { description: 'Required attribute missing', action: 'Fill in the missing required field (such as price) in the feed.' },
  landing_page_error: { description: 'Product page unreachable', action: 'Check that the URL works on desktop and mobile and is not blocked for Google (404, redirect, robots).' },
  low_image_quality: { description: 'Low image quality', action: 'Replace the image: no text or watermark, product large in frame, at least 800 x 800 pixels.' },
  missing_potentially_required_attribute: { description: 'Recommended attribute missing', action: 'Add the recommended attribute (for example unit pricing or GTIN); the product keeps showing.' },
  missing_related_attribute: { description: 'Related attribute missing', action: 'Add the matching attribute, for example unit_pricing_base_measure alongside unit_pricing_measure.' },
  missing_shipping: { description: 'Shipping costs missing', action: 'Add shipping costs in Merchant Center (shipping service) or per product with the shipping attribute.' },
  not_eligible_in_any_campaign: { description: 'Not included in a campaign', action: 'Not a feed error: no campaign advertises this product. Check the product groups or leave it this way on purpose.' },
  not_eligible_out_of_stock: { description: 'Out of stock', action: 'Not a feed error. Set the product to in_stock once it is available; until then Google does not show it.' },
  personal_hardships_policy_violation: { description: 'Personalised ads policy', action: 'Change the title or description (no reference to personal hardship); mainly affects Display and Demand Gen.' },
  price_out_of_range: { description: 'Price outside expected range', action: 'Check the currency and decimals of the feed price and whether it matches the product page.' },
  price_updated: { description: 'Price updated automatically', action: 'No action needed. Keep the feed price in line with the product page and the notice goes away.' },
  violated_discovery_ads_policy_experiment2: { description: 'Demand Gen ads policy (experiment)', action: 'Only relevant for Demand Gen. Change the text if you want to advertise there.' },
};

export const FEED_ISSUE_FALLBACK_ACTION = 'See the notice on the product in Merchant Center.';
