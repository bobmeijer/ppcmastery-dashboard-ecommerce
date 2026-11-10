'use client';

// Tiny markdown-to-React renderer for meeting summaries. Parsing lives in
// meetingsShaping.ts (pure, tested); this file only maps blocks to elements.
import { Fragment } from 'react';
import { Block, InlineNode, parseInline } from '@/lib/meetingsShaping';

export function Inline({ text }: { text: string }) {
  return <>{renderInline(parseInline(text))}</>;
}

function renderInline(nodes: InlineNode[]): React.ReactNode[] {
  return nodes.map((node, i) => {
    if (node.type === 'text') return <Fragment key={i}>{node.text}</Fragment>;
    if (node.type === 'bold') return <strong key={i} className="font-semibold text-ink">{renderInline(node.children)}</strong>;
    return <em key={i}>{renderInline(node.children)}</em>;
  });
}

export function Blocks({ blocks, compact = false }: { blocks: Block[]; compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          if (block.level <= 2) return <h3 key={i} className="eyebrow pt-2">{block.text}</h3>;
          return <h4 key={i} className="pt-1 text-sm font-semibold tracking-tight">{block.text}</h4>;
        }
        if (block.type === 'paragraph') return <p key={i} className="text-sm leading-relaxed text-ink-soft"><Inline text={block.text} /></p>;
        return (
          <ul key={i} className="space-y-1.5">
            {block.items.map((item, j) => (
              <li key={j} className="flex gap-2 text-sm leading-relaxed text-ink-soft" style={{ paddingLeft: `${item.depth * 1.1}rem` }}>
                <span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full" style={{ background: item.depth ? 'var(--gray-400)' : 'var(--ink)' }} />
                <span><Inline text={item.text} /></span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
