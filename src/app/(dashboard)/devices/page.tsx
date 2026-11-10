'use client';

// Devices: device split for one label. Top to bottom: device tiles, cost share
// (100% stacked) plus ROAS per device over time, device x category and device x
// network tables, and (admin only, sent by the route) a factual finding line when
// mobile ROAS is below half of desktop.
import { useMemo } from 'react';
import { Card, Notice } from '@/components/Card';
import { DevicesSkeleton } from '@/components/PageSkeletons';
import { useScope } from '@/components/ScopeContext';
import { TrendChart } from '@/components/TrendChart';
import { useSetFreshness } from '@/components/FreshnessContext';
import { useSetFilterOptions } from '@/components/FilterOptionsContext';
import { compareLabelFor } from '@/hooks/useGroupedReport';
import { applyFilters, filterOptions } from '@/lib/filters';
import { useDeviceReport } from '@/hooks/useDevices';
import { formatMetric } from '@/lib/metrics';
import { activeTarget, lagStart, targetLabel } from '@/lib/reportShaping';
import {
  activeDevices, deviceMatrix, deviceTiles, matrixTotal, mobileDesktopFinding, roasByPeriod, shareByPeriod,
} from '@/lib/devicesShaping';
import { DeviceTiles } from '@/components/pages/devices/DeviceTiles';
import { ShareChart } from '@/components/pages/devices/ShareChart';
import { DeviceMatrix } from '@/components/pages/devices/DeviceMatrix';
import { useIsPhone } from '@/hooks/useIsMobile';

export default function DevicesPage() {
  const { range, compare, lagDays, includeLag, filters } = useScope();
  const { data, error, loading } = useDeviceReport();
  const phone = useIsPhone();
  // Top-bar filters: options from the unfiltered period, applied client-side like the grouped pages.
  const options = useMemo(() => (data ? filterOptions(data.rows) : null), [data]);
  useSetFilterOptions(options, loading && !data ? 'campaigns' : null);

  const view = useMemo(() => {
    if (!data) return null;
    const rows = applyFilters(data.rows, filters);
    const compareRows = applyFilters(data.compareRows, filters);
    const tiles = deviceTiles(rows, compareRows);
    const share = shareByPeriod(rows);
    const single = data.accounts.length === 1 ? data.accounts[0].id : null;
    return {
      tiles,
      devices: activeDevices(rows),
      share,
      roas: roasByPeriod(rows),
      // The target is blended incl. Brand, so it goes when Brand is excluded (as on the grouped pages).
      roasTarget: single && !filters.excludeBrand ? activeTarget(data.targets, single, 'roas', range.end) : null,
      byCategory: deviceMatrix(rows, 'category', compareRows),
      byNetwork: deviceMatrix(rows, 'network', compareRows),
      total: matrixTotal(rows, compareRows),
      empty: rows.length === 0,
      lagFrom: includeLag ? lagStart(share.map(p => p.period), lagDays, data.grain) : null,
      compareLabel: compare === 'year' ? 'vs last year' : compare === 'none' ? '' : 'vs previous period',
      tableCompareLabel: compareLabelFor(compare),
      freshest: Object.values(data.freshness).filter(Boolean).sort().pop() || null,
      // Admin-only line from the same filtered rows as the tiles.
      finding: data.role === 'admin' ? mobileDesktopFinding(tiles) : null,
    };
  }, [data, filters, range.end, lagDays, includeLag, compare]);
  useSetFreshness(view?.freshest ?? null);

  const empty = view ? view.empty : false;
  // Phones show cost and ROAS per cell; CVR stays on wider screens.
  const cellLegend = phone ? 'cost and ROAS' : 'cost, ROAS and CVR';
  const target = view?.roasTarget ? { value: view.roasTarget.value, kind: view.roasTarget.kind, label: targetLabel(view.roasTarget) } : null;

  return (
    <div className="space-y-[var(--page-gap)]">
      {error && <Notice tone="bad">Report could not be loaded: {error}</Notice>}
      {loading && !data && <DevicesSkeleton />}
      {data && empty && <Card><Notice tone="warn">No device data for this period yet.</Notice></Card>}

      {view && data && !empty && (
        <>
          <DeviceTiles tiles={view.tiles} compareLabel={view.compareLabel} roasTarget={target} />

          {/* grid-cols-1 (minmax(0,1fr)) keeps wide children inside the screen; phones get
              lower charts. */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-3" title="Cost share by device" subtitle="Share of cost per period, adding up to 100%">
              <ShareChart height={phone ? 220 : undefined} data={view.share} devices={view.devices} grain={data.grain} lagFrom={view.lagFrom} />
            </Card>
            <Card className="xl:col-span-2" title="ROAS by device">
              <TrendChart data={view.roas} grain={data.grain} height={phone ? 220 : 280} lagFrom={view.lagFrom}
                target={target ? { value: target.value, label: `ROAS ${target.label} ${formatMetric('roas', target.value)}`, axis: 'left' } : null}
                series={view.devices.map(d => ({ key: d.key, metric: 'roas' as const, label: d.label, color: d.color, type: 'line' as const, axis: 'left' as const }))} />
            </Card>
          </div>

          {/* Stacked: with three devices plus total the two matrices did not fit side by side. */}
          <div className="grid grid-cols-1 gap-4">
            <Card title="Category x device"
              subtitle={view.byCategory.length <= 1
                ? `Per cell: ${cellLegend}. One campaign, so one row: product type per device is not in the device data.`
                : `Per cell: ${cellLegend}. Category derived from the campaign names.`}>
              <DeviceMatrix rows={view.byCategory} total={view.total} devices={view.devices} nameLabel="Category" storageKey="device-category"
                compareLabel={view.tableCompareLabel} maxRows={10} />
            </Card>
            <Card title="Network x device" subtitle={`Per cell: ${cellLegend}.`}>
              <DeviceMatrix rows={view.byNetwork} total={view.total} devices={view.devices} nameLabel="Network" storageKey="device-network"
                compareLabel={view.tableCompareLabel} sortByCost={false} />
            </Card>
          </div>

          {view.finding && (
            <Card title="Finding" subtitle="Admin only">
              <p className="text-sm">{view.finding.text}</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
