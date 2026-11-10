'use client';

// Feed status: Merchant Center eligibility per label plus the blocked-item work list for the client.
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Notice } from '@/components/Card';
import { FeedSkeleton } from '@/components/PageSkeletons';
import { useSetFreshness } from '@/components/FreshnessContext';
import { useFeedReport } from '@/hooks/useFeed';
import { isStale, snapshotAgeDays } from '@/lib/feedShaping';
import { fmtNumber } from '@/lib/metrics';
import { FeedTiles } from '@/components/pages/feed/FeedTiles';
import { IssuesTable } from '@/components/pages/feed/IssuesTable';
import { BlockedItems } from '@/components/pages/feed/BlockedItems';
import { AuditScores } from '@/components/pages/feed/AuditScores';
import { formatDate } from '@/components/pages/feed/shared';

export default function FeedPage() {
  const { data, error, loading } = useFeedReport();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const [issue, setIssue] = useState<string | null>(null);
  const snapshot = data?.snapshot ?? null;
  useSetFreshness(snapshot?.snapshotDate ?? null);

  const selectIssue = (code: string | null) => {
    setIssue(code);
    if (code) document.getElementById('feed-worklist')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-[var(--page-gap)]">
      {error && <Notice tone="bad">Feed status could not be loaded: {error}</Notice>}
      {loading && !data && <FeedSkeleton />}
      {snapshot && snapshot.totals.itemsInFeed === 0 && <Notice tone="warn">No feed data for this label yet.</Notice>}
      {snapshot && snapshot.totals.itemsInFeed > 0 && (
        <>
          {isStale(snapshot.snapshotDate) && (
            <Notice tone="warn">
              Snapshot from {formatDate(snapshot.snapshotDate)} ({fmtNumber(snapshotAgeDays(snapshot.snapshotDate))} days old). The daily Merchant sync refreshes this automatically once it is running.
            </Notice>
          )}
          <FeedTiles snapshot={snapshot} />
          <IssuesTable snapshot={snapshot} onSelectIssue={selectIssue} />
          <div id="feed-worklist" className="scroll-mt-20">
            <BlockedItems snapshot={snapshot} issue={issue} onIssueChange={setIssue} />
          </div>
          {isAdmin && snapshot.audit && <AuditScores audit={snapshot.audit} />}
        </>
      )}
    </div>
  );
}
