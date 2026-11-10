'use client';

import { Card } from '@/components/Card';
import { RollingNumber } from '@/components/RollingNumber';
import { Spark } from '@/components/overview/shared';
import { fmtNumber, fmtPercent } from '@/lib/metrics';
import { BLOCKED_SHARE_ALARM, FeedSnapshot, summarize } from '@/lib/feedShaping';
import { formatDate } from './shared';

// Same anatomy as StatCard (eyebrow, big number, one line of context) for counts that are not a
// MetricKey. Folds into StatCard once it accepts plain counts.
function CountTile({ label, value, sub, tone, title }: { label: string; value: number; sub?: string; tone?: 'bad' | null; title?: string }) {
  return (
    <div className="card p-4" data-state={tone || undefined} title={title}>
      <div className="eyebrow">{label}</div>
      <div className="num kpi-value mt-2 font-semibold tracking-tight" style={tone ? { color: 'var(--bad)' } : undefined}><RollingNumber text={fmtNumber(value)} /></div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function TrendPlaceholder({ snapshot }: { snapshot: FeedSnapshot }) {
  const history = snapshot.history;
  if (history.length > 1) {
    return (
      <div>
        <Spark values={history.map(h => h.blocked)} width={260} height={40} color="var(--bad)" />
        <div className="mt-1 text-xs text-muted">Blocked items per day, last {history.length} days</div>
      </div>
    );
  }
  return (
    <div>
      <svg width={260} height={40} viewBox="0 0 260 40" className="max-w-full" aria-hidden="true">
        <line x1="0" y1="30" x2="260" y2="30" stroke="var(--gray-300)" strokeDasharray="3 4" />
        <circle cx="256" cy="30" r="3" fill="var(--ink)" />
      </svg>
      <div className="mt-1 text-xs text-muted">Trend coming: the daily Merchant link builds history from the first sync (currently 1 data point).</div>
    </div>
  );
}

export function FeedTiles({ snapshot }: { snapshot: FeedSnapshot }) {
  const s = summarize(snapshot);
  const t = snapshot.totals;
  return (
    <div className="space-y-[var(--page-gap)]">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CountTile label="Items in feed" value={s.itemsInFeed}
          sub={`Merchant Center: ${fmtNumber(t.merchantProducts)} products`} title="Products Google Ads knows for this Merchant account" />
        <CountTile label="Eligible" value={s.eligible}
          sub={s.eligibleShare === null ? undefined : `${fmtPercent(s.eligibleShare, 1)} of the feed`} />
        <CountTile label="Blocked" value={s.blocked} tone={s.blockedAlarm ? 'bad' : null}
          sub={s.blockedShare === null ? undefined : `${fmtPercent(s.blockedShare, 1)} of the feed, limit ${fmtPercent(BLOCKED_SHARE_ALARM, 0)}`}
          title="Items Google Ads is not showing in Shopping now" />
        <CountTile label="Pending" value={s.pending} sub="Awaiting review by Google" />
      </div>
      {/* grid-cols-1 is minmax(0, 1fr): the destination table can no longer stretch the column past a phone screen. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Trend" subtitle={`Snapshot from ${formatDate(snapshot.snapshotDate)}`}>
          <TrendPlaceholder snapshot={snapshot} />
        </Card>
        <Card title="By destination" subtitle="Merchant Center product status per channel (NL)">
          {snapshot.byDestination.length === 0 ? <p className="text-sm text-muted">No destinations in this snapshot.</p> : (
            <div className="table-scroll overflow-x-auto">
            <table className="data">
              <thead><tr><th>Destination</th><th className="num">Active</th><th className="num"><span className="sm:hidden">Waiting</span><span className="max-sm:hidden">Pending</span></th><th className="num">Disapproved</th></tr></thead>
              <tbody>
                {snapshot.byDestination.map(d => (
                  <tr key={d.destination}>
                    <td>{d.label}</td>
                    <td className="num">{fmtNumber(d.active)}</td>
                    <td className="num">{fmtNumber(d.pending)}</td>
                    <td className="num" style={d.disapproved > 0 ? { color: 'var(--bad)' } : undefined}>{fmtNumber(d.disapproved)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
