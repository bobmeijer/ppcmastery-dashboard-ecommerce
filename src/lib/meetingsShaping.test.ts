import { describe, expect, it } from 'vitest';
import { ageInDays, executiveBullets, filterActions, headerCounts, inlineToText, nextMeeting, parseInline, parseMarkdown, splitSummary, Action, Communication } from './meetingsShaping';

const GLUED = `# Title

## Summary

## Executive Summary
• **First point** with *italics*.• **Second point:** **Admin** does something; next meeting on **13 April 2026**.
## Full Summary

### Section A
• Line one.• Line two.
`;

const DASHED = `# Title

## Summary

## Executive Summary

- **Point one** about _something_.
- **Next steps:** **Sam** delivers.

## Full Summary

### Section B

- Outer.
    - Inner.
- The next progress meeting is planned on Tuesday 13 October 2026 at 10:00.
`;

describe('parseMarkdown', () => {
  it('splits glued bullet lines into list items', () => {
    const blocks = parseMarkdown(GLUED);
    const lists = blocks.filter(b => b.type === 'list');
    expect(lists).toHaveLength(2);
    expect(lists[0].type === 'list' && lists[0].items.map(i => i.text)).toEqual([
      '**First point** with *italics*.',
      '**Second point:** **Admin** does something; next meeting on **13 April 2026**.',
    ]);
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, text: 'Title' });
  });

  it('keeps nesting depth for dashed bullets', () => {
    const blocks = parseMarkdown(DASHED);
    const last = blocks[blocks.length - 1];
    expect(last.type).toBe('list');
    if (last.type === 'list') {
      expect(last.items[0]).toEqual({ text: 'Outer.', depth: 0 });
      expect(last.items[1]).toEqual({ text: 'Inner.', depth: 1 });
    }
  });
});

describe('parseInline', () => {
  it('parses bold and italic and leaves text intact', () => {
    const nodes = parseInline('**Bold** and *italic* and _also_ and 5 * 3.');
    expect(nodes[0]).toEqual({ type: 'bold', children: [{ type: 'text', text: 'Bold' }] });
    expect(nodes[2]).toEqual({ type: 'italic', children: [{ type: 'text', text: 'italic' }] });
    expect(nodes[4]).toEqual({ type: 'italic', children: [{ type: 'text', text: 'also' }] });
    expect(inlineToText(nodes)).toBe('Bold and italic and also and 5 * 3.');
  });

  it('survives Jamie star runs', () => {
    expect(inlineToText(parseInline('**Launch *****Spring range***** prepared**'))).toContain('Spring range');
  });
});

describe('splitSummary / executiveBullets', () => {
  it('separates the executive summary from the rest and drops the title', () => {
    const { executive, rest } = splitSummary(DASHED);
    expect(executive).toHaveLength(1);
    expect(executiveBullets(DASHED)).toEqual(['**Point one** about _something_.', '**Next steps:** **Sam** delivers.']);
    expect(rest.some(b => b.type === 'heading' && b.level === 1)).toBe(false);
    expect(rest.some(b => b.type === 'heading' && b.text === 'Summary')).toBe(false);
    expect(rest[0]).toEqual({ type: 'heading', level: 2, text: 'Full Summary' });
  });
});

describe('ageInDays', () => {
  it('counts whole days and never goes negative', () => {
    expect(ageInDays('2026-09-14', '2026-10-13')).toBe(29);
    expect(ageInDays('2026-10-13', '2026-10-13')).toBe(0);
    expect(ageInDays('2026-10-14', '2026-10-13')).toBe(0);
    expect(ageInDays('2026-03-16', '2026-10-13')).toBe(211);
  });
});

describe('nextMeeting', () => {
  const meeting = (date: string, md: string): Communication => ({
    id: `meeting:${date}`, kind: 'meeting', title: 't', date, time: '', participants: [], summary_md: '', decisions: [],
    detail_md: md, message_count: 1, labels: ['shopa'], hidden: false,
  });
  it('finds the newest mention with time', () => {
    const next = nextMeeting([meeting('2026-03-16', GLUED), meeting('2026-09-14', DASHED)]);
    expect(next).toEqual({ date: '2026-10-13', time: '10:00', source: 'meeting:2026-09-14' });
  });
  it('returns null when nothing is announced', () => {
    expect(nextMeeting([meeting('2026-01-01', '# x\n\n- nothing')])).toBeNull();
  });
});

describe('board helpers', () => {
  const actions: Action[] = [
    { id: '1', source_id: 'm', title: 'a', owner: 'Admin', due: null, label: 'shopa', status: 'open', created: '2026-09-14' },
    { id: '2', source_id: 'm', title: 'b', owner: 'Sam', due: null, label: 'shopb', status: 'open', created: '2026-09-14' },
    { id: '3', source_id: 'm', title: 'c', owner: 'Demo Group', due: null, label: null, status: 'done', created: '2026-07-06' },
    { id: '4', source_id: 'm', title: 'd', owner: 'Admin', due: null, label: null, status: 'open', created: '2026-07-06' },
  ];
  it('filters by label (untagged shows on both) and tab, open first and oldest first', () => {
    expect(filterActions(actions, 'shopa', 'open').map(a => a.id)).toEqual(['4', '1']);
    expect(filterActions(actions, 'shopb', 'open').map(a => a.id)).toEqual(['4', '2']);
    expect(filterActions(actions, 'shopb', 'done').map(a => a.id)).toEqual(['3']);
    expect(filterActions(actions, 'shopb', 'all').map(a => a.id)).toEqual(['4', '2', '3']);
  });
  it('applies local status overrides and counts per side', () => {
    expect(headerCounts(actions, 'shopa')).toEqual({ admin: 2, client: 0, total: 2 });
    expect(headerCounts(actions, 'shopa', { '1': 'done', '3': 'open' })).toEqual({ admin: 1, client: 1, total: 2 });
  });
});
