-- PPC dashboard schema: tables, publish functions and read functions.
-- Service-role only: row level security is on for every table and there are no policies.
-- This file holds no account data. Accounts, targets and conversion roles are set up per install.

create extension if not exists pgcrypto;

SET check_function_bodies = false;

CREATE FUNCTION public.add_ai_spend(p_month text, p_usd numeric) RETURNS numeric
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into public.ai_spend (month, usd, updated_at) values (p_month, greatest(p_usd, 0), now())
  on conflict (month) do update set usd = public.ai_spend.usd + greatest(excluded.usd, 0), updated_at = now()
  returning usd;
$$;

CREATE FUNCTION public.bump_session_version(p_user_id uuid) RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.users set session_version = session_version + 1 where id = p_user_id returning session_version;
$$;

CREATE FUNCTION public.campaign_label(p_platform text, p_name text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case when p_platform = 'microsoft' then p_name || ' (Microsoft)' else p_name end;
$$;

CREATE FUNCTION public.publish_auction_insights(p_account_id text, p_network text, p_rows jsonb, p_source text DEFAULT 'sheet'::text, p_replace_from date DEFAULT NULL::date, p_replace_to date DEFAULT NULL::date) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  n integer := 0;
begin
  if p_replace_from is not null and p_replace_to is not null then
    delete from public.auction_insights_daily
    where account_id = p_account_id and network = p_network and fact_date between p_replace_from and p_replace_to;
  end if;

  insert into public.auction_insights_daily (
    account_id, network, fact_date, campaign_name, competitor, campaign_id, category,
    impression_share, is_capped, overlap_rate, position_above_rate, top_of_page_rate, abs_top_rate, outranking_share,
    source, synced_at
  )
  select p_account_id, p_network, r.date, r.campaign, r.competitor, d.campaign_id, coalesce(d.category, 'Other'),
    r.impression_share, coalesce(r.is_capped, false), r.overlap_rate, r.position_above_rate, r.top_of_page_rate, r.abs_top_rate, r.outranking_share,
    p_source, now()
  from jsonb_to_recordset(p_rows) as r(
    date date, campaign text, competitor text, impression_share double precision, is_capped boolean,
    overlap_rate double precision, position_above_rate double precision, top_of_page_rate double precision,
    abs_top_rate double precision, outranking_share double precision
  )
  left join lateral (
    select c.campaign_id, c.category from public.campaign_dim c
    where c.account_id = p_account_id and c.platform = 'google' and c.campaign_name = r.campaign
    order by (c.status = 'ENABLED') desc, c.updated_at desc limit 1
  ) d on true
  where r.date is not null and r.campaign is not null and r.competitor is not null
  on conflict (account_id, network, fact_date, campaign_name, competitor) do update set
    campaign_id = excluded.campaign_id, category = excluded.category,
    impression_share = excluded.impression_share, is_capped = excluded.is_capped, overlap_rate = excluded.overlap_rate,
    position_above_rate = excluded.position_above_rate, top_of_page_rate = excluded.top_of_page_rate,
    abs_top_rate = excluded.abs_top_rate, outranking_share = excluded.outranking_share,
    source = excluded.source, synced_at = excluded.synced_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

CREATE FUNCTION public.publish_change_events(p_account_id text, p_rows jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  n integer := 0;
begin
  insert into public.ads_change_events (account_id, change_time, resource_name, resource_type, operation,
    campaign_id, campaign_name, changed_fields, summary, user_email, client_type, sync_run_id)
  select p_account_id, r.change_time, r.resource_name, coalesce(r.resource_type, ''), coalesce(r.operation, ''),
    r.campaign_id, r.campaign_name, coalesce(r.changed_fields, '{}'::text[]), coalesce(r.summary, ''),
    coalesce(r.user_email, ''), coalesce(r.client_type, ''), r.sync_run_id
  from jsonb_to_recordset(p_rows) as r(change_time timestamptz, resource_name text, resource_type text, operation text,
    campaign_id text, campaign_name text, changed_fields text[], summary text, user_email text, client_type text,
    sync_run_id uuid)
  where r.change_time is not null and r.resource_name is not null
  on conflict (account_id, resource_name, change_time) do update set
    summary = excluded.summary, changed_fields = excluded.changed_fields, campaign_id = excluded.campaign_id,
    campaign_name = excluded.campaign_name, user_email = excluded.user_email, client_type = excluded.client_type,
    sync_run_id = excluded.sync_run_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

CREATE FUNCTION public.publish_communication(p_item jsonb, p_actions jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id text := p_item->>'id';
  v_date date := (p_item->>'date')::date;
  v_email boolean := p_item->>'kind' = 'email';
  n integer := 0;
begin
  if v_id is null or v_date is null or coalesce(p_item->>'kind', '') not in ('meeting', 'email') then
    raise exception 'Item needs id, kind and date';
  end if;

  insert into public.communications (id, kind, title, date, time, participants, summary_md, decisions, detail_md, message_count, labels, synced_at,
    hidden, hidden_at, hidden_by)
  values (v_id, p_item->>'kind', coalesce(p_item->>'title', ''), v_date, coalesce(p_item->>'time', ''),
    coalesce(array(select jsonb_array_elements_text(p_item->'participants')), '{}'),
    coalesce(p_item->>'summary_md', ''),
    coalesce(array(select jsonb_array_elements_text(p_item->'decisions')), '{}'),
    p_item->>'detail_md',
    coalesce((p_item->>'message_count')::integer, 1),
    coalesce(array(select jsonb_array_elements_text(p_item->'labels')), '{}'), now(),
    v_email, case when v_email then now() end, case when v_email then 'awaiting approval' end)
  on conflict (id) do update set
    kind = excluded.kind, title = excluded.title, date = excluded.date, time = excluded.time,
    participants = excluded.participants, summary_md = excluded.summary_md, decisions = excluded.decisions,
    detail_md = excluded.detail_md, message_count = excluded.message_count, labels = excluded.labels,
    synced_at = excluded.synced_at,
    hidden = public.communications.hidden or (excluded.kind = 'email' and (
      public.communications.title, public.communications.summary_md, public.communications.decisions, public.communications.detail_md)
      is distinct from (excluded.title, excluded.summary_md, excluded.decisions, excluded.detail_md)),
    hidden_at = case when not public.communications.hidden and excluded.kind = 'email' and (
      public.communications.title, public.communications.summary_md, public.communications.decisions, public.communications.detail_md)
      is distinct from (excluded.title, excluded.summary_md, excluded.decisions, excluded.detail_md)
      then now() else public.communications.hidden_at end,
    hidden_by = case when not public.communications.hidden and excluded.kind = 'email' and (
      public.communications.title, public.communications.summary_md, public.communications.decisions, public.communications.detail_md)
      is distinct from (excluded.title, excluded.summary_md, excluded.decisions, excluded.detail_md)
      then 'awaiting approval' else public.communications.hidden_by end;

  insert into public.actions (id, source_id, title, owner, due, label, created)
  select r.id, v_id, r.title, coalesce(r.owner, 'Admin'), r.due, r.label, v_date
  from jsonb_to_recordset(coalesce(p_actions, '[]'::jsonb)) as r(id text, title text, owner text, due date, label text)
  where r.id is not null and r.title is not null
  on conflict (id) do update set
    title = excluded.title, owner = excluded.owner, due = excluded.due, label = excluded.label
  where public.actions.source_id = v_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

CREATE FUNCTION public.publish_context_source(p_source jsonb, p_findings jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_key text := p_source->>'key';
  n integer := 0;
begin
  if v_key is null or coalesce(p_source->>'kind', '') not in ('audit', 'notes', 'memory') or (p_source->>'run_date') is null then
    raise exception 'Source needs key, kind and run_date';
  end if;
  delete from public.context_findings where source_key = v_key;
  insert into public.context_findings (id, source_key, kind, source, account_label, run_date, window_start, window_end, claim, evidence, severity, client_safe, synced_at)
  select v_key || '#' || r.ordinality, v_key, p_source->>'kind', coalesce(p_source->>'source', ''), nullif(p_source->>'account', ''),
    (p_source->>'run_date')::date, (r.f->>'window_start')::date, (r.f->>'window_end')::date,
    r.f->>'claim', coalesce(r.f->>'evidence', ''), coalesce(r.f->>'severity', 'medium'), coalesce((r.f->>'client_safe')::boolean, false), now()
  from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) with ordinality as r(f, ordinality)
  where coalesce(r.f->>'claim', '') <> '';
  get diagnostics n = row_count;
  return n;
end;
$$;

CREATE FUNCTION public.publish_daily_facts(p_table text, p_account_id text, p_start_date date, p_end_date date, p_sync_run_id uuid, p_rows jsonb, p_complete_run boolean DEFAULT true, p_platform text DEFAULT 'google'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  inserted_count integer := 0;
begin
  if p_table not in ('ads_campaign_daily', 'ads_conversions_daily', 'ads_geo_daily', 'ads_device_daily', 'ads_product_daily') then
    raise exception 'Unknown fact table %', p_table;
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'Invalid fact date range';
  end if;

  execute format('delete from public.%I where account_id = $1 and platform = $4 and fact_date between $2 and $3', p_table)
    using p_account_id, p_start_date, p_end_date, p_platform;

  if p_table = 'ads_campaign_daily' then
    insert into public.ads_campaign_daily (account_id, platform, fact_date, campaign_id, impressions, clicks, cost,
      conversions, conversions_value, all_conversions, all_conversions_value, search_impression_share,
      search_budget_lost_is, search_rank_lost_is, top_impression_pct, abs_top_impression_pct, sync_run_id)
    select p_account_id, p_platform, r.fact_date, r.campaign_id, coalesce(r.impressions, 0), coalesce(r.clicks, 0),
      coalesce(r.cost, 0), coalesce(r.conversions, 0), coalesce(r.conversions_value, 0),
      coalesce(r.all_conversions, 0), coalesce(r.all_conversions_value, 0), r.search_impression_share,
      r.search_budget_lost_is, r.search_rank_lost_is, r.top_impression_pct, r.abs_top_impression_pct, p_sync_run_id
    from jsonb_to_recordset(p_rows) as r(fact_date date, campaign_id text, impressions double precision,
      clicks double precision, cost double precision, conversions double precision, conversions_value double precision,
      all_conversions double precision, all_conversions_value double precision, search_impression_share double precision,
      search_budget_lost_is double precision, search_rank_lost_is double precision, top_impression_pct double precision,
      abs_top_impression_pct double precision);
  elsif p_table = 'ads_conversions_daily' then
    insert into public.ads_conversions_daily (account_id, platform, fact_date, campaign_id, conversion_action_id,
      conversion_action_name, conversions, conversions_value, all_conversions, all_conversions_value, sync_run_id)
    select p_account_id, p_platform, r.fact_date, r.campaign_id, r.conversion_action_id, coalesce(r.conversion_action_name, ''),
      coalesce(r.conversions, 0), coalesce(r.conversions_value, 0), coalesce(r.all_conversions, 0),
      coalesce(r.all_conversions_value, 0), p_sync_run_id
    from jsonb_to_recordset(p_rows) as r(fact_date date, campaign_id text, conversion_action_id text,
      conversion_action_name text, conversions double precision, conversions_value double precision,
      all_conversions double precision, all_conversions_value double precision);
  elsif p_table = 'ads_geo_daily' then
    insert into public.ads_geo_daily (account_id, platform, fact_date, campaign_id, country_criterion_id, country_code,
      impressions, clicks, cost, conversions, conversions_value, sync_run_id)
    select p_account_id, p_platform, r.fact_date, r.campaign_id, r.country_criterion_id, coalesce(r.country_code, 'Other'),
      coalesce(r.impressions, 0), coalesce(r.clicks, 0), coalesce(r.cost, 0), coalesce(r.conversions, 0),
      coalesce(r.conversions_value, 0), p_sync_run_id
    from jsonb_to_recordset(p_rows) as r(fact_date date, campaign_id text, country_criterion_id text, country_code text,
      impressions double precision, clicks double precision, cost double precision, conversions double precision,
      conversions_value double precision);
  elsif p_table = 'ads_device_daily' then
    insert into public.ads_device_daily (account_id, platform, fact_date, campaign_id, device, impressions, clicks, cost,
      conversions, conversions_value, sync_run_id)
    select p_account_id, p_platform, r.fact_date, r.campaign_id, r.device, coalesce(r.impressions, 0), coalesce(r.clicks, 0),
      coalesce(r.cost, 0), coalesce(r.conversions, 0), coalesce(r.conversions_value, 0), p_sync_run_id
    from jsonb_to_recordset(p_rows) as r(fact_date date, campaign_id text, device text, impressions double precision,
      clicks double precision, cost double precision, conversions double precision, conversions_value double precision);
  elsif p_table = 'ads_product_daily' then
    insert into public.ads_product_daily (account_id, platform, fact_date, campaign_id, product_item_id, product_title,
      product_type, brand, custom_label_0, custom_label_1, custom_label_2, custom_label_3, custom_label_4,
      country_code, impressions, clicks, cost, conversions, conversions_value, sync_run_id)
    select p_account_id, p_platform, r.fact_date, r.campaign_id, r.product_item_id, coalesce(r.product_title, ''),
      coalesce(r.product_type, ''), coalesce(r.brand, ''), coalesce(r.custom_label_0, ''), coalesce(r.custom_label_1, ''),
      coalesce(r.custom_label_2, ''), coalesce(r.custom_label_3, ''), coalesce(r.custom_label_4, ''),
      coalesce(r.country_code, ''), coalesce(r.impressions, 0), coalesce(r.clicks, 0), coalesce(r.cost, 0),
      coalesce(r.conversions, 0), coalesce(r.conversions_value, 0), p_sync_run_id
    from jsonb_to_recordset(p_rows) as r(fact_date date, campaign_id text, product_item_id text, product_title text,
      product_type text, brand text, custom_label_0 text, custom_label_1 text, custom_label_2 text, custom_label_3 text,
      custom_label_4 text, country_code text, impressions double precision, clicks double precision, cost double precision,
      conversions double precision, conversions_value double precision);
  end if;

  get diagnostics inserted_count = row_count;

  if p_complete_run and p_sync_run_id is not null then
    update public.sync_runs set status = 'complete', row_count = inserted_count, completed_at = now()
    where id = p_sync_run_id;
  end if;
  return inserted_count;
end;
$_$;

CREATE FUNCTION public.publish_feed_snapshot(p_account_id text, p_snapshot_date date, p_products jsonb, p_totals jsonb, p_by_destination jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  n integer := 0;
begin
  delete from public.feed_products where account_id = p_account_id;
  insert into public.feed_products (
    account_id, feed_label, item_id, title, link, image_link, price, currency, availability, brand, product_type,
    custom_label_0, custom_label_1, custom_label_2, custom_label_3, custom_label_4,
    ads_status, merchant_status, issues, synced_at)
  select p_account_id, coalesce(r.feed_label, ''), r.item_id, coalesce(r.title, ''), r.link, r.image_link, r.price, r.currency,
    r.availability, r.brand, r.product_type, r.custom_label_0, r.custom_label_1, r.custom_label_2, r.custom_label_3, r.custom_label_4,
    r.ads_status, r.merchant_status, coalesce(r.issues, '[]'::jsonb), now()
  from jsonb_to_recordset(p_products) as r(
    feed_label text, item_id text, title text, link text, image_link text, price numeric, currency text, availability text,
    brand text, product_type text, custom_label_0 text, custom_label_1 text, custom_label_2 text, custom_label_3 text,
    custom_label_4 text, ads_status text, merchant_status text, issues jsonb)
  where r.item_id is not null
  on conflict (account_id, feed_label, item_id) do nothing;
  get diagnostics n = row_count;

  insert into public.feed_daily (account_id, snapshot_date, totals, by_destination, synced_at)
  values (p_account_id, p_snapshot_date, p_totals, coalesce(p_by_destination, '[]'::jsonb), now())
  on conflict (account_id, snapshot_date) do update set
    totals = excluded.totals, by_destination = excluded.by_destination, synced_at = excluded.synced_at;
  return n;
end;
$$;

CREATE FUNCTION public.publish_keyword_dim(p_account_id text, p_rows jsonb, p_platform text DEFAULT 'google'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  n integer := 0;
begin
  delete from public.keyword_dim where account_id = p_account_id and platform = p_platform;
  insert into public.keyword_dim (account_id, platform, ad_group_id, criterion_id, campaign_id, ad_group_name, keyword_text, match_type, status,
    quality_score, expected_ctr, ad_relevance, landing_page, synced_at)
  select p_account_id, p_platform, r.ad_group_id, r.criterion_id, r.campaign_id, coalesce(r.ad_group_name, ''), coalesce(r.keyword_text, ''), r.match_type,
    r.status, r.quality_score, r.expected_ctr, r.ad_relevance, r.landing_page, now()
  from jsonb_to_recordset(p_rows) as r(ad_group_id text, criterion_id text, campaign_id text, ad_group_name text, keyword_text text,
    match_type text, status text, quality_score smallint, expected_ctr smallint, ad_relevance smallint, landing_page smallint)
  where r.ad_group_id is not null and r.criterion_id is not null
  on conflict (account_id, platform, ad_group_id, criterion_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

CREATE FUNCTION public.publish_keyword_quality(p_account_id text, p_start_date date, p_end_date date, p_sync_run_id uuid, p_rows jsonb, p_platform text DEFAULT 'google'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  n integer := 0;
begin
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'Invalid fact date range';
  end if;
  delete from public.ads_keyword_quality_daily
  where account_id = p_account_id and platform = p_platform and fact_date between p_start_date and p_end_date;
  insert into public.ads_keyword_quality_daily (account_id, platform, fact_date, campaign_id, ad_group_id, criterion_id, impressions, clicks, cost,
    conversions, conversions_value, quality_score, expected_ctr, ad_relevance, landing_page, sync_run_id)
  select p_account_id, p_platform, r.fact_date, r.campaign_id, r.ad_group_id, r.criterion_id, coalesce(r.impressions, 0), coalesce(r.clicks, 0),
    coalesce(r.cost, 0), coalesce(r.conversions, 0), coalesce(r.conversions_value, 0), r.quality_score, r.expected_ctr, r.ad_relevance,
    r.landing_page, p_sync_run_id
  from jsonb_to_recordset(p_rows) as r(fact_date date, campaign_id text, ad_group_id text, criterion_id text, impressions double precision,
    clicks double precision, cost double precision, conversions double precision, conversions_value double precision,
    quality_score smallint, expected_ctr smallint, ad_relevance smallint, landing_page smallint)
  where r.fact_date between p_start_date and p_end_date
  on conflict (account_id, platform, fact_date, ad_group_id, criterion_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

CREATE FUNCTION public.publish_product_monthly(p_account_id text, p_start_month date, p_end_month date, p_sync_run_id uuid, p_rows jsonb, p_complete_run boolean DEFAULT true, p_platform text DEFAULT 'google'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  inserted_count integer := 0;
begin
  delete from public.ads_product_monthly
   where account_id = p_account_id and platform = p_platform
     and fact_month between date_trunc('month', p_start_month)::date and date_trunc('month', p_end_month)::date;

  insert into public.ads_product_monthly (account_id, platform, fact_month, campaign_id, product_item_id, product_title,
    product_type, brand, custom_label_0, custom_label_1, custom_label_2, custom_label_3, custom_label_4,
    country_code, impressions, clicks, cost, conversions, conversions_value, sync_run_id)
  select p_account_id, p_platform, r.fact_month, r.campaign_id, r.product_item_id, coalesce(r.product_title, ''),
    coalesce(r.product_type, ''), coalesce(r.brand, ''), coalesce(r.custom_label_0, ''), coalesce(r.custom_label_1, ''),
    coalesce(r.custom_label_2, ''), coalesce(r.custom_label_3, ''), coalesce(r.custom_label_4, ''),
    coalesce(r.country_code, ''), coalesce(r.impressions, 0), coalesce(r.clicks, 0), coalesce(r.cost, 0),
    coalesce(r.conversions, 0), coalesce(r.conversions_value, 0), p_sync_run_id
  from jsonb_to_recordset(p_rows) as r(fact_month date, campaign_id text, product_item_id text, product_title text,
    product_type text, brand text, custom_label_0 text, custom_label_1 text, custom_label_2 text, custom_label_3 text,
    custom_label_4 text, country_code text, impressions double precision, clicks double precision, cost double precision,
    conversions double precision, conversions_value double precision);

  get diagnostics inserted_count = row_count;
  if p_complete_run and p_sync_run_id is not null then
    update public.sync_runs set status = 'complete', row_count = inserted_count, completed_at = now()
    where id = p_sync_run_id;
  end if;
  return inserted_count;
end;
$$;

CREATE FUNCTION public.read_auction_categories_json(p_account_ids text[], p_start_date date, p_end_date date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object('network', network, 'category', category, 'eligible', eligible) order by network, eligible desc nulls last, category), '[]'::jsonb)
  from (
    select a.network, a.category, sum(case when a.impression_share > 0 then coalesce(f.impressions, 0) / a.impression_share else 0 end) as eligible
    from public.auction_insights_daily a
    left join public.ads_campaign_daily f on f.account_id = a.account_id and f.platform = 'google'
      and f.campaign_id = a.campaign_id and f.fact_date = a.fact_date
    where a.account_id = any(p_account_ids) and a.fact_date between p_start_date and p_end_date and a.competitor = 'You'
    group by a.network, a.category
  ) s;
$$;

CREATE FUNCTION public.read_auction_coverage_json(p_account_ids text[]) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'network', network, 'first_date', first_date, 'last_date', last_date
  ) order by network), '[]'::jsonb)
  from (
    select net.network, min(cov.first_date) as first_date, max(cov.last_date) as last_date
    from unnest(p_account_ids) acc(id)
    cross join (values ('Search'), ('Shopping')) net(network)
    cross join lateral (
      select min(a.fact_date) as first_date, max(a.fact_date) as last_date
      from public.auction_insights_daily a
      where a.account_id = acc.id and a.network = net.network
    ) cov
    where cov.first_date is not null
    group by net.network
  ) s;
$$;

CREATE FUNCTION public.read_auction_insights_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text DEFAULT 'week'::text, p_network text DEFAULT NULL::text, p_category text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    AS $$
  with base as (
    select a.*,
      case p_grain when 'day' then a.fact_date
                   when 'month' then date_trunc('month', a.fact_date)::date
                   when 'all' then p_start_date
                   else date_trunc('week', a.fact_date)::date end as period
    from public.auction_insights_daily a
    where a.account_id = any(p_account_ids) and a.fact_date between p_start_date and p_end_date
      and (p_network is null or a.network = p_network) and (p_category is null or a.category = p_category)
  ),
  own as (
    select b.account_id, b.network, b.fact_date, b.campaign_name, b.impression_share as own_is, coalesce(f.impressions, 0) as own_impr
    from base b
    left join public.ads_campaign_daily f on f.account_id = b.account_id and f.platform = 'google'
      and f.campaign_id = b.campaign_id and f.fact_date = b.fact_date
    where b.competitor = 'You'
  ),
  weighted as (
    select b.period, b.network, b.category, b.competitor, b.is_capped,
      b.impression_share, b.overlap_rate, b.position_above_rate, b.top_of_page_rate, b.abs_top_rate, b.outranking_share,
      o.own_impr,
      case when o.own_is > 0 then o.own_impr / o.own_is else 0 end as eligible
    from base b
    join own o on o.account_id = b.account_id and o.network = b.network and o.fact_date = b.fact_date and o.campaign_name = b.campaign_name
  ),
  agg as (
    select period, network, category, competitor,
      sum(impression_share * eligible) filter (where impression_share is not null) / nullif(sum(eligible) filter (where impression_share is not null), 0) as impression_share,
      sum(eligible) filter (where is_capped) / nullif(sum(eligible) filter (where impression_share is not null), 0) as capped_weight,
      sum(overlap_rate * own_impr) filter (where overlap_rate is not null) / nullif(sum(own_impr) filter (where overlap_rate is not null), 0) as overlap_rate,
      sum(position_above_rate * own_impr * overlap_rate) filter (where position_above_rate is not null and overlap_rate is not null)
        / nullif(sum(own_impr * overlap_rate) filter (where position_above_rate is not null and overlap_rate is not null), 0) as position_above_rate,
      sum(top_of_page_rate * impression_share * eligible) filter (where top_of_page_rate is not null and impression_share is not null)
        / nullif(sum(impression_share * eligible) filter (where top_of_page_rate is not null and impression_share is not null), 0) as top_of_page_rate,
      sum(abs_top_rate * impression_share * eligible) filter (where abs_top_rate is not null and impression_share is not null)
        / nullif(sum(impression_share * eligible) filter (where abs_top_rate is not null and impression_share is not null), 0) as abs_top_rate,
      sum(outranking_share * eligible) filter (where outranking_share is not null) / nullif(sum(eligible) filter (where outranking_share is not null), 0) as outranking_share,
      sum(eligible) as eligible,
      count(*) as campaign_days
    from weighted
    group by period, network, category, competitor
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'period', period, 'network', network, 'category', category, 'competitor', competitor,
    'impression_share', impression_share, 'is_capped', coalesce(capped_weight, 0) > 0.5,
    'overlap_rate', overlap_rate, 'position_above_rate', position_above_rate,
    'top_of_page_rate', top_of_page_rate, 'abs_top_rate', abs_top_rate, 'outranking_share', outranking_share,
    'eligible', eligible, 'campaign_days', campaign_days
  ) order by period, network, category, competitor), '[]'::jsonb)
  from agg;
$$;

CREATE FUNCTION public.read_campaign_facts_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text DEFAULT 'day'::text, p_platforms text[] DEFAULT NULL::text[]) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    AS $$
  with g as (
    select f.account_id, f.platform,
      case when p_grain = 'month' then date_trunc('month', f.fact_date)::date
           when p_grain = 'week' then date_trunc('week', f.fact_date)::date
           else f.fact_date end as period,
      f.campaign_id,
      sum(f.impressions) as impressions, sum(f.clicks) as clicks, sum(f.cost) as cost,
      sum(f.conversions) as conversions, sum(f.conversions_value) as conversions_value,
      sum(f.all_conversions) as all_conversions, sum(f.all_conversions_value) as all_conversions_value,
      -- impression share is weighted by eligible impressions = impressions / share
      sum(case when f.search_impression_share > 0 then f.impressions / f.search_impression_share else 0 end) as eligible_impressions,
      sum(case when f.search_impression_share > 0 then f.impressions else 0 end) as is_impressions,
      sum(case when f.search_impression_share > 0 then (f.impressions / f.search_impression_share) * coalesce(f.search_budget_lost_is, 0) else 0 end) as budget_lost_impressions,
      sum(case when f.search_impression_share > 0 then (f.impressions / f.search_impression_share) * coalesce(f.search_rank_lost_is, 0) else 0 end) as rank_lost_impressions
    from public.ads_campaign_daily f
    where f.account_id = any(p_account_ids) and f.fact_date between p_start_date and p_end_date
      and (p_platforms is null or f.platform = any(p_platforms))
    group by f.account_id, f.platform, 3, f.campaign_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id', g.account_id, 'platform', g.platform, 'period', g.period, 'campaign_id', g.campaign_id,
    'campaign_name', public.campaign_label(g.platform, coalesce(d.campaign_name, g.campaign_id)), 'channel_type', coalesce(d.channel_type, ''),
    'status', coalesce(d.status, ''), 'network', coalesce(d.network, 'Other'), 'category', coalesce(d.category, 'Other'),
    'bucket', coalesce(d.bucket, ''), 'target_roas', d.target_roas, 'target_cpa', d.target_cpa,
    'impressions', g.impressions, 'clicks', g.clicks, 'cost', g.cost, 'conversions', g.conversions,
    'conversions_value', g.conversions_value, 'all_conversions', g.all_conversions,
    'all_conversions_value', g.all_conversions_value, 'eligible_impressions', g.eligible_impressions,
    'is_impressions', g.is_impressions, 'budget_lost_impressions', g.budget_lost_impressions,
    'rank_lost_impressions', g.rank_lost_impressions
  ) order by g.period, g.account_id, g.platform, g.campaign_id), '[]'::jsonb)
  from g left join public.campaign_dim d on d.account_id = g.account_id and d.platform = g.platform and d.campaign_id = g.campaign_id;
$$;

CREATE FUNCTION public.read_change_events_json(p_account_ids text[], p_start_date date, p_end_date date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(row_to_json(x) order by x.change_time, x.resource_name), '[]'::jsonb) from (
    select e.account_id, e.change_time,
      to_char(e.change_time at time zone 'Europe/Amsterdam', 'YYYY-MM-DD') as change_date,
      e.resource_name, e.resource_type, e.operation, e.campaign_id, e.campaign_name, e.changed_fields,
      e.summary, e.user_email, e.client_type
    from public.ads_change_events e
    where e.account_id = any(p_account_ids)
      and e.change_time >= (p_start_date::timestamp at time zone 'Europe/Amsterdam')
      and e.change_time < ((p_end_date + 1)::timestamp at time zone 'Europe/Amsterdam')
  ) x;
$$;

CREATE FUNCTION public.read_communications_json(p_label text, p_include_hidden boolean) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'title', c.title, 'date', c.date, 'time', c.time,
        'participants', to_jsonb(c.participants), 'summary_md', c.summary_md, 'decisions', to_jsonb(c.decisions),
        'detail_md', c.detail_md, 'message_count', c.message_count, 'labels', to_jsonb(c.labels), 'hidden', c.hidden
      ) order by c.date desc, c.time desc, c.id)
      from public.communications c
      where p_include_hidden or not c.hidden
    ), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'source_id', a.source_id, 'title', a.title, 'owner', a.owner,
        'due', a.due, 'label', a.label, 'status', a.status, 'created', a.created
      ) order by a.created, a.id)
      from public.actions a
      join public.communications c on c.id = a.source_id
      where (a.label is null or a.label = p_label) and (p_include_hidden or not c.hidden)
    ), '[]'::jsonb)
  );
$$;

CREATE FUNCTION public.read_context_findings_json(p_label text, p_start date, p_end date, p_include_private boolean) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', f.kind, 'source', f.source, 'account', f.account_label, 'run_date', f.run_date,
    'window_start', f.window_start, 'window_end', f.window_end, 'claim', f.claim, 'evidence', f.evidence,
    'severity', f.severity, 'client_safe', f.client_safe
  ) order by f.kind, f.run_date desc, f.id), '[]'::jsonb)
  from public.context_findings f
  where (f.account_label is null or f.account_label = p_label)
    and (p_include_private or f.client_safe)
    and (
      f.kind = 'notes'
      or (f.window_start is not null and f.window_start <= p_end and coalesce(f.window_end, f.run_date) >= p_start)
      or (f.window_start is null and f.run_date between p_start - 120 and p_end + 30)
    );
$$;

CREATE FUNCTION public.read_conversion_roles_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text DEFAULT 'day'::text, p_platforms text[] DEFAULT NULL::text[]) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    AS $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select c.account_id, c.platform,
      case when p_grain = 'month' then date_trunc('month', c.fact_date)::date
           when p_grain = 'week' then date_trunc('week', c.fact_date)::date
           else c.fact_date end as period,
      c.campaign_id,
      coalesce(r.role, 'unmapped') as role,
      c.conversion_action_id, max(c.conversion_action_name) as conversion_action_name,
      sum(c.all_conversions) as conversions, sum(c.all_conversions_value) as conversions_value
    from public.ads_conversions_daily c
    left join public.conversion_roles r on r.account_id = c.account_id and r.platform = c.platform
      and r.conversion_action_id = c.conversion_action_id
      and c.fact_date >= r.valid_from and (r.valid_to is null or c.fact_date <= r.valid_to)
    where c.account_id = any(p_account_ids) and c.fact_date between p_start_date and p_end_date
      and (p_platforms is null or c.platform = any(p_platforms))
    group by c.account_id, c.platform, 3, c.campaign_id, r.role, c.conversion_action_id
  ) x;
$$;

CREATE FUNCTION public.read_data_coverage_json() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
    AS $$
  select coalesce(jsonb_agg(row_to_json(x) order by x.dataset, x.account_id, x.platform), '[]'::jsonb) from (
    select 'campaign' as dataset, account_id, platform, min(fact_date) as first_date, max(fact_date) as last_date, count(*) as rows from public.ads_campaign_daily group by 2, 3
    union all select 'conversions', account_id, platform, min(fact_date), max(fact_date), count(*) from public.ads_conversions_daily group by 2, 3
    union all select 'geo', account_id, platform, min(fact_date), max(fact_date), count(*) from public.ads_geo_daily group by 2, 3
    union all select 'device', account_id, platform, min(fact_date), max(fact_date), count(*) from public.ads_device_daily group by 2, 3
    union all select 'product', account_id, platform, min(fact_date), max(fact_date), count(*) from public.ads_product_daily group by 2, 3
    union all select 'product_monthly', account_id, platform, min(fact_month), max(fact_month), count(*) from public.ads_product_monthly group by 2, 3
    union all select 'quality', account_id, platform, min(fact_date), max(fact_date), count(*) from public.ads_keyword_quality_daily group by 2, 3
    union all select 'changes', account_id, 'google', min((change_time at time zone 'Europe/Amsterdam')::date), max((change_time at time zone 'Europe/Amsterdam')::date), count(*) from public.ads_change_events group by 2
    union all select 'auction', account_id, 'google', min(fact_date), max(fact_date), count(*) from public.auction_insights_daily group by 2
  ) x;
$$;

CREATE FUNCTION public.read_device_facts_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text DEFAULT 'day'::text, p_platforms text[] DEFAULT NULL::text[]) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    AS $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select f.account_id, f.platform,
      case when p_grain = 'month' then date_trunc('month', f.fact_date)::date
           when p_grain = 'week' then date_trunc('week', f.fact_date)::date else f.fact_date end as period,
      f.campaign_id, public.campaign_label(f.platform, coalesce(d.campaign_name, f.campaign_id)) as campaign_name, coalesce(d.status, '') as status,
      coalesce(d.category, 'Other') as category, coalesce(d.network, 'Other') as network,
      f.device, sum(f.impressions) as impressions, sum(f.clicks) as clicks, sum(f.cost) as cost,
      sum(f.conversions) as conversions, sum(f.conversions_value) as conversions_value
    from public.ads_device_daily f
    left join public.campaign_dim d on d.account_id = f.account_id and d.platform = f.platform and d.campaign_id = f.campaign_id
    where f.account_id = any(p_account_ids) and f.fact_date between p_start_date and p_end_date
      and (p_platforms is null or f.platform = any(p_platforms))
    group by f.account_id, f.platform, 3, f.campaign_id, d.campaign_name, d.status, d.category, d.network, f.device
  ) x;
$$;

CREATE FUNCTION public.read_feed_daily_json(p_account_id text, p_start_date date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', d.snapshot_date, 'totals', d.totals, 'by_destination', d.by_destination, 'synced_at', d.synced_at
  ) order by d.snapshot_date), '[]'::jsonb)
  from public.feed_daily d
  where d.account_id = p_account_id and d.snapshot_date >= p_start_date;
$$;

CREATE FUNCTION public.read_feed_products_json(p_account_ids text[]) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id', f.account_id, 'feed_label', f.feed_label, 'item_id', f.item_id, 'title', f.title, 'link', f.link,
    'image_link', f.image_link, 'price', f.price, 'currency', f.currency, 'availability', f.availability, 'brand', f.brand,
    'product_type', f.product_type, 'custom_label_0', f.custom_label_0, 'custom_label_1', f.custom_label_1,
    'custom_label_2', f.custom_label_2, 'custom_label_3', f.custom_label_3, 'custom_label_4', f.custom_label_4,
    'ads_status', f.ads_status, 'merchant_status', f.merchant_status, 'issues', f.issues, 'synced_at', f.synced_at
  ) order by f.account_id, f.item_id, f.feed_label), '[]'::jsonb)
  from public.feed_products f
  where f.account_id = any(p_account_ids);
$$;

CREATE FUNCTION public.read_geo_facts_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text DEFAULT 'day'::text, p_platforms text[] DEFAULT NULL::text[]) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    AS $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select f.account_id, f.platform,
      case when p_grain = 'month' then date_trunc('month', f.fact_date)::date
           when p_grain = 'week' then date_trunc('week', f.fact_date)::date else f.fact_date end as period,
      f.campaign_id, public.campaign_label(f.platform, coalesce(d.campaign_name, f.campaign_id)) as campaign_name, coalesce(d.status, '') as status,
      coalesce(d.category, 'Other') as category, coalesce(d.network, 'Other') as network,
      f.country_code, sum(f.impressions) as impressions, sum(f.clicks) as clicks, sum(f.cost) as cost,
      sum(f.conversions) as conversions, sum(f.conversions_value) as conversions_value
    from public.ads_geo_daily f
    left join public.campaign_dim d on d.account_id = f.account_id and d.platform = f.platform and d.campaign_id = f.campaign_id
    where f.account_id = any(p_account_ids) and f.fact_date between p_start_date and p_end_date
      and (p_platforms is null or f.platform = any(p_platforms))
    group by f.account_id, f.platform, 3, f.campaign_id, d.campaign_name, d.status, d.category, d.network, f.country_code
  ) x;
$$;

CREATE FUNCTION public.read_keyword_quality_json(p_account_ids text[], p_start_date date, p_end_date date, p_platforms text[] DEFAULT NULL::text[]) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_array(
    q.fact_date, q.campaign_id, public.campaign_label(q.platform, coalesce(c.campaign_name, q.campaign_id)), coalesce(c.status, 'REMOVED'),
    coalesce(c.network, 'Other'), coalesce(c.category, 'Other'), q.ad_group_id,
    coalesce(k.ad_group_name, ''), q.criterion_id, coalesce(k.keyword_text, q.criterion_id), k.match_type,
    q.impressions, q.clicks, round(q.cost::numeric, 2), round(q.conversions::numeric, 3), round(q.conversions_value::numeric, 2),
    q.quality_score, q.expected_ctr, q.ad_relevance, q.landing_page
  ) order by q.fact_date, q.ad_group_id, q.criterion_id), '[]'::jsonb)
  from public.ads_keyword_quality_daily q
  left join public.campaign_dim c on c.account_id = q.account_id and c.platform = q.platform and c.campaign_id = q.campaign_id
  left join public.keyword_dim k on k.account_id = q.account_id and k.platform = q.platform
    and k.ad_group_id = q.ad_group_id and k.criterion_id = q.criterion_id
  where q.account_id = any(p_account_ids) and q.fact_date between p_start_date and p_end_date
    and (p_platforms is null or q.platform = any(p_platforms));
$$;

CREATE FUNCTION public.read_product_daily_json(p_account_ids text[], p_item_id text, p_start_date date, p_end_date date, p_platforms text[] DEFAULT NULL::text[]) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', x.fact_date, 'campaign_id', x.campaign_id, 'campaign_name', x.campaign_name, 'campaign_bucket', x.campaign_bucket,
    'country_code', x.country_code, 'label', x.custom_label_2,
    'impressions', x.impressions, 'clicks', x.clicks, 'cost', x.cost, 'conversions', x.conversions, 'conversions_value', x.conversions_value
  ) order by x.fact_date, x.campaign_id, x.country_code), '[]'::jsonb)
  from (
    select f.fact_date, f.campaign_id, public.campaign_label(f.platform, coalesce(d.campaign_name, f.campaign_id)) as campaign_name,
      coalesce(d.bucket, '') as campaign_bucket, f.country_code, f.custom_label_2,
      sum(f.impressions) as impressions, sum(f.clicks) as clicks, sum(f.cost) as cost,
      sum(f.conversions) as conversions, sum(f.conversions_value) as conversions_value
    from public.ads_product_daily f
    left join public.campaign_dim d on d.account_id = f.account_id and d.platform = f.platform and d.campaign_id = f.campaign_id
    where f.account_id = any(p_account_ids) and lower(f.product_item_id) = lower(p_item_id)
      and f.fact_date between p_start_date and p_end_date
      and (p_platforms is null or f.platform = any(p_platforms))
    group by f.fact_date, f.platform, f.campaign_id, d.campaign_name, d.bucket, f.country_code, f.custom_label_2
  ) x;
$$;

CREATE FUNCTION public.read_product_facts_json(p_account_ids text[], p_start_date date, p_end_date date, p_platforms text[] DEFAULT NULL::text[]) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    AS $$
declare
  v_daily_floor date;
  v_result jsonb;
begin
  select min(fact_date) into v_daily_floor from public.ads_product_daily
  where account_id = any(p_account_ids) and platform = 'google';
  if v_daily_floor is not null and p_start_date >= v_daily_floor then
    select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into v_result from (
      select f.account_id, f.platform, f.campaign_id, public.campaign_label(f.platform, coalesce(d.campaign_name, f.campaign_id)) as campaign_name,
        coalesce(d.network, 'Other') as network, coalesce(d.category, 'Other') as category, coalesce(d.bucket, '') as campaign_bucket,
        f.product_item_id, max(f.product_title) as product_title, max(f.product_type) as product_type, max(f.brand) as brand,
        max(f.custom_label_0) as custom_label_0, max(f.custom_label_1) as custom_label_1, f.custom_label_2,
        max(f.custom_label_3) as custom_label_3, max(f.custom_label_4) as custom_label_4, f.country_code,
        sum(f.impressions) as impressions, sum(f.clicks) as clicks, sum(f.cost) as cost,
        sum(f.conversions) as conversions, sum(f.conversions_value) as conversions_value, 'daily'::text as source
      from public.ads_product_daily f
      left join public.campaign_dim d on d.account_id = f.account_id and d.platform = f.platform and d.campaign_id = f.campaign_id
      where f.account_id = any(p_account_ids) and f.fact_date between p_start_date and p_end_date
        and (p_platforms is null or f.platform = any(p_platforms))
      group by f.account_id, f.platform, f.campaign_id, d.campaign_name, d.network, d.category, d.bucket, f.product_item_id, f.custom_label_2, f.country_code
    ) x;
  else
    select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into v_result from (
      select f.account_id, f.platform, f.campaign_id, public.campaign_label(f.platform, coalesce(d.campaign_name, f.campaign_id)) as campaign_name,
        coalesce(d.network, 'Other') as network, coalesce(d.category, 'Other') as category, coalesce(d.bucket, '') as campaign_bucket,
        f.product_item_id, max(f.product_title) as product_title, max(f.product_type) as product_type, max(f.brand) as brand,
        max(f.custom_label_0) as custom_label_0, max(f.custom_label_1) as custom_label_1, f.custom_label_2,
        max(f.custom_label_3) as custom_label_3, max(f.custom_label_4) as custom_label_4, f.country_code,
        sum(f.impressions) as impressions, sum(f.clicks) as clicks, sum(f.cost) as cost,
        sum(f.conversions) as conversions, sum(f.conversions_value) as conversions_value, 'monthly'::text as source
      from public.ads_product_monthly f
      left join public.campaign_dim d on d.account_id = f.account_id and d.platform = f.platform and d.campaign_id = f.campaign_id
      where f.account_id = any(p_account_ids)
        and f.fact_month between date_trunc('month', p_start_date)::date and date_trunc('month', p_end_date)::date
        and (p_platforms is null or f.platform = any(p_platforms))
      group by f.account_id, f.platform, f.campaign_id, d.campaign_name, d.network, d.category, d.bucket, f.product_item_id, f.custom_label_2, f.country_code
    ) x;
  end if;
  return v_result;
end;
$$;

CREATE FUNCTION public.read_product_label_days_json(p_account_ids text[], p_start_date date, p_end_date date, p_platforms text[] DEFAULT NULL::text[]) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_array(
    x.fact_date, x.product_item_id, x.custom_label_2, x.impressions, x.clicks, round(x.cost::numeric, 2),
    round(x.conversions::numeric, 3), round(x.conversions_value::numeric, 2), x.product_type
  ) order by x.fact_date, x.product_item_id), '[]'::jsonb)
  from (
    select f.fact_date, f.product_item_id, coalesce(f.custom_label_2, '') as custom_label_2, max(f.product_type) as product_type,
      sum(f.impressions) as impressions, sum(f.clicks) as clicks, sum(f.cost) as cost,
      sum(f.conversions) as conversions, sum(f.conversions_value) as conversions_value
    from public.ads_product_daily f
    where f.account_id = any(p_account_ids) and f.fact_date between p_start_date and p_end_date
      and coalesce(f.product_item_id, '') <> ''
      and (p_platforms is null or f.platform = any(p_platforms))
    group by f.fact_date, f.product_item_id, coalesce(f.custom_label_2, '')
  ) x;
$$;

CREATE FUNCTION public.read_sync_status_json() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select distinct on (source, dataset, account_id) source, dataset, account_id, status, start_date, end_date,
      row_count, duration_ms, error_message, started_at, completed_at
    from public.sync_runs
    order by source, dataset, account_id, started_at desc
  ) x;
$$;

CREATE FUNCTION public.reserve_ai_spend(p_month text, p_usd numeric, p_cap numeric) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_usd numeric;
begin
  insert into public.ai_spend (month, usd, updated_at) values (p_month, 0, now())
  on conflict (month) do nothing;
  select usd into v_usd from public.ai_spend where month = p_month for update;
  if v_usd + greatest(p_usd, 0) > p_cap then
    return false;
  end if;
  update public.ai_spend set usd = usd + greatest(p_usd, 0), updated_at = now() where month = p_month;
  return true;
end;
$$;

CREATE FUNCTION public.set_action_status(p_id text, p_status text, p_changed_by text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_status not in ('open', 'done', 'dropped') then
    raise exception 'Unknown action status %', p_status;
  end if;
  update public.actions a set status = p_status, status_changed_at = now(), status_changed_by = p_changed_by
  from public.communications c
  where a.id = p_id and c.id = a.source_id and not c.hidden;
  return found;
end;
$$;

CREATE FUNCTION public.set_communication_hidden(p_id text, p_hidden boolean, p_changed_by text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.communications
  set hidden = p_hidden, hidden_at = case when p_hidden then now() end, hidden_by = case when p_hidden then p_changed_by end
  where id = p_id;
  return found;
end;
$$;

CREATE FUNCTION public.settle_ai_spend(p_month text, p_delta numeric) RETURNS numeric
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.ai_spend set usd = greatest(usd + p_delta, 0), updated_at = now()
  where month = p_month
  returning usd;
$$;

CREATE FUNCTION public.upsert_campaign_dim(p_account_id text, p_rows jsonb, p_platform text DEFAULT 'google'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  n integer := 0;
begin
  insert into public.campaign_dim (account_id, platform, campaign_id, campaign_name, channel_type, status, bidding_strategy_type,
    target_roas, target_cpa, budget_amount, network, category, bucket, parsed, overridden, updated_at)
  select p_account_id, p_platform, r.campaign_id, r.campaign_name, coalesce(r.channel_type, ''), coalesce(r.status, ''),
    coalesce(r.bidding_strategy_type, ''), r.target_roas, r.target_cpa, r.budget_amount,
    coalesce(o.network, r.network, 'Other'), coalesce(o.category, r.category, 'Other'), coalesce(o.bucket, r.bucket, ''),
    coalesce(r.parsed, false), (o.campaign_id is not null), now()
  from jsonb_to_recordset(p_rows) as r(campaign_id text, campaign_name text, channel_type text, status text,
    bidding_strategy_type text, target_roas double precision, target_cpa double precision, budget_amount double precision,
    network text, category text, bucket text, parsed boolean)
  left join public.campaign_overrides o on o.account_id = p_account_id and o.campaign_id = r.campaign_id
  on conflict (account_id, platform, campaign_id) do update set
    campaign_name = excluded.campaign_name, channel_type = excluded.channel_type, status = excluded.status,
    bidding_strategy_type = excluded.bidding_strategy_type, target_roas = excluded.target_roas,
    target_cpa = excluded.target_cpa, budget_amount = excluded.budget_amount, network = excluded.network,
    category = excluded.category, bucket = excluded.bucket, parsed = excluded.parsed,
    overridden = excluded.overridden, updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

CREATE TABLE public.accounts (
    id text NOT NULL,
    label text NOT NULL,
    display_name text NOT NULL,
    login_customer_id text NOT NULL,
    merchant_id text,
    currency text DEFAULT 'EUR'::text NOT NULL,
    lag_days integer DEFAULT 7 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    msads_account_id text,
    msads_customer_id text
);

CREATE TABLE public.actions (
    id text NOT NULL,
    source_id text NOT NULL,
    title text NOT NULL,
    owner text NOT NULL,
    due date,
    label text,
    status text DEFAULT 'open'::text NOT NULL,
    created date NOT NULL,
    status_changed_at timestamp with time zone,
    status_changed_by text,
    CONSTRAINT actions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'dropped'::text])))
);

CREATE TABLE public.ads_campaign_daily (
    account_id text NOT NULL,
    fact_date date NOT NULL,
    campaign_id text NOT NULL,
    impressions double precision DEFAULT 0 NOT NULL,
    clicks double precision DEFAULT 0 NOT NULL,
    cost double precision DEFAULT 0 NOT NULL,
    conversions double precision DEFAULT 0 NOT NULL,
    conversions_value double precision DEFAULT 0 NOT NULL,
    all_conversions double precision DEFAULT 0 NOT NULL,
    all_conversions_value double precision DEFAULT 0 NOT NULL,
    search_impression_share double precision,
    search_budget_lost_is double precision,
    search_rank_lost_is double precision,
    top_impression_pct double precision,
    abs_top_impression_pct double precision,
    sync_run_id uuid,
    platform text DEFAULT 'google'::text NOT NULL,
    CONSTRAINT ads_campaign_daily_platform_check CHECK ((platform = ANY (ARRAY['google'::text, 'microsoft'::text])))
);

CREATE TABLE public.ads_change_events (
    account_id text NOT NULL,
    change_time timestamp with time zone NOT NULL,
    resource_name text NOT NULL,
    resource_type text DEFAULT ''::text NOT NULL,
    operation text DEFAULT ''::text NOT NULL,
    campaign_id text,
    campaign_name text,
    changed_fields text[] DEFAULT '{}'::text[] NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    user_email text DEFAULT ''::text NOT NULL,
    client_type text DEFAULT ''::text NOT NULL,
    sync_run_id uuid
);

CREATE TABLE public.ads_conversions_daily (
    account_id text NOT NULL,
    fact_date date NOT NULL,
    campaign_id text NOT NULL,
    conversion_action_id text NOT NULL,
    conversion_action_name text DEFAULT ''::text NOT NULL,
    conversions double precision DEFAULT 0 NOT NULL,
    conversions_value double precision DEFAULT 0 NOT NULL,
    all_conversions double precision DEFAULT 0 NOT NULL,
    all_conversions_value double precision DEFAULT 0 NOT NULL,
    sync_run_id uuid,
    platform text DEFAULT 'google'::text NOT NULL,
    CONSTRAINT ads_conversions_daily_platform_check CHECK ((platform = ANY (ARRAY['google'::text, 'microsoft'::text])))
);

CREATE TABLE public.ads_device_daily (
    account_id text NOT NULL,
    fact_date date NOT NULL,
    campaign_id text NOT NULL,
    device text NOT NULL,
    impressions double precision DEFAULT 0 NOT NULL,
    clicks double precision DEFAULT 0 NOT NULL,
    cost double precision DEFAULT 0 NOT NULL,
    conversions double precision DEFAULT 0 NOT NULL,
    conversions_value double precision DEFAULT 0 NOT NULL,
    sync_run_id uuid,
    platform text DEFAULT 'google'::text NOT NULL,
    CONSTRAINT ads_device_daily_platform_check CHECK ((platform = ANY (ARRAY['google'::text, 'microsoft'::text])))
);

CREATE TABLE public.ads_geo_daily (
    account_id text NOT NULL,
    fact_date date NOT NULL,
    campaign_id text NOT NULL,
    country_criterion_id text NOT NULL,
    country_code text DEFAULT 'Other'::text NOT NULL,
    impressions double precision DEFAULT 0 NOT NULL,
    clicks double precision DEFAULT 0 NOT NULL,
    cost double precision DEFAULT 0 NOT NULL,
    conversions double precision DEFAULT 0 NOT NULL,
    conversions_value double precision DEFAULT 0 NOT NULL,
    sync_run_id uuid,
    platform text DEFAULT 'google'::text NOT NULL,
    CONSTRAINT ads_geo_daily_platform_check CHECK ((platform = ANY (ARRAY['google'::text, 'microsoft'::text])))
);

CREATE TABLE public.ads_keyword_quality_daily (
    account_id text NOT NULL,
    fact_date date NOT NULL,
    campaign_id text NOT NULL,
    ad_group_id text NOT NULL,
    criterion_id text NOT NULL,
    impressions double precision DEFAULT 0 NOT NULL,
    clicks double precision DEFAULT 0 NOT NULL,
    cost double precision DEFAULT 0 NOT NULL,
    conversions double precision DEFAULT 0 NOT NULL,
    conversions_value double precision DEFAULT 0 NOT NULL,
    quality_score smallint,
    expected_ctr smallint,
    ad_relevance smallint,
    landing_page smallint,
    sync_run_id uuid,
    platform text DEFAULT 'google'::text NOT NULL,
    CONSTRAINT ads_keyword_quality_daily_platform_check CHECK ((platform = ANY (ARRAY['google'::text, 'microsoft'::text])))
);

CREATE TABLE public.ads_product_daily (
    account_id text NOT NULL,
    fact_date date NOT NULL,
    campaign_id text NOT NULL,
    product_item_id text NOT NULL,
    product_title text DEFAULT ''::text NOT NULL,
    product_type text DEFAULT ''::text NOT NULL,
    brand text DEFAULT ''::text NOT NULL,
    custom_label_0 text DEFAULT ''::text NOT NULL,
    custom_label_1 text DEFAULT ''::text NOT NULL,
    custom_label_2 text DEFAULT ''::text NOT NULL,
    custom_label_3 text DEFAULT ''::text NOT NULL,
    custom_label_4 text DEFAULT ''::text NOT NULL,
    country_code text DEFAULT ''::text NOT NULL,
    impressions double precision DEFAULT 0 NOT NULL,
    clicks double precision DEFAULT 0 NOT NULL,
    cost double precision DEFAULT 0 NOT NULL,
    conversions double precision DEFAULT 0 NOT NULL,
    conversions_value double precision DEFAULT 0 NOT NULL,
    sync_run_id uuid,
    platform text DEFAULT 'google'::text NOT NULL,
    CONSTRAINT ads_product_daily_platform_check CHECK ((platform = ANY (ARRAY['google'::text, 'microsoft'::text])))
);

CREATE TABLE public.ads_product_monthly (
    account_id text NOT NULL,
    fact_month date NOT NULL,
    campaign_id text NOT NULL,
    product_item_id text NOT NULL,
    product_title text DEFAULT ''::text NOT NULL,
    product_type text DEFAULT ''::text NOT NULL,
    brand text DEFAULT ''::text NOT NULL,
    custom_label_0 text DEFAULT ''::text NOT NULL,
    custom_label_1 text DEFAULT ''::text NOT NULL,
    custom_label_2 text DEFAULT ''::text NOT NULL,
    custom_label_3 text DEFAULT ''::text NOT NULL,
    custom_label_4 text DEFAULT ''::text NOT NULL,
    country_code text DEFAULT ''::text NOT NULL,
    impressions double precision DEFAULT 0 NOT NULL,
    clicks double precision DEFAULT 0 NOT NULL,
    cost double precision DEFAULT 0 NOT NULL,
    conversions double precision DEFAULT 0 NOT NULL,
    conversions_value double precision DEFAULT 0 NOT NULL,
    sync_run_id uuid,
    platform text DEFAULT 'google'::text NOT NULL,
    CONSTRAINT ads_product_monthly_fact_month_check CHECK ((fact_month = (date_trunc('month'::text, (fact_month)::timestamp with time zone))::date)),
    CONSTRAINT ads_product_monthly_platform_check CHECK ((platform = ANY (ARRAY['google'::text, 'microsoft'::text])))
);

CREATE TABLE public.ai_insights (
    key text NOT NULL,
    account_label text NOT NULL,
    role text NOT NULL,
    view jsonb NOT NULL,
    story jsonb NOT NULL,
    source text NOT NULL,
    model text,
    status text DEFAULT 'auto'::text NOT NULL,
    edited_story jsonb,
    edited_by text,
    edited_at timestamp with time zone,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    cost_usd numeric DEFAULT 0 NOT NULL,
    edit_note text,
    CONSTRAINT ai_insights_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'client'::text]))),
    CONSTRAINT ai_insights_status_check CHECK ((status = ANY (ARRAY['auto'::text, 'approved'::text, 'hidden'::text])))
);

CREATE TABLE public.ai_spend (
    month text NOT NULL,
    usd numeric DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.auction_insights_daily (
    account_id text NOT NULL,
    network text NOT NULL,
    fact_date date NOT NULL,
    campaign_name text NOT NULL,
    competitor text NOT NULL,
    campaign_id text,
    category text DEFAULT 'Other'::text NOT NULL,
    impression_share double precision,
    is_capped boolean DEFAULT false NOT NULL,
    overlap_rate double precision,
    position_above_rate double precision,
    top_of_page_rate double precision,
    abs_top_rate double precision,
    outranking_share double precision,
    source text DEFAULT 'sheet'::text NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auction_insights_daily_network_check CHECK ((network = ANY (ARRAY['Search'::text, 'Shopping'::text])))
);

CREATE TABLE public.campaign_dim (
    account_id text NOT NULL,
    campaign_id text NOT NULL,
    campaign_name text NOT NULL,
    channel_type text DEFAULT ''::text NOT NULL,
    status text DEFAULT ''::text NOT NULL,
    bidding_strategy_type text DEFAULT ''::text NOT NULL,
    target_roas double precision,
    target_cpa double precision,
    budget_amount double precision,
    network text DEFAULT 'Other'::text NOT NULL,
    category text DEFAULT 'Other'::text NOT NULL,
    bucket text DEFAULT ''::text NOT NULL,
    parsed boolean DEFAULT false NOT NULL,
    overridden boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    platform text DEFAULT 'google'::text NOT NULL,
    CONSTRAINT campaign_dim_platform_check CHECK ((platform = ANY (ARRAY['google'::text, 'microsoft'::text])))
);

CREATE TABLE public.campaign_overrides (
    account_id text NOT NULL,
    campaign_id text NOT NULL,
    category text,
    bucket text,
    network text,
    note text
);

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id text NOT NULL,
    user_email text NOT NULL,
    role text NOT NULL,
    account_label text NOT NULL,
    view jsonb DEFAULT '{}'::jsonb NOT NULL,
    text text NOT NULL,
    source text,
    escalated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rating smallint,
    rating_note text,
    rated_at timestamp with time zone,
    CONSTRAINT chat_messages_rating_check CHECK ((rating = ANY (ARRAY['-1'::integer, 1]))),
    CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);

CREATE TABLE public.communications (
    id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    date date NOT NULL,
    "time" text DEFAULT ''::text NOT NULL,
    participants text[] DEFAULT '{}'::text[] NOT NULL,
    summary_md text DEFAULT ''::text NOT NULL,
    decisions text[] DEFAULT '{}'::text[] NOT NULL,
    detail_md text,
    message_count integer DEFAULT 1 NOT NULL,
    labels text[] DEFAULT '{}'::text[] NOT NULL,
    hidden boolean DEFAULT false NOT NULL,
    hidden_at timestamp with time zone,
    hidden_by text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT communications_kind_check CHECK ((kind = ANY (ARRAY['meeting'::text, 'email'::text])))
);

CREATE TABLE public.context_findings (
    id text NOT NULL,
    source_key text NOT NULL,
    kind text NOT NULL,
    source text NOT NULL,
    account_label text,
    run_date date NOT NULL,
    window_start date,
    window_end date,
    claim text NOT NULL,
    evidence text DEFAULT ''::text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    client_safe boolean DEFAULT false NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT context_findings_kind_check CHECK ((kind = ANY (ARRAY['audit'::text, 'notes'::text, 'memory'::text]))),
    CONSTRAINT context_findings_severity_check CHECK ((severity = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])))
);

CREATE TABLE public.conversion_roles (
    id bigint NOT NULL,
    account_id text NOT NULL,
    conversion_action_id text NOT NULL,
    conversion_action_name text NOT NULL,
    role text NOT NULL,
    valid_from date DEFAULT '2024-01-01'::date NOT NULL,
    valid_to date,
    note text,
    platform text DEFAULT 'google'::text NOT NULL,
    CONSTRAINT conversion_roles_platform_check CHECK ((platform = ANY (ARRAY['google'::text, 'microsoft'::text]))),
    CONSTRAINT conversion_roles_role_check CHECK ((role = ANY (ARRAY['primary_revenue'::text, 'secondary'::text, 'samples'::text, 'micro'::text])))
);

ALTER TABLE public.conversion_roles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.conversion_roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.feed_daily (
    account_id text NOT NULL,
    snapshot_date date NOT NULL,
    totals jsonb NOT NULL,
    by_destination jsonb DEFAULT '[]'::jsonb NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.feed_products (
    account_id text NOT NULL,
    feed_label text DEFAULT ''::text NOT NULL,
    item_id text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    link text,
    image_link text,
    price numeric,
    currency text,
    availability text,
    brand text,
    product_type text,
    custom_label_0 text,
    custom_label_1 text,
    custom_label_2 text,
    custom_label_3 text,
    custom_label_4 text,
    ads_status text,
    merchant_status text,
    issues jsonb DEFAULT '[]'::jsonb NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.keyword_dim (
    account_id text NOT NULL,
    ad_group_id text NOT NULL,
    criterion_id text NOT NULL,
    campaign_id text NOT NULL,
    ad_group_name text DEFAULT ''::text NOT NULL,
    keyword_text text DEFAULT ''::text NOT NULL,
    match_type text,
    status text,
    quality_score smallint,
    expected_ctr smallint,
    ad_relevance smallint,
    landing_page smallint,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    platform text DEFAULT 'google'::text NOT NULL,
    CONSTRAINT keyword_dim_platform_check CHECK ((platform = ANY (ARRAY['google'::text, 'microsoft'::text])))
);

CREATE TABLE public.login_attempts (
    id bigint NOT NULL,
    email text NOT NULL,
    ip text DEFAULT ''::text NOT NULL,
    success boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.login_attempts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.login_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.oauth_tokens (
    provider text NOT NULL,
    refresh_token text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.product_type_exclusions (
    account_id text NOT NULL,
    type_level1 text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    dataset text NOT NULL,
    account_id text,
    start_date date,
    end_date date,
    status text NOT NULL,
    row_count integer,
    duration_ms integer,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT sync_runs_source_check CHECK ((source = ANY (ARRAY['google_ads'::text, 'microsoft_ads'::text, 'merchant'::text, 'sheets'::text, 'meetings'::text]))),
    CONSTRAINT sync_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'complete'::text, 'failed'::text, 'skipped'::text])))
);

CREATE TABLE public.targets (
    id bigint NOT NULL,
    account_id text NOT NULL,
    metric text NOT NULL,
    value double precision NOT NULL,
    kind text DEFAULT 'target'::text NOT NULL,
    phase text,
    valid_from date NOT NULL,
    valid_to date,
    note text,
    CONSTRAINT targets_kind_check CHECK ((kind = ANY (ARRAY['target'::text, 'floor'::text, 'max'::text, 'phase'::text]))),
    CONSTRAINT targets_metric_check CHECK ((metric = ANY (ARRAY['roas'::text, 'cpa'::text, 'revenue_per_month'::text, 'purchases_per_month'::text, 'budget_per_day'::text, 'spend_per_month'::text])))
);

ALTER TABLE public.targets ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.targets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login timestamp with time zone,
    session_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'client'::text])))
);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_label_key UNIQUE (label);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ads_campaign_daily
    ADD CONSTRAINT ads_campaign_daily_pkey PRIMARY KEY (account_id, platform, fact_date, campaign_id);

ALTER TABLE ONLY public.ads_change_events
    ADD CONSTRAINT ads_change_events_pkey PRIMARY KEY (account_id, resource_name, change_time);

ALTER TABLE ONLY public.ads_conversions_daily
    ADD CONSTRAINT ads_conversions_daily_pkey PRIMARY KEY (account_id, platform, fact_date, campaign_id, conversion_action_id);

ALTER TABLE ONLY public.ads_device_daily
    ADD CONSTRAINT ads_device_daily_pkey PRIMARY KEY (account_id, platform, fact_date, campaign_id, device);

ALTER TABLE ONLY public.ads_geo_daily
    ADD CONSTRAINT ads_geo_daily_pkey PRIMARY KEY (account_id, platform, fact_date, campaign_id, country_criterion_id);

ALTER TABLE ONLY public.ads_keyword_quality_daily
    ADD CONSTRAINT ads_keyword_quality_daily_pkey PRIMARY KEY (account_id, platform, fact_date, ad_group_id, criterion_id);

ALTER TABLE ONLY public.ads_product_daily
    ADD CONSTRAINT ads_product_daily_pkey PRIMARY KEY (account_id, platform, fact_date, campaign_id, product_item_id, country_code);

ALTER TABLE ONLY public.ads_product_monthly
    ADD CONSTRAINT ads_product_monthly_pkey PRIMARY KEY (account_id, platform, fact_month, campaign_id, product_item_id, country_code);

ALTER TABLE ONLY public.ai_insights
    ADD CONSTRAINT ai_insights_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.ai_spend
    ADD CONSTRAINT ai_spend_pkey PRIMARY KEY (month);

ALTER TABLE ONLY public.auction_insights_daily
    ADD CONSTRAINT auction_insights_daily_pkey PRIMARY KEY (account_id, network, fact_date, campaign_name, competitor);

ALTER TABLE ONLY public.campaign_dim
    ADD CONSTRAINT campaign_dim_pkey PRIMARY KEY (account_id, platform, campaign_id);

ALTER TABLE ONLY public.campaign_overrides
    ADD CONSTRAINT campaign_overrides_pkey PRIMARY KEY (account_id, campaign_id);

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.context_findings
    ADD CONSTRAINT context_findings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversion_roles
    ADD CONSTRAINT conversion_roles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversion_roles
    ADD CONSTRAINT conversion_roles_platform_action_key UNIQUE (account_id, platform, conversion_action_id, valid_from);

ALTER TABLE ONLY public.feed_daily
    ADD CONSTRAINT feed_daily_pkey PRIMARY KEY (account_id, snapshot_date);

ALTER TABLE ONLY public.feed_products
    ADD CONSTRAINT feed_products_pkey PRIMARY KEY (account_id, feed_label, item_id);

ALTER TABLE ONLY public.keyword_dim
    ADD CONSTRAINT keyword_dim_pkey PRIMARY KEY (account_id, platform, ad_group_id, criterion_id);

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.oauth_tokens
    ADD CONSTRAINT oauth_tokens_pkey PRIMARY KEY (provider);

ALTER TABLE ONLY public.product_type_exclusions
    ADD CONSTRAINT product_type_exclusions_pkey PRIMARY KEY (account_id, type_level1);

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.targets
    ADD CONSTRAINT targets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX actions_source_idx ON public.actions USING btree (source_id);

CREATE INDEX ads_campaign_daily_date_idx ON public.ads_campaign_daily USING btree (fact_date);

CREATE INDEX ads_change_events_time_idx ON public.ads_change_events USING btree (account_id, change_time);

CREATE INDEX ads_keyword_quality_daily_date_idx ON public.ads_keyword_quality_daily USING btree (account_id, fact_date);

CREATE INDEX ads_product_daily_item_idx ON public.ads_product_daily USING btree (account_id, lower(product_item_id), fact_date);

CREATE INDEX ai_insights_account_idx ON public.ai_insights USING btree (account_label, generated_at DESC);

CREATE INDEX ai_insights_corrections_idx ON public.ai_insights USING btree (account_label, edited_at DESC) WHERE (edited_at IS NOT NULL);

CREATE INDEX auction_insights_daily_category_idx ON public.auction_insights_daily USING btree (account_id, network, category, fact_date);

CREATE INDEX auction_insights_daily_date_idx ON public.auction_insights_daily USING btree (account_id, network, fact_date);

CREATE INDEX auction_insights_daily_own_idx ON public.auction_insights_daily USING btree (account_id, fact_date) WHERE (competitor = 'You'::text);

CREATE INDEX chat_messages_escalated_idx ON public.chat_messages USING btree (escalated_at) WHERE (escalated_at IS NOT NULL);

CREATE INDEX chat_messages_thread_idx ON public.chat_messages USING btree (thread_id, created_at);

CREATE INDEX communications_date_idx ON public.communications USING btree (date DESC);

CREATE INDEX context_findings_account_idx ON public.context_findings USING btree (account_label, run_date DESC);

CREATE INDEX context_findings_source_idx ON public.context_findings USING btree (source_key);

CREATE INDEX feed_products_item_idx ON public.feed_products USING btree (account_id, item_id);

CREATE INDEX login_attempts_email_idx ON public.login_attempts USING btree (email, created_at DESC);

CREATE INDEX login_attempts_ip_idx ON public.login_attempts USING btree (ip, created_at DESC);

CREATE INDEX sync_runs_lookup_idx ON public.sync_runs USING btree (source, dataset, account_id, started_at DESC);

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.communications(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ads_campaign_daily
    ADD CONSTRAINT ads_campaign_daily_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.ads_campaign_daily
    ADD CONSTRAINT ads_campaign_daily_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.sync_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ads_change_events
    ADD CONSTRAINT ads_change_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.ads_change_events
    ADD CONSTRAINT ads_change_events_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.sync_runs(id);

ALTER TABLE ONLY public.ads_conversions_daily
    ADD CONSTRAINT ads_conversions_daily_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.ads_conversions_daily
    ADD CONSTRAINT ads_conversions_daily_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.sync_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ads_device_daily
    ADD CONSTRAINT ads_device_daily_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.ads_device_daily
    ADD CONSTRAINT ads_device_daily_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.sync_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ads_geo_daily
    ADD CONSTRAINT ads_geo_daily_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.ads_geo_daily
    ADD CONSTRAINT ads_geo_daily_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.sync_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ads_keyword_quality_daily
    ADD CONSTRAINT ads_keyword_quality_daily_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.ads_product_daily
    ADD CONSTRAINT ads_product_daily_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.ads_product_daily
    ADD CONSTRAINT ads_product_daily_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.sync_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ads_product_monthly
    ADD CONSTRAINT ads_product_monthly_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.ads_product_monthly
    ADD CONSTRAINT ads_product_monthly_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.sync_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.auction_insights_daily
    ADD CONSTRAINT auction_insights_daily_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.campaign_dim
    ADD CONSTRAINT campaign_dim_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.campaign_overrides
    ADD CONSTRAINT campaign_overrides_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.conversion_roles
    ADD CONSTRAINT conversion_roles_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.feed_daily
    ADD CONSTRAINT feed_daily_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.feed_products
    ADD CONSTRAINT feed_products_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.keyword_dim
    ADD CONSTRAINT keyword_dim_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.product_type_exclusions
    ADD CONSTRAINT product_type_exclusions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.targets
    ADD CONSTRAINT targets_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ads_campaign_daily ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ads_change_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ads_conversions_daily ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ads_device_daily ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ads_geo_daily ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ads_keyword_quality_daily ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ads_product_daily ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ads_product_monthly ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_spend ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.auction_insights_daily ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.campaign_dim ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.campaign_overrides ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.communications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.context_findings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.conversion_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.feed_daily ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.feed_products ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.keyword_dim ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.oauth_tokens ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.product_type_exclusions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.targets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.add_ai_spend(p_month text, p_usd numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_ai_spend(p_month text, p_usd numeric) TO service_role;

REVOKE ALL ON FUNCTION public.bump_session_version(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.bump_session_version(p_user_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.campaign_label(p_platform text, p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.campaign_label(p_platform text, p_name text) TO service_role;

REVOKE ALL ON FUNCTION public.publish_auction_insights(p_account_id text, p_network text, p_rows jsonb, p_source text, p_replace_from date, p_replace_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_auction_insights(p_account_id text, p_network text, p_rows jsonb, p_source text, p_replace_from date, p_replace_to date) TO service_role;

REVOKE ALL ON FUNCTION public.publish_change_events(p_account_id text, p_rows jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_change_events(p_account_id text, p_rows jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.publish_communication(p_item jsonb, p_actions jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_communication(p_item jsonb, p_actions jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.publish_context_source(p_source jsonb, p_findings jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_context_source(p_source jsonb, p_findings jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.publish_daily_facts(p_table text, p_account_id text, p_start_date date, p_end_date date, p_sync_run_id uuid, p_rows jsonb, p_complete_run boolean, p_platform text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_daily_facts(p_table text, p_account_id text, p_start_date date, p_end_date date, p_sync_run_id uuid, p_rows jsonb, p_complete_run boolean, p_platform text) TO service_role;

REVOKE ALL ON FUNCTION public.publish_feed_snapshot(p_account_id text, p_snapshot_date date, p_products jsonb, p_totals jsonb, p_by_destination jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_feed_snapshot(p_account_id text, p_snapshot_date date, p_products jsonb, p_totals jsonb, p_by_destination jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.publish_keyword_dim(p_account_id text, p_rows jsonb, p_platform text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_keyword_dim(p_account_id text, p_rows jsonb, p_platform text) TO service_role;

REVOKE ALL ON FUNCTION public.publish_keyword_quality(p_account_id text, p_start_date date, p_end_date date, p_sync_run_id uuid, p_rows jsonb, p_platform text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_keyword_quality(p_account_id text, p_start_date date, p_end_date date, p_sync_run_id uuid, p_rows jsonb, p_platform text) TO service_role;

REVOKE ALL ON FUNCTION public.publish_product_monthly(p_account_id text, p_start_month date, p_end_month date, p_sync_run_id uuid, p_rows jsonb, p_complete_run boolean, p_platform text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_product_monthly(p_account_id text, p_start_month date, p_end_month date, p_sync_run_id uuid, p_rows jsonb, p_complete_run boolean, p_platform text) TO service_role;

REVOKE ALL ON FUNCTION public.read_auction_categories_json(p_account_ids text[], p_start_date date, p_end_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_auction_categories_json(p_account_ids text[], p_start_date date, p_end_date date) TO service_role;

REVOKE ALL ON FUNCTION public.read_auction_coverage_json(p_account_ids text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_auction_coverage_json(p_account_ids text[]) TO service_role;

REVOKE ALL ON FUNCTION public.read_auction_insights_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text, p_network text, p_category text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_auction_insights_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text, p_network text, p_category text) TO service_role;

REVOKE ALL ON FUNCTION public.read_campaign_facts_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text, p_platforms text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_campaign_facts_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text, p_platforms text[]) TO service_role;

REVOKE ALL ON FUNCTION public.read_change_events_json(p_account_ids text[], p_start_date date, p_end_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_change_events_json(p_account_ids text[], p_start_date date, p_end_date date) TO service_role;

REVOKE ALL ON FUNCTION public.read_communications_json(p_label text, p_include_hidden boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_communications_json(p_label text, p_include_hidden boolean) TO service_role;

REVOKE ALL ON FUNCTION public.read_context_findings_json(p_label text, p_start date, p_end date, p_include_private boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_context_findings_json(p_label text, p_start date, p_end date, p_include_private boolean) TO service_role;

REVOKE ALL ON FUNCTION public.read_conversion_roles_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text, p_platforms text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_conversion_roles_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text, p_platforms text[]) TO service_role;

REVOKE ALL ON FUNCTION public.read_data_coverage_json() FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_data_coverage_json() TO service_role;

REVOKE ALL ON FUNCTION public.read_device_facts_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text, p_platforms text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_device_facts_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text, p_platforms text[]) TO service_role;

REVOKE ALL ON FUNCTION public.read_feed_daily_json(p_account_id text, p_start_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_feed_daily_json(p_account_id text, p_start_date date) TO service_role;

REVOKE ALL ON FUNCTION public.read_feed_products_json(p_account_ids text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_feed_products_json(p_account_ids text[]) TO service_role;

REVOKE ALL ON FUNCTION public.read_geo_facts_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text, p_platforms text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_geo_facts_json(p_account_ids text[], p_start_date date, p_end_date date, p_grain text, p_platforms text[]) TO service_role;

REVOKE ALL ON FUNCTION public.read_keyword_quality_json(p_account_ids text[], p_start_date date, p_end_date date, p_platforms text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_keyword_quality_json(p_account_ids text[], p_start_date date, p_end_date date, p_platforms text[]) TO service_role;

REVOKE ALL ON FUNCTION public.read_product_daily_json(p_account_ids text[], p_item_id text, p_start_date date, p_end_date date, p_platforms text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_product_daily_json(p_account_ids text[], p_item_id text, p_start_date date, p_end_date date, p_platforms text[]) TO service_role;

REVOKE ALL ON FUNCTION public.read_product_facts_json(p_account_ids text[], p_start_date date, p_end_date date, p_platforms text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_product_facts_json(p_account_ids text[], p_start_date date, p_end_date date, p_platforms text[]) TO service_role;

REVOKE ALL ON FUNCTION public.read_product_label_days_json(p_account_ids text[], p_start_date date, p_end_date date, p_platforms text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_product_label_days_json(p_account_ids text[], p_start_date date, p_end_date date, p_platforms text[]) TO service_role;

REVOKE ALL ON FUNCTION public.read_sync_status_json() FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_sync_status_json() TO service_role;

REVOKE ALL ON FUNCTION public.reserve_ai_spend(p_month text, p_usd numeric, p_cap numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reserve_ai_spend(p_month text, p_usd numeric, p_cap numeric) TO service_role;

REVOKE ALL ON FUNCTION public.set_action_status(p_id text, p_status text, p_changed_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_action_status(p_id text, p_status text, p_changed_by text) TO service_role;

REVOKE ALL ON FUNCTION public.set_communication_hidden(p_id text, p_hidden boolean, p_changed_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_communication_hidden(p_id text, p_hidden boolean, p_changed_by text) TO service_role;

REVOKE ALL ON FUNCTION public.settle_ai_spend(p_month text, p_delta numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_ai_spend(p_month text, p_delta numeric) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_campaign_dim(p_account_id text, p_rows jsonb, p_platform text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_campaign_dim(p_account_id text, p_rows jsonb, p_platform text) TO service_role;

-- Everything is reached through the service role. Supabase grants new objects to anon and
-- authenticated by default, so those grants are taken away here.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
