// Text guards for the AI analysis: the plain wording of a
// computed signal, used when the agent is unavailable, and the check that every number
// the model writes appears in the data it was given.
import type { SignalFact } from './insightSignals';

export interface WrittenSignal { id: string; title: string; detail: string }

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function fallbackSignal(f: SignalFact): WrittenSignal {
  const where = f.subject === 'Account' ? '' : `${f.subject}: `;
  const title = `${where}${f.metric}${f.delta ? ` ${f.delta}` : ` ${f.to}`}`;
  // Without a from value the title carries the delta, so the detail opens with the value itself.
  const parts = [f.from ? `${f.from} to ${f.to}` : f.delta ? f.to : null, f.context ? capital(f.context) : null].filter(Boolean);
  return { id: f.id, title, detail: parts.length ? `${parts.join('. ')}.` : '' };
}

// Every number the model writes must appear in the fact it describes.
// Numbers are en-GB (1,234.56 and €9,489): a comma or point only counts between digits, so
// sentence punctuation after a number never sticks to it. A number in another format
// (3,5 where the data says 3.5) stays one token and is rejected.
// Leading zeros go so a date's "09" also allows "9 September".
const numbers = (s: string) => s.match(/\d+(?:[.,]\d+)*/g)?.map(n => n.replace(/^0+(?=\d)/, '')) ?? [];
// The numbers in the text that the fact does not contain (empty when it passes).
export function foreignNumbers(text: string, f: SignalFact): string[] {
  const source = [f.subject, f.metric, f.from, f.to, f.delta, f.context].filter(Boolean).join(' ');
  const allowed = new Set(numbers(source));
  return numbers(text).filter(n => !allowed.has(n));
}

export function usesOnlyFactNumbers(text: string, f: SignalFact): boolean {
  const source = [f.subject, f.metric, f.from, f.to, f.delta, f.context].filter(Boolean).join(' ');
  const allowed = new Set(numbers(source));
  return numbers(text).every(n => allowed.has(n));
}
