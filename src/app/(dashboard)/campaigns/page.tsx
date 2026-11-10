'use client';

// Campaigns: one card per campaign group, no Total card.
// Groups: Branded (every Brand campaign, Search and Shopping: 01 | Brand and
// 05 | Brand), Non-Branded Search, Shopping (Shopping plus PMax: PMax is
// feed-only campaigns), then Display and the rest. Each card: the group's
// campaigns, its revenue share in the header, totals in the footer and the
// Trend block on demand.
import { useMemo } from 'react';
import { Card, Notice } from '@/components/Card';
import { CampaignsSkeleton } from '@/components/PageSkeletons';
import { GroupCard } from '@/components/pages/shared/GroupCard';
import { CampaignName, metricColumns } from '@/components/pages/shared/metricColumns';
import { useGroupedReport } from '@/hooks/useGroupedReport';
import { displayNetwork } from '@/lib/filters';
import { campaignRows, CampaignGroupRow, totalRow } from '@/lib/groupedShaping';
import { FactRow, fmtPercent, withRevenueShare } from '@/lib/metrics';

const byCampaign = (r: FactRow) => r.campaign_name;

// Campaign group for this page (differs from the network split elsewhere).
const GROUP_ORDER = ['Branded', 'Non-Branded Search', 'Non-Branded Shopping', 'Display', 'Demand Gen', 'Video', 'Other'];
const groupOf = (r: { network: string; category: string }): string => {
  if (r.category === 'Brand') return 'Branded';
  if (r.network === 'Shopping' || r.network === 'PMax') return 'Non-Branded Shopping';
  return displayNetwork(r);
};
const sortGroups = (groups: string[]) => [...groups].sort((a, b) => ((GROUP_ORDER.indexOf(a) + 100) % 100) - ((GROUP_ORDER.indexOf(b) + 100) % 100) || a.localeCompare(b));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface NetworkBlock {
  network: string;
  share: number | null;
  rows: CampaignGroupRow[];
  footer: CampaignGroupRow;
  facts: FactRow[];
}

export default function CampaignsPage() {
  const { data, view, error, loading, lagDays, includeLag } = useGroupedReport();

  const page = useMemo(() => {
    if (!view) return null;
    const total = totalRow(view.rows, view.compareRows);
    const campaigns = campaignRows(view.rows, view.compareRows);
    // campaignRows sets network to the display network; Brand campaigns carry category 'Brand'.
    const groupOfCampaign = (c: CampaignGroupRow) => groupOf({ network: c.network.endsWith('Search') ? 'Search' : c.network.endsWith('Shopping') ? 'Shopping' : c.network, category: c.category });
    const networks = sortGroups([...new Set(campaigns.map(groupOfCampaign))]);
    const blocks: NetworkBlock[] = networks.map(network => {
      const facts = view.rows.filter(r => groupOf(r) === network);
      const compareFacts = view.compareRows.filter(r => groupOf(r) === network);
      // Revenue share within the group, so the column sums to 100% per card.
      const own = campaigns.filter(c => groupOfCampaign(c) === network);
      const revenue = own.reduce((acc, c) => acc + c.conversions_value, 0);
      const rows = withRevenueShare(own);
      const networkTotal = totalRow(facts, compareFacts);
      return {
        network, facts, rows,
        share: total.conversions_value > 0 ? revenue / total.conversions_value : null,
        footer: { ...networkTotal, campaign_id: `total-${network}`, network, category: '', status: 'ENABLED' },
      };
    });
    return { total, blocks };
  }, [view]);

  const compare = !!view?.compareLabel;
  const campaignColumns = useMemo(() => metricColumns<CampaignGroupRow>('Campaign', {
    compare, renderName: r => <CampaignName name={r.name} status={r.status} />,
  }), [compare]);

  const empty = !!page && page.blocks.length === 0;

  return (
    <div className="space-y-[var(--page-gap)]">
      {error && <Notice tone="bad">Report could not be loaded: {error}</Notice>}
      {loading && !data && <CampaignsSkeleton />}
      {page && empty && <Card><Notice tone="warn">No data for this period yet.</Notice></Card>}
      {view && page && !empty && (
        <>
          {page.blocks.map(block => (
            <GroupCard key={block.network} title={block.network} note={block.share === null ? undefined : <>{fmtPercent(block.share, 0)}<span className="max-sm:hidden"> of</span> revenue</>}
              rows={block.rows} columns={campaignColumns} rowKey={r => r.campaign_id} footer={block.footer}
              storageKey={`campaigns-${slug(block.network)}`} compareLabel={view.compareLabel}
              trend={{ rows: block.facts, keyOf: byCampaign, grain: view.grain, lagDays, includeLag, roasTarget: view.roasTarget }} />
          ))}
        </>
      )}
    </div>
  );
}
