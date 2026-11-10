'use client';

import { Card } from '@/components/Card';
import { FeedAudit, scoreTone } from '@/lib/feedShaping';
import { formatDate } from './shared';

const toneColor = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', none: 'var(--gray-400)' } as const;

function ScoreChip({ label, score, hint }: { label: string; score: number | null; hint?: string }) {
  const tone = scoreTone(score);
  return (
    <div className="inline-flex items-baseline gap-2 rounded-[8px] border border-line px-3 py-1.5" title={hint}>
      <span className="text-sm">{label}</span>
      <span className="num text-base font-semibold" style={{ color: toneColor[tone] }}>{score === null ? '-' : score}</span>
    </div>
  );
}

// Admin-only (SPEC: audit scores sit in the admin layer); the API already strips `audit` for clients.
export function AuditScores({ audit }: { audit: FeedAudit }) {
  const date = audit.generatedAt ? formatDate(audit.generatedAt) : null;
  return (
    <Card title="What the audit says" subtitle={`Feed audit module scores 0-100${date ? `, run on ${date}` : ''}. Visible to admins only.`}>
      <div className="flex flex-wrap gap-2">
        <ScoreChip label="Total" score={audit.combined} hint="Weighted score across the five modules" />
        {audit.modules.map(m => <ScoreChip key={m.id} label={m.label} score={m.score} hint={`Weight ${m.weight}%`} />)}
      </div>
    </Card>
  );
}
