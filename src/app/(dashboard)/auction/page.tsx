'use client';

// Auction insights: auction insights per network and category, from the daily
// Google Ads scheduled report in Drive (sync: src/lib/sync/auctionSync.ts) and
// the CSV backfill from 2024. Day, week and month are combined from the daily
// campaign rows with the account's own eligible impressions as weight (see
// migration 0012). No conversion lag on this page: shares are final the moment
// Google reports them, so nothing is shaded.
import { useMemo, useState } from 'react';
import { Card, Notice, Skeleton } from '@/components/Card';
import { AuctionSkeleton } from '@/components/PageSkeletons';
import { useScope } from '@/components/ScopeContext';
import { TrendChart, Series } from '@/components/TrendChart';
import { useSetFreshness } from '@/components/FreshnessContext';
import { useAuctionReport } from '@/hooks/useAuction';
import { useIsPhone } from '@/hooks/useIsMobile';
import { compareLabelFor } from '@/hooks/useGroupedReport';
import {
  assignColors, AuctionGrain, AuctionMetric, AuctionNetwork, defaultGrain, metricsFor, newPlayers, onWatchlist, OWN, OWN_COLOR, rankCompetitors, topCompetitors, trendPoints,
} from '@/lib/auctionShaping';
import { AuctionSelectors } from '@/components/pages/auction/AuctionSelectors';
import { CompetitorTable } from '@/components/pages/auction/CompetitorTable';
import { NewPlayers } from '@/components/pages/auction/NewPlayers';

type ChartView = AuctionGrain | 'history';
const HISTORY_START = '2024-01-01';
const VIEWS: { value: ChartView; label: string }[] = [
  { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'history', label: 'Since 2024' },
];

export default function AuctionPage() {
  const { range, compare, compareRange } = useScope();
  const phone = useIsPhone(); // lower chart on phones
  const [network, setNetwork] = useState<AuctionNetwork>('Search');
  const [pickedCategory, setPickedCategory] = useState<string | null>(null);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [pickedView, setPickedView] = useState<ChartView | null>(null);
  const [pickedMetric, setPickedMetric] = useState<AuctionMetric>('impression_share');
  const view: ChartView = pickedView ?? defaultGrain(range.start, range.end);
  const grain: AuctionGrain = view === 'history' ? 'month' : view;

  // The period data drives the table and the categories; the history chart is a second, monthly request.
  const { data, error, loading } = useAuctionReport({ network, category: pickedCategory, grain: view === 'history' ? defaultGrain(range.start, range.end) : grain });
  const category = data?.category ?? null;
  const history = useAuctionReport({ network, category, grain: 'month', range: { start: HISTORY_START, end: range.end }, skip: view !== 'history' || !category });

  // Back to IS when the network has no such metric (Shopping: no position metrics).
  const metrics = metricsFor(data?.network ?? network);
  const metric = metrics.find(m => m.key === pickedMetric) ?? metrics[0];

  const compareLabel = compareLabelFor(compare);
  const shaped = useMemo(() => {
    if (!data || !category) return null;
    const watchlist = watchlistOnly ? data.watchlist : null;
    const chartRows = view === 'history' ? history.data?.rows ?? [] : data.rows;
    // Ranking and colors anchor on the unfiltered top 8 of the period so a competitor keeps its color across views.
    const baseTop = topCompetitors(data.totals, 8);
    const shown = topCompetitors(data.totals, 8, watchlist);
    const colors = assignColors(shown, baseTop);
    const points = trendPoints(chartRows, [OWN, ...shown], metric.key);
    // Google reports no overlap, position above or outranking for the account itself.
    const ownInChart = points.some(p => p[OWN] !== null);
    const competitors = rankCompetitors(data.totals).filter(r => !watchlist || onWatchlist(r.competitor, watchlist));
    const previous = data.compare_totals ? new Map(data.compare_totals.map(r => [r.competitor, r])) : null;
    const coverage = data.coverage.find(c => c.network === data.network);
    return {
      shown, colors, points, ownInChart, competitors, previous,
      own: data.totals.find(r => r.competitor === OWN) ?? null,
      tableColors: assignColors(competitors.map(r => r.competitor), baseTop),
      fresh: newPlayers(data.totals, data.compare_totals).filter(p => !watchlist || onWatchlist(p.competitor, watchlist)),
      coverage,
    };
  }, [data, history.data, category, view, watchlistOnly, metric.key]);

  useSetFreshness(shaped?.coverage?.last_date ?? null);

  const ownLabel = data?.account.display_name ?? 'Own account';
  // Series.metric only drives the formatting: every auction metric is a share.
  const series: Series[] = shaped ? [
    ...(shaped.ownInChart ? [{ key: OWN, metric: 'impression_share', label: ownLabel, color: OWN_COLOR, type: 'line', axis: 'left' } as Series] : []),
    ...shaped.shown.map((c): Series => ({ key: c, metric: 'impression_share', label: c, color: shaped.colors[c], type: 'line', axis: 'left' })),
  ] : [];

  // Metric chips top left, period chips top right, on one row above the chart.
  const chartControls = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:mb-4">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Metric">
        {metrics.map(m => (
          <button key={m.key} type="button" role="tab" className="btn-chip" data-active={metric.key === m.key} aria-selected={metric.key === m.key} onClick={() => setPickedMetric(m.key)}>{m.label}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="View">
        {VIEWS.map(v => (
          <button key={v.value} type="button" role="tab" className="btn-chip" data-active={view === v.value} aria-selected={view === v.value} onClick={() => setPickedView(v.value)}>{v.label}</button>
        ))}
      </div>
    </div>
  );
  const chartSubject = shaped?.ownInChart ? `Own ${metric.title.toLowerCase()} vs the top ${shaped.shown.length}` : `${metric.title} of the top ${shaped?.shown.length ?? 0}`;
  const chartNote = shaped?.ownInChart ? '' : ' Google does not report this for your own account.';
  const chartLoading = view === 'history' ? history.loading && !history.data : false;

  return (
    <div className="space-y-[var(--page-gap)]">
      {error && <Notice tone="bad">Auction insights could not be loaded: {error}</Notice>}
      {loading && !data && <AuctionSkeleton />}

      {data && data.coverage.length === 0 && (
        <Card title="No auction insights yet">
          <p className="text-sm text-muted">
            Auction insights are not in the Google Ads API. They come from a daily scheduled report in Google Drive, which is not set up yet for {data.account.display_name}.
          </p>
        </Card>
      )}

      {data && data.coverage.length > 0 && (
        <>
          <AuctionSelectors network={data.network} onNetwork={n => { setNetwork(n); setPickedCategory(null); }}
            categories={data.categories[data.network]} category={category ?? ''} onCategory={setPickedCategory}
            watchlistSize={data.watchlist.length} watchlistOnly={watchlistOnly} onWatchlistOnly={setWatchlistOnly} />

          {!category && <Notice tone="warn">No auction insights for {data.network} in this period.</Notice>}

          {shaped && category && (
            <>
              <Card title={`${metric.title}: ${category} (${data.network})`}
                subtitle={view === 'history'
                  ? `Per month since January 2024. ${chartSubject} by overlap in the selected period.${chartNote}`
                  : `${chartSubject} by overlap in this period.${chartNote}${metric.key === 'impression_share' ? ' Values Google reports as "< 10%" are drawn at 10%.' : ''}`}>
                {chartControls}
                {chartLoading && <Skeleton rows={4} />}
                {!chartLoading && shaped.points.length === 0 && <Notice tone="warn">No data for this category in this period.</Notice>}
                {!chartLoading && shaped.points.length > 0 && (
                  <TrendChart data={shaped.points} series={series} grain={grain} height={phone ? 240 : 320} lagFrom={null} target={null} />
                )}
              </Card>

              <Card title="Competitors"
                subtitle={data.network === 'Search'
                  ? 'Over the whole period, sorted by overlap. IS = impression share of that advertiser in the auctions you were also in.'
                  : 'Over the whole period, sorted by overlap. Shopping auction insights have no position metrics, only IS, overlap and outranking.'}>
                <CompetitorTable network={data.network} own={shaped.own} ownLabel={ownLabel} competitors={shaped.competitors} previous={shaped.previous} compareLabel={compareLabel}
                  colors={shaped.tableColors} watchlist={data.watchlist}
                  csvName={`auction-${data.network.toLowerCase()}-${category.toLowerCase().replace(/\s+/g, '-')}-${range.start}-${range.end}`} />
              </Card>

              <Card title="New players" subtitle={compareRange ? `Active in this period but not in the comparison period (${compareLabel}).` : undefined}>
                <NewPlayers players={shaped.fresh} hasCompare={!!data.compare_totals} compareLabel={compareLabel} watchlist={data.watchlist} />
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
