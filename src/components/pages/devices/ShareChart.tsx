'use client';

// 100% stacked cost share per device, on the shared TrendChart (stacked bars,
// clickable legend). The shares are fractions, so the series use a percent-formatted
// metric key ('ctr') for the axis and tooltip formatting.
import { TrendChart, Series } from '@/components/TrendChart';
import type { DeviceDefinition, DevicePoint } from '@/lib/devicesShaping';

interface Props {
  data: DevicePoint[];
  devices: DeviceDefinition[];
  grain: 'day' | 'week' | 'month';
  lagFrom?: string | null;
  height?: number;
}

export function ShareChart({ data, devices, grain, lagFrom, height = 280 }: Props) {
  const series: Series[] = devices.map(d => ({ key: d.key, metric: 'ctr', label: d.label, color: d.color, type: 'bar', axis: 'left', stack: 'share' }));
  // Shares add up to 100%: the axis stops there.
  return <TrendChart data={data} series={series} grain={grain} height={height} lagFrom={lagFrom} leftMax={1} />;
}
