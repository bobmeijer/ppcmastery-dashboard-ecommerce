'use client';

// Building blocks of the Quality Score page: tiles, trend,
// distribution and the campaign / ad group / keyword tables. Data shaped on
// the server (src/lib/qualityShaping.ts).
import { useMemo, useState } from 'react';
import { Card } from '@/components/Card';
import { Column, DataTable } from '@/components/DataTable';
import { InfoTip } from '@/components/Badges';
import { TrendChart } from '@/components/TrendChart';
import { useIsPhone } from '@/hooks/useIsMobile';
import { fmtCurrency, fmtNumber, fmtPercent } from '@/lib/metrics';
import { belowLabel, bindingComponent, Component, COMPONENT_NAMES, COMPONENTS, DistributionBar, FixItem, GroupStats, KeywordStats, QualityPoint, QualityStats } from '@/lib/qualityShaping';

export const fmtQs = (v: number | null) => (v === null ? '-' : fmtNumber(v, 1));
const pt = (now: number | null, before: number | null) => (now === null || before === null ? null : now - before);
const signed = (v: number, text: string) => `${v > 0 ? '+' : ''}${text}`;

// Quality Score on Google's own 1-10 scale: 1-4 weak, 5-6 middling, 7-10 good.
export const qsTone = (v: number | null) => (v === null ? undefined : v <= 4 ? 'var(--bad)' : v <= 6 ? 'var(--warn)' : 'var(--good)');

const BUCKET_TEXT: Record<number, string> = { 2: 'Below', 3: 'Average', 4: 'Above' };
export const BucketPill = ({ value }: { value: number | null }) =>
  value === null ? <span className="text-subtle">-</span> : <span className="qs-pill" data-bucket={value}>{BUCKET_TEXT[value]}</span>;

function Tile({ label, value, sub, tone, delta, deltaGood, className = '' }: { label: string; value: string; sub?: string; tone?: string; delta?: string | null; deltaGood?: boolean | null; className?: string }) {
  return (
    <div className={`card p-4 ${className}`}>
      <div className="eyebrow">{label}</div>
      <div className="num kpi-value mt-2 font-semibold tracking-tight" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="num mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
        {delta && <span style={{ color: deltaGood === null || deltaGood === undefined ? undefined : deltaGood ? 'var(--good)' : 'var(--bad)' }}>{delta}</span>}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

// How big the problem is: three tiles. The component shares
// live in the Components bars directly below, not repeated here.
export function QualityTiles({ current, previous, compareLabel }: { current: QualityStats; previous: QualityStats | null; compareLabel: string }) {
  const qsDelta = pt(current.weightedQs, previous?.weightedQs ?? null);
  const lowDelta = pt(current.lowShare, previous?.lowShare ?? null);
  const vs = previous ? `vs ${compareLabel}` : undefined;
  return (
    // Phones: two columns with the headline QS across both, so the three tiles take half a screen.
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Tile className="max-sm:col-span-2" label="Weighted QS" value={fmtQs(current.weightedQs)} tone={qsTone(current.weightedQs)}
        delta={qsDelta === null ? null : signed(qsDelta, fmtNumber(qsDelta, 1))} deltaGood={qsDelta === null || qsDelta === 0 ? null : qsDelta > 0} sub={vs} />
      <Tile label="Impressions at QS 5 or lower" value={fmtPercent(current.lowShare, 0)}
        delta={lowDelta === null ? null : signed(lowDelta, `${fmtNumber(lowDelta * 100, 1)} pt`)} deltaGood={lowDelta === null || lowDelta === 0 ? null : lowDelta < 0} sub={vs} />
      <Tile label="Cost at QS 5 or lower" value={fmtCurrency(current.lowCost)} sub={current.cost > 0 ? `${fmtPercent(current.lowCost / current.cost, 0)} of cost` : undefined} />
    </div>
  );
}

// The three components as 100% bars on one scale. The component with the largest share below
// average is the binding one (QS framework: fix the binding constraint first).
const SEGMENTS = [
  { key: 'below', label: 'Below average', color: 'var(--bad)' },
  { key: 'average', label: 'Average', color: 'var(--gray-300)' },
  { key: 'above', label: 'Above average', color: 'var(--good)' },
] as const;

export function ComponentBars({ current, previous, compareLabel }: { current: QualityStats; previous: QualityStats | null; compareLabel: string }) {
  const binding = bindingComponent(current);
  return (
    <Card title="Components" subtitle="Rating per component as a share of impressions. The component with the largest below-average share is binding: start there.">
      <div className="space-y-4">
        {COMPONENTS.map(c => {
          const shares = current.components[c];
          const d = pt(shares.below, previous?.components[c].below ?? null);
          return (
            <div key={c} className="qs-bar-row">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{COMPONENT_NAMES[c]}</span>
                {binding === c && <span className="qs-binding">Binding</span>}
              </div>
              <div className="qs-bar" role="img" aria-label={`${COMPONENT_NAMES[c]}: ${SEGMENTS.map(seg => `${seg.label} ${fmtPercent(shares[seg.key], 0)}`).join(', ')}`}>
                {SEGMENTS.map(seg => {
                  const v = shares[seg.key] || 0;
                  return v > 0 ? (
                    <span key={seg.key} className="qs-bar-seg" data-seg={seg.key} style={{ width: `${v * 100}%`, background: seg.color }} title={`${seg.label}: ${fmtPercent(v, 1)}`}>
                      {v >= 0.07 && fmtPercent(v, 0)}
                    </span>
                  ) : null;
                })}
              </div>
              <div className="num text-right text-xs">
                <span className="font-medium" style={{ color: (shares.below || 0) > 0 ? 'var(--bad)' : undefined }}>{fmtPercent(shares.below, 0)} below</span>
                {d !== null && <div className="text-muted"><span style={{ color: d === 0 ? undefined : d < 0 ? 'var(--good)' : 'var(--bad)' }}>{signed(d, `${fmtNumber(d * 100, 1)} pt`)}</span> vs {compareLabel}</div>}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted">
          {SEGMENTS.map(seg => <span key={seg.key} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: seg.color }} />{seg.label}</span>)}
        </div>
      </div>
    </Card>
  );
}

// Where to start: one line per ad group and component below
// average, sorted by the cost at stake. No action line under the component.
// Chips per component; the list opens on the binding one from Components.
type FixChip = 'all' | Component;
const FIX_CHIPS: { value: FixChip; label: string }[] = [
  { value: 'all', label: 'All' },
  ...COMPONENTS.map(c => ({ value: c, label: COMPONENT_NAMES[c] })),
];
const FIX_INFO = 'You fix Quality Score where the cause sits, not per keyword: expected CTR and ad relevance in the ads of an ad group, landing page experience on the page. By ad group and component: the cost, impressions and revenue on the keyword days where that component scored below average. Sorted by cost. Group share = share of the rated impressions of the group. Rows under 100 impressions are dropped. No estimated savings: the QS and CPC lookup tables are not from Google.';

export function FixList({ rows, slug, binding }: { rows: FixItem[]; slug: string; binding: Component | null }) {
  const opening: FixChip = binding && rows.some(r => r.component === binding) ? binding : 'all';
  const [chip, setChip] = useState<FixChip>(opening);
  // Phones: short headers so ad group, component and cost fit one screen.
  const phone = useIsPhone();
  const counts = useMemo(() => Object.fromEntries(FIX_CHIPS.map(c => [c.value, c.value === 'all' ? rows.length : rows.filter(r => r.component === c.value).length])), [rows]);
  const visible = useMemo(() => (chip === 'all' ? rows : rows.filter(r => r.component === chip)), [rows, chip]);
  if (!rows.length) return null;
  const rank = new Map(visible.map((r, i) => [r.key, i + 1]));
  const columns: Column<FixItem>[] = [
    // Phones keep ad group, component and cost at stake.
    { key: 'rank', label: '#', numeric: true, mobileHidden: true, render: r => <span className="text-muted">{rank.get(r.key)}</span>, sortValue: r => rank.get(r.key) ?? 0 },
    { key: 'adGroup', label: 'Ad group', render: r => (
      <div className="min-w-[9rem] max-w-[15rem] max-sm:min-w-0 max-sm:max-w-[9.5rem]">
        <div className="truncate font-medium" title={r.adGroup}>{r.adGroup}</div>
        <div className="truncate text-xs text-muted" title={r.campaign}>{r.campaign}</div>
      </div>
    ), sortValue: r => r.adGroup, csv: r => r.adGroup },
    { key: 'component', label: phone ? 'Component' : 'Below average', render: r => (
      <span className="qs-pill" data-bucket={2}>{COMPONENT_NAMES[r.component]}</span>
    ), sortValue: r => r.component, csv: r => COMPONENT_NAMES[r.component] },
    { key: 'cost', label: phone ? 'Cost' : 'Cost at stake', numeric: true, render: r => <span className="font-medium">{fmtCurrency(r.cost)}</span>, sortValue: r => r.cost, csv: r => r.cost.toFixed(2) },
    { key: 'impressions', label: 'Impressions', numeric: true, mobileHidden: true, render: r => fmtNumber(r.impressions), sortValue: r => r.impressions, csv: r => r.impressions },
    { key: 'share', label: 'Group share', numeric: true, mobileHidden: true, render: r => fmtPercent(r.share, 0), sortValue: r => r.share, csv: r => r.share?.toFixed(4) ?? '' },
    { key: 'keywords', label: 'Keywords', numeric: true, mobileHidden: true, render: r => fmtNumber(r.keywords), sortValue: r => r.keywords, csv: r => r.keywords },
    { key: 'value', label: 'Revenue', numeric: true, mobileHidden: true, render: r => fmtCurrency(r.conversions_value), sortValue: r => r.conversions_value, csv: r => r.conversions_value.toFixed(2) },
  ];
  return (
    <Card heading={(
      <div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-2"><h2 className="text-base font-semibold tracking-tight">Where to start</h2><InfoTip label="Where to start" text={FIX_INFO} /></span>
          <div className="flex flex-wrap items-center gap-1.5">
            {FIX_CHIPS.map(c => (
              <button key={c.value} type="button" className="btn-chip" data-active={chip === c.value} disabled={counts[c.value] === 0} onClick={() => setChip(c.value)}>
                {c.label}{binding === c.value && ' (binding)'} <span className="num ml-1 text-[11px] opacity-70">{fmtNumber(counts[c.value] ?? 0)}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">By ad group and component, sorted by the cost where that component scored below average.</p>
      </div>
    )}>
      <DataTable rows={visible} columns={columns} rowKey={r => r.key} defaultSort={{ key: 'cost', direction: 'desc' }} csvName={`${slug}-qs-where-to-start`} storageKey="qs-where-to-start" maxRows={10} />
    </Card>
  );
}

const QS_INFO = 'Quality Score per keyword per day, weighted by impressions: how often a score counted. The three components (expected CTR, ad relevance and landing page experience) are shown as the share of impressions rated below average. Search keywords only: Shopping and PMax have no Quality Score.';

export function QualityTrend({ points, grain }: { points: QualityPoint[]; grain: 'day' | 'week' }) {
  const phone = useIsPhone();
  return (
    <Card heading={(
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold tracking-tight">Trend</h2>
        <InfoTip label="Quality Score" text={QS_INFO} />
        <span className="text-sm text-muted">weighted QS (left) and below-average share per component (right)</span>
      </div>
    )}>
      <TrendChart data={points as unknown as Record<string, unknown>[]} grain={grain} height={phone ? 220 : 280} series={[
        { key: 'qs', metric: 'roas', label: 'Weighted QS', color: 'var(--series-1)', type: 'line', axis: 'left', strokeWidth: 2.5, format: fmtQs },
        { key: 'expected_ctr', metric: 'ctr', label: belowLabel('expected_ctr'), color: 'var(--bucket-traffic)', type: 'line', axis: 'right', dashed: true },
        { key: 'ad_relevance', metric: 'ctr', label: belowLabel('ad_relevance'), color: 'var(--bucket-creative)', type: 'line', axis: 'right', dashed: true },
        { key: 'landing_page', metric: 'ctr', label: belowLabel('landing_page'), color: 'var(--bucket-conversion)', type: 'line', axis: 'right', dashed: true },
      ]} />
    </Card>
  );
}

export function QualityDistribution({ bars }: { bars: DistributionBar[] }) {
  const data = bars.map(b => ({ period: String(b.qs), share: b.share, cost: b.cost }));
  // Lower on phones.
  const phone = useIsPhone();
  return (
    <Card title="Distribution" subtitle="Share of impressions per Quality Score (1 to 10), with cost.">
      <TrendChart data={data} grain="day" height={phone ? 220 : 280} series={[
        { key: 'share', metric: 'ctr', label: 'Share of impressions', color: 'var(--series-1)', type: 'bar', axis: 'left', format: v => fmtPercent(v, 0) },
        { key: 'cost', metric: 'cost', label: 'Cost', color: 'var(--series-2)', type: 'line', axis: 'right' },
      ]} />
    </Card>
  );
}

const componentColumns = <T extends QualityStats>(): Column<T>[] => COMPONENTS.map((c: Component) => ({
  key: `below_${c}`, label: belowLabel(c), numeric: true, mobileHidden: true,
  render: (r: T) => fmtPercent(r.components[c].below, 0), sortValue: (r: T) => r.components[c].below, csv: (r: T) => r.components[c].below?.toFixed(4) ?? '',
}));

// Phones keep only Cost, the default sort of both tables.
const trafficColumns = <T extends QualityStats>(): Column<T>[] => [
  { key: 'impressions', label: 'Impressions', numeric: true, mobileHidden: true, render: r => fmtNumber(r.impressions), sortValue: r => r.impressions, csv: r => r.impressions },
  { key: 'clicks', label: 'Clicks', numeric: true, mobileHidden: true, render: r => fmtNumber(r.clicks), sortValue: r => r.clicks, csv: r => r.clicks },
  { key: 'ctr', label: 'CTR', numeric: true, mobileHidden: true, render: r => fmtPercent(r.ctr, 2), sortValue: r => r.ctr, csv: r => r.ctr?.toFixed(4) ?? '' },
  { key: 'cost', label: 'Cost', numeric: true, render: r => fmtCurrency(r.cost), sortValue: r => r.cost, csv: r => r.cost.toFixed(2) },
  { key: 'cpc', label: 'CPC', numeric: true, mobileHidden: true, render: r => fmtCurrency(r.cpc, 2), sortValue: r => r.cpc, csv: r => r.cpc?.toFixed(2) ?? '' },
];

const qsCell = (v: number | null) => <span className="font-medium" style={{ color: qsTone(v) }}>{fmtQs(v)}</span>;

// Campaigns and ad groups in one card with a switch, like
// "What explains the change" on Trends. Opens on ad groups: that is where QS is fixed.
type GroupLevel = 'adGroups' | 'campaigns';

export function GroupsCard({ campaigns, adGroups, slug }: { campaigns: GroupStats[]; adGroups: GroupStats[]; slug: string }) {
  const [level, setLevel] = useState<GroupLevel>('adGroups');
  const withCampaign = level === 'adGroups';
  const phone = useIsPhone();
  const columns = groupColumns(withCampaign, phone);
  const name = withCampaign ? 'ad-groups' : 'campaigns';
  return (
    <Card
      heading={(
        <div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-base font-semibold tracking-tight">By {withCampaign ? 'ad group' : 'campaign'}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className="btn-chip" data-active={level === 'adGroups'} onClick={() => setLevel('adGroups')}>Ad groups</button>
              <button type="button" className="btn-chip" data-active={level === 'campaigns'} onClick={() => setLevel('campaigns')}>Campaigns</button>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted">Sorted by cost; shares weighted by impressions.</p>
        </div>
      )}>
      <DataTable key={level} rows={withCampaign ? adGroups : campaigns} columns={columns} rowKey={r => r.key} defaultSort={{ key: 'cost', direction: 'desc' }}
        csvName={`${slug}-qs-${name}`} storageKey={`qs-${name}`} maxRows={15} />
    </Card>
  );
}

// Phones get short headers ("QS", "QS 1-5") so four columns fit.
function groupColumns(withCampaign: boolean, phone = false): Column<GroupStats>[] {
  return [
    { key: 'name', label: withCampaign ? 'Ad group' : 'Campaign', render: r => (
      <div className="min-w-[12rem] max-w-[24rem] max-sm:min-w-0 max-sm:max-w-[9.5rem]">
        <div className="truncate font-medium" title={r.name}>{r.name}</div>
        {withCampaign && <div className="truncate text-xs text-muted" title={r.campaign}>{r.campaign}</div>}
      </div>
    ), sortValue: r => r.name, csv: r => r.name },
    { key: 'keywords', label: 'Keywords', numeric: true, mobileHidden: true, render: r => fmtNumber(r.keywords), sortValue: r => r.keywords, csv: r => r.keywords },
    { key: 'qs', label: phone ? 'QS' : 'Weighted QS', numeric: true, render: r => qsCell(r.weightedQs), sortValue: r => r.weightedQs, csv: r => r.weightedQs ?? '' },
    { key: 'low', label: phone ? 'QS 1-5' : 'QS 5 or lower', numeric: true, render: r => fmtPercent(r.lowShare, 0), sortValue: r => r.lowShare, csv: r => r.lowShare?.toFixed(4) ?? '' },
    ...componentColumns<GroupStats>(),
    ...trafficColumns<GroupStats>(),
  ];
}

type KeywordChip = 'all' | 'low' | Component;
const CHIPS: { value: KeywordChip; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'low', label: 'QS 5 or lower' },
  ...COMPONENTS.map(c => ({ value: c, label: belowLabel(c) })),
];

const matches = (k: KeywordStats, chip: KeywordChip) => {
  if (chip === 'all') return true;
  if (!k.latest) return false;
  if (chip === 'low') return k.latest.qs !== null && k.latest.qs <= 5;
  return k.latest[chip] === 2;
};

export function KeywordTable({ rows, slug }: { rows: KeywordStats[]; slug: string }) {
  const [chip, setChip] = useState<KeywordChip>('all');
  const [query, setQuery] = useState('');
  const counts = useMemo(() => Object.fromEntries(CHIPS.map(c => [c.value, rows.filter(k => matches(k, c.value)).length])), [rows]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(k => matches(k, chip) && (!q || k.keyword.toLowerCase().includes(q) || k.ad_group.toLowerCase().includes(q) || k.campaign.toLowerCase().includes(q)));
  }, [rows, chip, query]);
  const columns: Column<KeywordStats>[] = [
    { key: 'keyword', label: 'Keyword', render: r => (
      <div className="min-w-[14rem] max-w-[24rem] max-sm:min-w-0 max-sm:max-w-[9.5rem]">
        <div className="truncate font-medium" title={r.keyword}>{r.keyword}{r.match_type && <span className="ml-1.5 text-[11px] font-normal text-muted">{r.match_type.toLowerCase()}</span>}</div>
        <div className="truncate text-xs text-muted" title={`${r.campaign} / ${r.ad_group}`}>{r.campaign} / {r.ad_group}</div>
      </div>
    ), sortValue: r => r.keyword, csv: r => r.keyword },
    { key: 'qs', label: 'QS', numeric: true, render: r => (
      <div className="leading-tight">
        {qsCell(r.latest?.qs ?? null)}
        <div className="text-[11px] text-muted" title="Weighted average in the period">avg. {fmtQs(r.weightedQs)}</div>
      </div>
    ), sortValue: r => r.latest?.qs ?? null, csv: r => r.latest?.qs ?? '' },
    ...COMPONENTS.map((c: Component): Column<KeywordStats> => ({
      key: c, label: COMPONENT_NAMES[c], mobileHidden: true, render: r => <BucketPill value={r.latest?.[c] ?? null} />, sortValue: r => r.latest?.[c] ?? null, csv: r => r.latest?.[c] ?? '',
    })),
    ...trafficColumns<KeywordStats>(),
    { key: 'conversions', label: 'Purchases', numeric: true, mobileHidden: true, render: r => fmtNumber(r.conversions, 1), sortValue: r => r.conversions, csv: r => r.conversions },
  ];
  return (
    <Card
      heading={(
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-1.5">
            <h2 className="text-base font-semibold tracking-tight">Keywords</h2>
            <InfoTip label="Keywords" text="QS and components from the last day with impressions in the period (where the keyword stands now), with the weighted average for the period below it. The filters look at that latest state." />
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {CHIPS.map(c => (
              <button key={c.value} type="button" className="btn-chip" data-active={chip === c.value} onClick={() => setChip(c.value)}>
                {c.label} <span className="num ml-1 text-[11px] opacity-70">{fmtNumber(counts[c.value] ?? 0)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      actions={<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search keyword or group" aria-label="Search keywords" className="w-56 text-sm max-sm:w-full" />}>
      {visible.length === 0
        ? <p className="text-sm text-muted">No keywords match this filter.</p>
        : <DataTable rows={visible} columns={columns} rowKey={r => r.key} defaultSort={{ key: 'cost', direction: 'desc' }} csvName={`${slug}-qs-keywords`} storageKey="qs-keywords" maxRows={25} />}
    </Card>
  );
}
