'use client';

import { useEffect, useState } from 'react';
import { AdminTabs } from '@/components/AdminTabs';
import { Card, Notice } from '@/components/Card';
import { StatusSkeleton } from '@/components/PageSkeletons';

interface RunRow {
  source: string; dataset: string; account_id: string | null; status: string; start_date: string | null; end_date: string | null;
  row_count: number | null; duration_ms: number | null; error_message: string | null; started_at: string; completed_at: string | null;
}
interface Coverage { dataset: string; account_id: string; platform: string; first_date: string | null; last_date: string | null; rows: number }
// Secondary table columns are hidden on phones.
const H = 'max-sm:hidden';

interface Unparsed { account_id: string; campaign_id: string; campaign_name: string; channel_type: string; status: string; network: string }

export default function StatusPage() {
  const [data, setData] = useState<{ runs: RunRow[]; unparsed: Unparsed[]; coverage: Coverage[]; now: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sync/status').then(async r => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
      setData(body);
    }).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const age = (iso: string | null) => {
    if (!iso) return '-';
    const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
    return hours < 1 ? `${Math.round(hours * 60)} min` : hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`;
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <AdminTabs />
        <p className="text-sm text-muted">Coverage and latest sync per account and dataset.</p>
      </header>
      {error && <Notice tone="bad">{error}</Notice>}
      {!data && !error && <StatusSkeleton />}
      {data && (
        <>
          {/* Coverage first: after a backfill the latest run is its oldest month,
              which made complete data look stale. */}
          {/* Phones: each table keeps the columns that answer "is the
              data fresh"; the rest is hidden below sm (H = max-sm:hidden). */}
          <Card title="Coverage" subtitle="First and last day with data per dataset, account and platform.">
            <div className="overflow-x-auto">
              <table className="data">
                <thead><tr><th>Dataset</th><th>Account</th><th className={H}>Platform</th><th className={H}>From</th><th>To</th><th className={`num ${H}`}>Rows</th></tr></thead>
                <tbody>
                  {data.coverage.map(c => (
                    <tr key={`${c.dataset}-${c.account_id}-${c.platform}`}>
                      <td>
                        {c.dataset}
                        {/* Phones: no Platform column; Microsoft rows say so under the dataset. */}
                        {c.platform === 'microsoft' && <div className="text-xs text-muted sm:hidden">Microsoft Ads</div>}
                      </td>
                      <td>{c.account_id}</td>
                      <td className={H}>{c.platform === 'microsoft' ? 'Microsoft Ads' : 'Google Ads'}</td>
                      <td className={`num ${H}`}>{c.first_date ?? '-'}</td><td className="num">{c.last_date ?? '-'}</td><td className={`num ${H}`}>{c.rows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Syncs" subtitle="Latest started run per source, dataset and account.">
            <div className="overflow-x-auto">
              <table className="data">
                <thead><tr><th className={H}>Source</th><th>Dataset</th><th>Account</th><th>Status</th><th className={H}>Range</th><th className={`num ${H}`}>Rows</th><th className={`num ${H}`}>Duration</th><th>Age</th><th className={H}>Error</th></tr></thead>
                <tbody>
                  {data.runs.map(run => (
                    <tr key={`${run.source}-${run.dataset}-${run.account_id}`}>
                      <td className={H}>{run.source}</td>
                      {/* Phones: long names (product_monthly) may break after the underscore. */}
                      <td className="max-sm:whitespace-normal">{run.dataset.replace(/_/g, '_\u200b')}</td><td>{run.account_id || '-'}</td>
                      <td style={{ color: run.status === 'complete' ? 'var(--good)' : run.status === 'failed' ? 'var(--bad)' : 'var(--warn)' }}>
                        {run.status}
                        {/* Phones: the error goes under the status, the Error column is hidden. */}
                        {run.error_message && <div className="max-w-[9rem] whitespace-normal break-words text-xs text-muted sm:hidden">{run.error_message}</div>}
                      </td>
                      <td className={`num ${H}`}>{run.start_date && run.end_date ? `${run.start_date} to ${run.end_date}` : '-'}</td>
                      <td className={`num ${H}`}>{run.row_count ?? '-'}</td>
                      <td className={`num ${H}`}>{run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)} s` : '-'}</td>
                      <td>{age(run.completed_at || run.started_at)}</td>
                      <td className={`max-w-[320px] truncate text-xs ${H}`} title={run.error_message || ''}>{run.error_message || ''}</td>
                    </tr>
                  ))}
                  {data.runs.length === 0 && <tr><td colSpan={9} className="text-muted">No syncs yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Campaigns without a recognised name" subtitle='These end up in "Other". Add a row to campaign_overrides to assign them.'>
            {data.unparsed.length === 0 ? <Notice>All active campaigns are recognised.</Notice> : (
              <div className="overflow-x-auto">
                <table className="data">
                  <thead><tr><th>Account</th><th>Campaign</th><th className={H}>Type</th><th className={H}>Status</th><th>Network</th></tr></thead>
                  <tbody>
                    {data.unparsed.map(c => (
                      <tr key={`${c.account_id}-${c.campaign_id}`}><td>{c.account_id}</td><td>{c.campaign_name}</td><td className={H}>{c.channel_type}</td><td className={H}>{c.status}</td><td>{c.network}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
