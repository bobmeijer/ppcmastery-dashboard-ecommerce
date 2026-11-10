'use client';

// Countries trend: stacked bars (chosen metric per country) plus ROAS lines per country on the right axis.
// Built on the shared TrendChart (stacked bars, right axis, clickable legend).
import { TrendChart, Series } from '@/components/TrendChart';
import { COUNTRY_KEYS, CountryKey, countryName, GeoChartPoint, StackMetric } from '@/lib/geoShaping';

export const COUNTRY_COLORS: Record<CountryKey, string> = { NL: 'var(--series-1)', BE: 'var(--accent)', Other: 'var(--gray-400)' };

interface Props {
  data: GeoChartPoint[];
  metric: StackMetric;
  metricLabel: string;
  grain: 'day' | 'week' | 'month';
  lagFrom?: string | null;
  target?: { value: number; label: string } | null;
  height?: number;
  showOther: boolean;
}

export function GeoChart({ data, metric, metricLabel, grain, lagFrom, target, height = 340, showOther }: Props) {
  const countries = COUNTRY_KEYS.filter(c => c !== 'Other' || showOther);
  // Bars muted so the ROAS lines in the same colours read on top of them.
  const series: Series[] = [
    ...countries.map((code): Series => ({
      key: code, metric, label: `${metricLabel} ${countryName(code)}`, color: COUNTRY_COLORS[code], type: 'bar', axis: 'left', stack: 'country', muted: true,
    })),
    ...countries.map((code): Series => ({
      key: `${code}_roas`, metric: 'roas', label: `ROAS ${countryName(code)}`, color: COUNTRY_COLORS[code], type: 'line', axis: 'right',
    })),
  ];
  return (
    <TrendChart data={data} series={series} grain={grain} height={height} lagFrom={lagFrom}
      target={target ? { ...target, axis: 'right' } : null} />
  );
}
