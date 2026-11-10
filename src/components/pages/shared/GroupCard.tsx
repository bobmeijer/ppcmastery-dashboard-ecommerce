'use client';

// One table card as used on Networks, Campaigns and Categories: title and
// controls only (no subtitles), the table with comparison mode, and the Trend block
// the reader opens on demand.
import { useState } from 'react';
import { Card } from '@/components/Card';
import { DataTable, Column } from '@/components/DataTable';
import { GroupTrend, GroupTrendProps } from './GroupTrend';
import type { MetricRow } from './metricColumns';

interface Props<T extends MetricRow> {
  title: string;
  note?: React.ReactNode;          // short header text, e.g. the cost share
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  footer?: T;
  storageKey: string;
  compareLabel?: string;           // '' or undefined = no comparison
  maxRows?: number;
  trend?: GroupTrendProps | null;  // null = no Trend block
  actions?: React.ReactNode;
  children?: React.ReactNode;      // rendered under the table (drill-down)
}

export function GroupCard<T extends MetricRow>({ title, note, rows, columns, rowKey, footer, storageKey, compareLabel, maxRows, trend, actions, children }: Props<T>) {
  const [showTrend, setShowTrend] = useState(false);
  return (
    <Card title={title} actions={(
      <>
        {note && <span className="num text-sm text-muted">{note}</span>}
        {actions}
        {trend && (
          <button type="button" className="btn-chip" data-active={showTrend} aria-expanded={showTrend} onClick={() => setShowTrend(v => !v)}>
            {/* Phones: one word, so the header controls fit one row. */}
            <span className="max-sm:hidden">{showTrend ? 'Hide trend' : 'Show trend'}</span><span className="sm:hidden">Trend</span>
          </button>
        )}
      </>
    )}>
      <DataTable rows={rows} columns={columns} rowKey={rowKey} defaultSort={{ key: 'cost', direction: 'desc' }} storageKey={storageKey}
        footer={footer} maxRows={maxRows} compareLabel={compareLabel || undefined} />
      {children}
      {trend && showTrend && <GroupTrend {...trend} />}
    </Card>
  );
}
