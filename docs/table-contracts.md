# Table contracts

What every fact table holds, so you can load data through another route. Everything here comes from `supabase/migrations/20260101000000_schema.sql`. If you change the schema, change this file.

`docs/recipes/add-another-data-route.md` shows how to use it.

## Rules for every table

- Every table has row level security on and no policies. Write with the service role key, from a server. Use the publish functions below, not plain inserts, because they replace a range in one transaction.
- `account_id` must exist in `accounts.id`. Create the account first.
- `platform` is `google` or `microsoft`. The publish functions set it from their `p_platform` argument, so leave it out of the row.
- `sync_run_id` is optional and is set from `p_sync_run_id`. It links a row to `sync_runs`.
- Dates are `YYYY-MM-DD` in the account's reporting time zone.
- `cost`, `conversions_value` and every other money field are in currency units, not micros. Google Ads returns micros, so divide `cost_micros` by 1,000,000.
- Shares and rates are fractions from 0 to 1, or null when they do not apply.
- `conversions` and `conversions_value` are the account's primary conversions. `all_conversions` and `all_conversions_value` include the rest. Revenue, ROAS and CPA use the primary ones.

## The daily fact tables

`ads_campaign_daily`, `ads_conversions_daily`, `ads_geo_daily`, `ads_device_daily` and `ads_product_daily` are all written by one function:

```sql
publish_daily_facts(
  p_table text, p_account_id text, p_start_date date, p_end_date date,
  p_sync_run_id uuid, p_rows jsonb, p_complete_run boolean default true, p_platform text default 'google'
) returns integer
```

It deletes every row for that account and platform between the two dates, inserts `p_rows`, and returns the inserted count. In the app, `publishFacts` in `src/lib/sync/googleAdsSync.ts` calls it.

What this means for a loader:

- Send the complete range. A day that is missing from `p_rows` ends up empty.
- Send one row per primary key. A duplicate fails the whole call.
- Keep every row inside the range. A row outside it may collide with one already stored.
- With `p_complete_run` true and a `p_sync_run_id`, the function marks that run complete.
- For very large ranges the app sends the first 20,000 rows through this function and inserts the rest directly. That rest must then carry `account_id`, `platform` and `sync_run_id` itself.

In the column tables, "Row field" means you send it in `p_rows`. "Set for you" means the function fills it.

### ads_campaign_daily

- **Grain:** one row per account, platform, day and campaign.
- **Primary key:** `account_id, platform, fact_date, campaign_id`
- **Written by:** `publish_daily_facts` from `syncDataset` (dataset `campaign`) and `syncMsDataset`. The Google query keeps rows with impressions above 0.
- **Read by:** `read_campaign_facts_json`, `read_data_coverage_json`, `read_auction_insights_json`, `read_auction_categories_json`, and `readFreshness`.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `account_id` | text | yes | | Set for you |
| `platform` | text | yes | `google` | Set for you |
| `fact_date` | date | yes | | Row field |
| `campaign_id` | text | yes | | Row field. Should exist in `campaign_dim`, or the name falls back to the ID and the category to `Other` |
| `impressions` | double precision | yes | 0 | Row field |
| `clicks` | double precision | yes | 0 | Row field |
| `cost` | double precision | yes | 0 | Row field |
| `conversions` | double precision | yes | 0 | Row field |
| `conversions_value` | double precision | yes | 0 | Row field |
| `all_conversions` | double precision | yes | 0 | Row field |
| `all_conversions_value` | double precision | yes | 0 | Row field |
| `search_impression_share` | double precision | no | | Row field. Rows without it are left out of impression share |
| `search_budget_lost_is` | double precision | no | | Row field |
| `search_rank_lost_is` | double precision | no | | Row field |
| `top_impression_pct` | double precision | no | | Row field |
| `abs_top_impression_pct` | double precision | no | | Row field |
| `sync_run_id` | uuid | no | | Set for you |

### ads_conversions_daily

- **Grain:** one row per account, platform, day, campaign and conversion action.
- **Primary key:** `account_id, platform, fact_date, campaign_id, conversion_action_id`
- **Written by:** `publish_daily_facts` from `syncDataset` (dataset `conversions`) and `syncMsDataset`. The Google query keeps rows with all conversions above 0.
- **Read by:** `read_conversion_roles_json`, `read_data_coverage_json`.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `account_id` | text | yes | | Set for you |
| `platform` | text | yes | `google` | Set for you |
| `fact_date` | date | yes | | Row field |
| `campaign_id` | text | yes | | Row field |
| `conversion_action_id` | text | yes | | Row field. The ID alone, not the resource name |
| `conversion_action_name` | text | yes | empty | Row field |
| `conversions` | double precision | yes | 0 | Row field |
| `conversions_value` | double precision | yes | 0 | Row field |
| `all_conversions` | double precision | yes | 0 | Row field |
| `all_conversions_value` | double precision | yes | 0 | Row field |
| `sync_run_id` | uuid | no | | Set for you |

### ads_geo_daily

- **Grain:** one row per account, platform, day, campaign and country.
- **Primary key:** `account_id, platform, fact_date, campaign_id, country_criterion_id`
- **Written by:** `publish_daily_facts` from `syncDataset` (dataset `geo`) and `syncMsDataset`. The Google query uses location of presence.
- **Read by:** `read_geo_facts_json`, `read_data_coverage_json`.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `account_id` | text | yes | | Set for you |
| `platform` | text | yes | `google` | Set for you |
| `fact_date` | date | yes | | Row field |
| `campaign_id` | text | yes | | Row field |
| `country_criterion_id` | text | yes | | Row field. Part of the key, so unique per country |
| `country_code` | text | yes | `Other` | Row field. Two-letter code. The app's `countryCode` knows 8 countries |
| `impressions` | double precision | yes | 0 | Row field |
| `clicks` | double precision | yes | 0 | Row field |
| `cost` | double precision | yes | 0 | Row field |
| `conversions` | double precision | yes | 0 | Row field |
| `conversions_value` | double precision | yes | 0 | Row field |
| `sync_run_id` | uuid | no | | Set for you |

### ads_device_daily

- **Grain:** one row per account, platform, day, campaign and device.
- **Primary key:** `account_id, platform, fact_date, campaign_id, device`
- **Written by:** `publish_daily_facts` from `syncDataset` (dataset `device`) and `syncMsDataset`.
- **Read by:** `read_device_facts_json`, `read_data_coverage_json`.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `account_id` | text | yes | | Set for you |
| `platform` | text | yes | `google` | Set for you |
| `fact_date` | date | yes | | Row field |
| `campaign_id` | text | yes | | Row field |
| `device` | text | yes | | Row field. `MOBILE`, `DESKTOP`, `TABLET`, `OTHER` or `CONNECTED_TV` |
| `impressions` | double precision | yes | 0 | Row field |
| `clicks` | double precision | yes | 0 | Row field |
| `cost` | double precision | yes | 0 | Row field |
| `conversions` | double precision | yes | 0 | Row field |
| `conversions_value` | double precision | yes | 0 | Row field |
| `sync_run_id` | uuid | no | | Set for you |

### ads_product_daily

- **Grain:** one row per account, platform, day, campaign, product and country.
- **Primary key:** `account_id, platform, fact_date, campaign_id, product_item_id, country_code`
- **Written by:** `publish_daily_facts` from `syncDataset` (dataset `product`) and `syncMsDataset`. Rows with the same key but changed attributes are merged first by `mergeProducts`. After each run, `pruneProductDaily` deletes rows before `PRODUCT_DAILY_FLOOR` once the monthly table covers them.
- **Read by:** `read_product_facts_json`, `read_product_daily_json`, `read_product_label_days_json`, `read_data_coverage_json`.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `account_id` | text | yes | | Set for you |
| `platform` | text | yes | `google` | Set for you |
| `fact_date` | date | yes | | Row field |
| `campaign_id` | text | yes | | Row field |
| `product_item_id` | text | yes | | Row field |
| `product_title` | text | yes | empty | Row field |
| `product_type` | text | yes | empty | Row field. Levels joined with ` > ` |
| `brand` | text | yes | empty | Row field |
| `custom_label_0` | text | yes | empty | Row field |
| `custom_label_1` | text | yes | empty | Row field |
| `custom_label_2` | text | yes | empty | Row field. The Buckets page reads `H`, `S`, `V` or `Z` here |
| `custom_label_3` | text | yes | empty | Row field |
| `custom_label_4` | text | yes | empty | Row field |
| `country_code` | text | yes | empty | Row field. Part of the key |
| `impressions` | double precision | yes | 0 | Row field |
| `clicks` | double precision | yes | 0 | Row field |
| `cost` | double precision | yes | 0 | Row field |
| `conversions` | double precision | yes | 0 | Row field |
| `conversions_value` | double precision | yes | 0 | Row field |
| `sync_run_id` | uuid | no | | Set for you |

## Other fact tables

### ads_product_monthly

- **Grain:** one row per account, platform, month, campaign, product and country.
- **Primary key:** `account_id, platform, fact_month, campaign_id, product_item_id, country_code`
- **Written by:** `publish_product_monthly(p_account_id, p_start_month, p_end_month, p_sync_run_id, p_rows, p_complete_run default true, p_platform default 'google')`, called from `syncDataset` with grain `month`. It replaces every month in the range.
- **Read by:** `read_product_facts_json`, when the period starts before the oldest daily product row. Also `read_data_coverage_json` and `pruneProductDaily`.

Same columns as `ads_product_daily`, with `fact_month` in place of `fact_date`. `fact_month` must be the first day of a month, and a check constraint enforces it. Send it as a row field.

### ads_keyword_quality_daily

- **Grain:** one row per account, platform, day, ad group and keyword.
- **Primary key:** `account_id, platform, fact_date, ad_group_id, criterion_id`
- **Written by:** `publish_keyword_quality(p_account_id, p_start_date, p_end_date, p_sync_run_id, p_rows, p_platform default 'google')`, called from `syncDataset` (dataset `quality`) and `syncMsDataset`. It replaces the range. A second row with the same key is dropped. It does not close the sync run.
- **Read by:** `read_keyword_quality_json`, `read_data_coverage_json`.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `account_id` | text | yes | | Set for you |
| `platform` | text | yes | `google` | Set for you |
| `fact_date` | date | yes | | Row field. Rows outside the range are ignored |
| `campaign_id` | text | yes | | Row field |
| `ad_group_id` | text | yes | | Row field |
| `criterion_id` | text | yes | | Row field. Join to `keyword_dim` for the text |
| `impressions` | double precision | yes | 0 | Row field |
| `clicks` | double precision | yes | 0 | Row field |
| `cost` | double precision | yes | 0 | Row field |
| `conversions` | double precision | yes | 0 | Row field |
| `conversions_value` | double precision | yes | 0 | Row field |
| `quality_score` | smallint | no | | Row field. 1 to 10 |
| `expected_ctr` | smallint | no | | Row field. 2 below average, 3 average, 4 above average |
| `ad_relevance` | smallint | no | | Row field. Same scale |
| `landing_page` | smallint | no | | Row field. Same scale |
| `sync_run_id` | uuid | no | | Set for you |

### ads_change_events

- **Grain:** one row per account, changed resource and moment.
- **Primary key:** `account_id, resource_name, change_time`
- **Written by:** `publish_change_events(p_account_id, p_rows)`, called from `syncDataset` (dataset `changes`). It upserts and never deletes, so history accumulates beyond the 30 days Google keeps.
- **Read by:** `read_change_events_json`, `read_data_coverage_json`.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `account_id` | text | yes | | Set for you |
| `change_time` | timestamptz | yes | | Row field |
| `resource_name` | text | yes | | Row field |
| `resource_type` | text | yes | empty | Row field |
| `operation` | text | yes | empty | Row field |
| `campaign_id` | text | no | | Row field |
| `campaign_name` | text | no | | Row field |
| `changed_fields` | text[] | yes | empty | Row field |
| `summary` | text | yes | empty | Row field |
| `user_email` | text | yes | empty | Row field |
| `client_type` | text | yes | empty | Row field |
| `sync_run_id` | uuid | no | | Row field here, not an argument |

### auction_insights_daily

- **Grain:** one row per account, network, day, campaign name and competitor.
- **Primary key:** `account_id, network, fact_date, campaign_name, competitor`
- **Written by:** `publish_auction_insights(p_account_id, p_network, p_rows, p_source default 'sheet', p_replace_from default null, p_replace_to default null)`, called from `publishAuctionReport` in `src/lib/sync/auctionSync.ts`. It upserts. With both replace dates it first deletes that range for the network. Rows must also include one for the competitor `You`, because every weighted figure is computed from it.
- **Read by:** `read_auction_insights_json`, `read_auction_categories_json`, `read_auction_coverage_json`, `read_data_coverage_json`.

The row fields in `p_rows` have different names from the columns:

| Column | Type | Required | Default | Row field or source |
|---|---|---|---|---|
| `account_id` | text | yes | | Set for you |
| `network` | text | yes | | `p_network`. `Search` or `Shopping` |
| `fact_date` | date | yes | | `date` |
| `campaign_name` | text | yes | | `campaign` |
| `competitor` | text | yes | | `competitor`. A domain, a store name, or `You` |
| `campaign_id` | text | no | | Looked up in `campaign_dim` by name |
| `category` | text | yes | `Other` | Looked up in `campaign_dim` by name |
| `impression_share` | double precision | no | | `impression_share`. Fraction. Use 0.10 when Google shows "< 10%" |
| `is_capped` | boolean | yes | false | `is_capped`. True when Google shows "< 10%" |
| `overlap_rate` | double precision | no | | `overlap_rate` |
| `position_above_rate` | double precision | no | | `position_above_rate` |
| `top_of_page_rate` | double precision | no | | `top_of_page_rate` |
| `abs_top_rate` | double precision | no | | `abs_top_rate` |
| `outranking_share` | double precision | no | | `outranking_share` |
| `source` | text | yes | `sheet` | `p_source` |
| `synced_at` | timestamptz | yes | now | Set for you |

### feed_products

- **Grain:** one row per account, feed label and item. It holds the latest state only.
- **Primary key:** `account_id, feed_label, item_id`
- **Written by:** `publish_feed_snapshot(p_account_id, p_snapshot_date, p_products, p_totals, p_by_destination)`, called from `syncFeed` in `src/lib/sync/feedSync.ts`. It deletes every row for the account and inserts `p_products`. A second row with the same key is dropped.
- **Read by:** `read_feed_products_json`.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `account_id` | text | yes | | Set for you |
| `feed_label` | text | yes | empty | Row field |
| `item_id` | text | yes | | Row field |
| `title` | text | yes | empty | Row field |
| `link` | text | no | | Row field |
| `image_link` | text | no | | Row field |
| `price` | numeric | no | | Row field |
| `currency` | text | no | | Row field |
| `availability` | text | no | | Row field |
| `brand` | text | no | | Row field |
| `product_type` | text | no | | Row field |
| `custom_label_0` | text | no | | Row field |
| `custom_label_1` | text | no | | Row field |
| `custom_label_2` | text | no | | Row field |
| `custom_label_3` | text | no | | Row field |
| `custom_label_4` | text | no | | Row field |
| `ads_status` | text | no | | Row field. `ELIGIBLE`, `ELIGIBLE_LIMITED` or `NOT_ELIGIBLE` |
| `merchant_status` | text | no | | Row field. `APPROVED`, `PENDING` or `DISAPPROVED` |
| `issues` | jsonb | yes | `[]` | Row field. List of `{ code, source, severity, description }`, with `source` being `ads` or `merchant` |
| `synced_at` | timestamptz | yes | now | Set for you |

### feed_daily

- **Grain:** one row per account and snapshot day.
- **Primary key:** `account_id, snapshot_date`
- **Written by:** `publish_feed_snapshot`, in the same transaction as `feed_products`. It upserts the day.
- **Read by:** `read_feed_daily_json`.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `account_id` | text | yes | | Set for you |
| `snapshot_date` | date | yes | | `p_snapshot_date` |
| `totals` | jsonb | yes | | `p_totals`. See below |
| `by_destination` | jsonb | yes | `[]` | `p_by_destination`. List of `{ destination, label, active, pending, disapproved }` |
| `synced_at` | timestamptz | yes | now | Set for you |

`totals` has these numeric keys, built by `feedTotals` in `src/lib/feedBuild.ts`: `itemsInFeed`, `eligible`, `blocked`, `pending`, `merchantProducts`, `merchantApproved`, `merchantDisapproved`, `merchantPending`.

## Tables the facts depend on

### accounts

Written by `npm run accounts:add`. One row per ad account.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | text | yes | | Primary key. Customer ID without dashes |
| `label` | text | yes | | Unique. Must match `dashboard.config.ts` |
| `display_name` | text | yes | | |
| `login_customer_id` | text | yes | | Manager account, or the account itself |
| `merchant_id` | text | no | | Feed status |
| `currency` | text | yes | `EUR` | |
| `lag_days` | integer | yes | 7 | |
| `enabled` | boolean | yes | true | Disabled accounts are not synced or shown |
| `created_at` | timestamptz | yes | now | |
| `msads_account_id` | text | no | | Microsoft Ads |
| `msads_customer_id` | text | no | | Microsoft Ads |

### campaign_dim

- **Grain:** one row per account, platform and campaign, with the current state only.
- **Primary key:** `account_id, platform, campaign_id`
- **Written by:** `upsert_campaign_dim(p_account_id, p_rows, p_platform default 'google')`, from `syncCampaignDim` and `syncMsCampaignDim`. A row in `campaign_overrides` wins for network, category and bucket.

Category and network are read through this table, so one campaign sync reclassifies all history.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `account_id` | text | yes | | Set for you |
| `platform` | text | yes | `google` | Set for you |
| `campaign_id` | text | yes | | Row field |
| `campaign_name` | text | yes | | Row field |
| `channel_type` | text | yes | empty | Row field. For example `SEARCH` or `PERFORMANCE_MAX` |
| `status` | text | yes | empty | Row field. `ENABLED`, `PAUSED` or `REMOVED` |
| `bidding_strategy_type` | text | yes | empty | Row field |
| `target_roas` | double precision | no | | Row field |
| `target_cpa` | double precision | no | | Row field |
| `budget_amount` | double precision | no | | Row field |
| `network` | text | yes | `Other` | Row field. `Search`, `Shopping`, `PMax`, `Display`, `Demand Gen`, `Video` or `Other` |
| `category` | text | yes | `Other` | Row field. `Brand` has a special meaning in the filters |
| `bucket` | text | yes | empty | Row field |
| `parsed` | boolean | yes | false | Row field. False lists the campaign as unrecognised on the Status page |
| `overridden` | boolean | yes | false | Set for you |
| `updated_at` | timestamptz | yes | now | Set for you |

### keyword_dim

- **Grain:** one row per account, platform, ad group and keyword, with the current state only.
- **Primary key:** `account_id, platform, ad_group_id, criterion_id`
- **Written by:** `publish_keyword_dim(p_account_id, p_rows, p_platform default 'google')`. It replaces every row for the account and platform.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `account_id` | text | yes | | Set for you |
| `platform` | text | yes | `google` | Set for you |
| `ad_group_id` | text | yes | | Row field |
| `criterion_id` | text | yes | | Row field |
| `campaign_id` | text | yes | | Row field |
| `ad_group_name` | text | yes | empty | Row field |
| `keyword_text` | text | yes | empty | Row field |
| `match_type` | text | no | | Row field |
| `status` | text | no | | Row field |
| `quality_score` | smallint | no | | Row field |
| `expected_ctr` | smallint | no | | Row field |
| `ad_relevance` | smallint | no | | Row field |
| `landing_page` | smallint | no | | Row field |
| `synced_at` | timestamptz | yes | now | Set for you |

### sync_runs

The Status page shows the latest run per source, dataset and account. A loader should write here so its runs are visible.

`source` is limited by a check constraint to `google_ads`, `microsoft_ads`, `merchant`, `sheets` and `meetings`. A new source name needs a migration that changes the constraint. `status` is `running`, `complete`, `failed` or `skipped`. `src/lib/sync/runs.ts` has the bookkeeping.

The other columns are `id`, `dataset`, `account_id`, `start_date`, `end_date`, `row_count`, `duration_ms`, `error_message`, `metadata`, `started_at` and `completed_at`.
