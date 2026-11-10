'use client';

// The metric tree as a funnel, top to bottom: the volume chain down the centre as tiles narrowing 100 to 68%,
// the rate between two stages as a pill on the connecting line, and what sits
// beside a stage (Lost IS, CPC + Cost, CPA, ROAS) as side tiles in the same
// type scale. Three bands behind: before the click / the click / after the click.
// Colour = the lever that moves a metric; the legend
// focuses one lever. The tree ends in the two account goals: Conv. value
// (growth) and ROAS (efficiency) carry a goal strip measured like the
// Overview meters, and the contribution panel splits the change of both over
// their factors. No lag labels in the tiles: the badge in the card header covers it.
import { LOCALE } from '@/lib/config';
import { useState } from 'react';
import Link from 'next/link';
import { InfoTip } from '@/components/Badges';
import { clamp01, PeriodGoalViews } from '@/lib/goalsShaping';
import { fmtPercent, formatMetric } from '@/lib/metrics';
import { Bridge, BridgeKey, Contribution, fmtPart, FUNNEL_BANDS, FUNNEL_ROWS, LEVERS, MetricTreeView, TreeBucket, TreeNodeKey, TreeNodeValue } from '@/lib/metricTree';

export const BUCKET_COLOR: Record<TreeBucket, string> = {
  traffic: 'var(--bucket-traffic)', creative: 'var(--bucket-creative)', conversion: 'var(--bucket-conversion)', business: 'var(--bucket-business)', derived: 'var(--gray-400)',
};
// Short labels in pair tiles, so nothing wraps.
const SHORT_LABEL: Partial<Record<TreeNodeKey, string>> = { rank_lost_is: 'Lost IS rank', budget_lost_is: 'Lost IS budget' };
const PART_LABEL: Partial<Record<BridgeKey, string>> = { days: 'Number of days', impressions: 'Impressions', ctr: 'CTR', cvr: 'Conv. rate', aov: 'AOV', cpc: 'CPC' };

const fmt = (n: TreeNodeValue, v: number | null) => formatMetric(n.key, v);
const toneColor = (n: TreeNodeValue) => (n.tone === 'good' ? 'var(--good)' : n.tone === 'bad' ? 'var(--bad)' : 'var(--gray-500)');
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });

export interface GoalLayer {
  views: PeriodGoalViews;
  overviewHref: string;
}

const Dot = ({ bucket }: { bucket: TreeBucket }) => <span className="tree-dot" style={{ background: BUCKET_COLOR[bucket] }} aria-hidden />;

function Delta({ n }: { n: TreeNodeValue }) {
  if (n.change === null) return null;
  return <span className="num tree-delta" style={{ color: toneColor(n) }}>{`${n.change >= 0 ? '+' : ''}${fmtPercent(n.change, 1)}`}</span>;
}

// Thin bar to the goal: the scale runs past the goal so overshoot stays visible, the tick marks the goal.
function GoalStrip({ fraction, scale, status, left, right, note }: { fraction: number; scale: number; status: 'good' | 'bad' | null; left: string; right: string; note: string | null }) {
  const color = status === 'good' ? 'var(--good)' : status === 'bad' ? 'var(--bad)' : 'var(--gray-400)';
  return (
    <div className="tree-goal">
      <div className="tree-goal-track">
        <span className="tree-goal-fill" style={{ width: `${clamp01(fraction / scale) * 100}%`, background: color }} />
        <span className="tree-goal-tick" style={{ left: `${(1 / scale) * 100}%` }} />
      </div>
      <div className="tree-goal-text">
        <span className="num font-medium" style={{ color }}>{left}</span>
        <span className="num text-muted">{right}</span>
      </div>
      {note && <div className="tree-goal-note" title="Complete days only: the last days of the period still fall in the conversion lag, as with the goals on the Overview.">{note}</div>}
    </div>
  );
}

// Label, value, then change and previous on their own line (like the KPI tiles): never wraps.
function Metric({ n, label, tag }: { n: TreeNodeValue; label?: string; tag?: React.ReactNode }) {
  return (
    <>
      <div className="tree-label"><Dot bucket={n.bucket} />{label || n.label}<InfoTip label={n.label} text={n.formula} />{tag}</div>
      <div className="num tree-value">{fmt(n, n.value)}</div>
      <div className="tree-meta">
        <Delta n={n} />
        {n.previous !== null && <span className="num text-muted">previous {fmt(n, n.previous)}</span>}
      </div>
    </>
  );
}

function GoalTag({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="tree-goal-tag" title="To the goals on the Overview">{children}</Link>;
}

function Legend({ focus, pinned, onHover, onPin }: { focus: TreeBucket | null; pinned: TreeBucket | null; onHover: (b: TreeBucket | null) => void; onPin: (b: TreeBucket) => void }) {
  const active = LEVERS.find(l => l.bucket === focus);
  return (
    <div className="tree-legend">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <span className="eyebrow mr-2">Levers</span>
        {LEVERS.map(l => (
          <button key={l.bucket} type="button" className="tree-legend-item" data-active={focus === l.bucket || undefined} aria-pressed={pinned === l.bucket}
            onMouseEnter={() => onHover(l.bucket)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(l.bucket)} onBlur={() => onHover(null)} onClick={() => onPin(l.bucket)}>
            <Dot bucket={l.bucket} />{l.label}
          </button>
        ))}
      </div>
      <p className="tree-legend-text">
        {active ? <><strong className="font-medium" style={{ color: 'var(--ink)' }}>{active.label}.</strong> {active.text}</> : 'The colour shows the lever that moves a metric. Point at a lever to highlight its metrics.'}
      </p>
    </div>
  );
}

function BridgeColumn({ title, bridge, nodes, focus }: { title: string; bridge: Bridge; nodes: Record<TreeNodeKey, TreeNodeValue>; focus: TreeBucket | null }) {
  const max = Math.max(...bridge.parts.map(p => Math.abs(p.amount)), 1e-12);
  const total = bridge.current - bridge.previous;
  const perDay = bridge.parts.some(p => p.key === 'days');
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-semibold">{title}</span>
        <span className="num text-sm">
          <span className="text-muted">{formatMetric(bridge.total, bridge.previous)} to </span>
          {formatMetric(bridge.total, bridge.current)}
          <span className="ml-2 font-semibold" style={{ color: total >= 0 ? 'var(--good)' : 'var(--bad)' }}>{fmtPart(bridge.total, total)}</span>
        </span>
      </div>
      <div className="tree-bridge-rows">
        {bridge.parts.map((p: Contribution) => {
          const bucket: TreeBucket = p.key === 'days' ? 'derived' : nodes[p.key].bucket;
          const width = (Math.abs(p.amount) / max) * 50;
          return (
            <div key={p.key} className="tree-bridge-row" data-dim={(focus && bucket !== focus) || undefined}>
              <span className="tree-label"><Dot bucket={bucket} />{PART_LABEL[p.key]}{p.key === 'impressions' && perDay && <span className="text-muted">per day</span>}{p.key === 'cpc' && <span className="text-muted">(inverted)</span>}</span>
              <span className="num text-xs text-muted text-right">{`${p.change >= 0 ? '+' : ''}${fmtPercent(p.change, 1)}`}</span>
              <span className="tree-bridge-track" aria-hidden>
                <span className="tree-bridge-axis" />
                <span className="tree-bridge-bar" style={{ width: `${width}%`, [p.amount >= 0 ? 'left' : 'right']: '50%', background: p.amount >= 0 ? 'var(--good)' : 'var(--bad)' }} />
              </span>
              <span className="num text-sm font-medium text-right" style={{ color: p.amount >= 0 ? 'var(--good)' : 'var(--bad)' }}>{fmtPart(bridge.total, p.amount)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// One tile per side group; two metrics sit side by side, so it is never taller than its stage.
function SideTile({ nodes, focus, tag, goal }: { nodes: TreeNodeValue[]; focus: TreeBucket | null; tag?: React.ReactNode; goal?: React.ReactNode }) {
  if (!nodes.length) return null;
  return (
    <div className="tree-side" data-pair={nodes.length > 1 || undefined} data-goal={goal ? true : undefined}>
      {nodes.map(n => (
        <div key={n.key} className="tree-side-line" data-dim={(focus && n.bucket !== focus) || undefined}>
          <Metric n={n} label={SHORT_LABEL[n.key]} tag={tag} />
        </div>
      ))}
      {goal}
    </div>
  );
}

export function MetricTree({ tree, revenue, roas, goal }: { tree: MetricTreeView; revenue: Bridge | null; roas: Bridge | null; goal: GoalLayer | null }) {
  const [hover, setHover] = useState<TreeBucket | null>(null);
  const [pinned, setPinned] = useState<TreeBucket | null>(null);
  const focus = hover || pinned;
  const n = Object.fromEntries(tree.nodes.map(x => [x.key, x])) as Record<TreeNodeKey, TreeNodeValue>;
  const dim = (b: TreeBucket) => (focus && b !== focus) || undefined;

  // Goal strips, measured on the complete days like the Overview meters.
  const v = goal?.views;
  // With lag days in the period the goal is measured on fewer days than the tile shows: say so, with the goal's own number.
  const lagged = !!v && v.lagDaysInRange > 0;
  const revenueGoal = v && goal && (
    <GoalStrip fraction={v.revenue.fraction} scale={1.25} status={v.revenue.status}
      left={`${fmtPercent(v.revenue.fraction, 0)} of goal`} right={`goal ${formatMetric('conversions_value', v.revenue.expected)}`}
      note={lagged ? `${formatMetric('conversions_value', v.revenue.actual)} over ${fmtDate(v.window.start)} to ${fmtDate(v.window.end)}` : null} />
  );
  const roasGoal = v && goal && v.roas.actual !== null && (
    <GoalStrip fraction={v.roas.fraction} scale={1.5} status={v.roas.status}
      left={`${fmtPart('roas', v.roas.actual - v.roas.floor)} vs floor`} right={`min. ${formatMetric('roas', v.roas.floor)}`}
      note={lagged ? `${formatMetric('roas', v.roas.actual)} over ${fmtDate(v.window.start)} to ${fmtDate(v.window.end)}` : null} />
  );

  return (
    <div>
      <Legend focus={focus} pinned={pinned} onHover={setHover} onPin={b => setPinned(p => (p === b ? null : b))} />
      <div className="tree-grid">
        {FUNNEL_BANDS.map(b => (
          <div key={b.label} className="tree-band" style={{ gridRow: `${b.from} / ${b.to + 1}` }} aria-hidden />
        ))}
        {FUNNEL_BANDS.map(b => (
          <div key={`l-${b.label}`} className="tree-band-label" style={{ gridRow: b.from }}>{b.label}</div>
        ))}
        {FUNNEL_ROWS.map((r, i) => {
          const row = i + 1;
          const node = n[r.key];
          // Phones: one vertical column. The bands and side
          // columns are hidden; the band name sits where its band starts (.tree-band-tag) and the
          // side metrics move into the stage tile (.tree-stage-side). Both are display: none on desktop.
          const band = FUNNEL_BANDS.find(b => b.from === row);
          const bandTag = band ? <span className="tree-band-tag" aria-hidden>{band.label}</span> : null;
          if (r.kind === 'link') {
            return (
              <div key={r.key} className="tree-link" style={{ gridRow: row }} data-band={band ? true : undefined}>
                {bandTag}
                <span className="tree-link-line" aria-hidden />
                <span className="tree-chip" data-dim={dim(node.bucket)}>
                  <Dot bucket={node.bucket} />
                  <span className="text-muted">{node.key === 'aov' ? 'x AOV' : node.label}</span>
                  <span className="num font-semibold">{fmt(node, node.value)}</span>
                  <Delta n={node} />
                  <InfoTip label={node.label} text={node.formula} />
                </span>
              </div>
            );
          }
          const isRevenue = r.key === 'conversions_value';
          const sideNodes = [...r.left, ...r.right].map(k => n[k]);
          const roasTag = r.right.includes('roas') && goal && roasGoal ? <GoalTag href={goal.overviewHref}>Efficiency goal</GoalTag> : undefined;
          return (
            <div key={r.key} className="contents">
              <div className="tree-cell tree-left" style={{ gridRow: row }}><SideTile nodes={r.left.map(k => n[k])} focus={focus} /></div>
              <div className="tree-cell tree-center" style={{ gridRow: row }}>
                {bandTag}
                <span className="tree-wire" data-hidden={i === 0 || undefined} aria-hidden><span className="tree-wire-head" /></span>
                <div className="tree-stage" data-dim={dim(node.bucket)} data-goal={(isRevenue && revenueGoal) ? true : undefined} style={{ width: `${r.width}%`, ['--tree-w' as string]: r.width }}>
                  <Metric n={node} tag={isRevenue && goal && revenueGoal ? <GoalTag href={goal.overviewHref}>Growth goal</GoalTag> : undefined} />
                  {isRevenue && revenueGoal}
                  {sideNodes.length > 0 && (
                    <div className="tree-stage-side" data-pair={sideNodes.length > 1 || undefined}>
                      {sideNodes.map(s => (
                        <div key={s.key} className="tree-side-line" data-dim={(focus && s.bucket !== focus) || undefined}>
                          <Metric n={s} label={SHORT_LABEL[s.key]} tag={s.key === 'roas' ? roasTag : undefined} />
                        </div>
                      ))}
                      {r.right.includes('roas') && roasGoal}
                    </div>
                  )}
                </div>
                <span className="tree-wire" data-hidden={i === FUNNEL_ROWS.length - 1 || undefined} aria-hidden />
              </div>
              <div className="tree-cell tree-right" style={{ gridRow: row }}>
                <SideTile nodes={r.right.map(k => n[k])} focus={focus}
                  tag={roasTag}
                  goal={r.right.includes('roas') ? roasGoal || undefined : undefined} />
              </div>
            </div>
          );
        })}
      </div>
      {(revenue || roas) && (
        <div className="tree-bridge">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-sm font-semibold">Breakdown of the change</h3>
            <InfoTip label="Breakdown" text="Revenue is exactly impressions x CTR x conversion rate x AOV (for periods of unequal length: number of days x impressions per day x CTR x conversion rate x AOV), and ROAS is exactly conversion rate x AOV divided by CPC. The change is split exactly across those factors (logarithmic mean): the parts add up to the total. This shows where an outcome moves, not why: the biggest contributor is not automatically the constraint." />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2">
            {revenue && <BridgeColumn title="Revenue (growth)" bridge={revenue} nodes={n} focus={focus} />}
            {roas && <BridgeColumn title="ROAS (efficiency)" bridge={roas} nodes={n} focus={focus} />}
          </div>
        </div>
      )}
    </div>
  );
}
