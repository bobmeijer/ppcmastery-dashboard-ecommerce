import { daysBetween, shiftDatesInText } from './dates';
import data from './replay.json';
import type { DemoWorld } from './world';
import { DEMO_ANCHOR } from './world';

// Pre-generated AI output for demo mode. scripts/generate-demo-replay.test.ts made it by
// running the real AI code on the fictional data. It needs no API key at runtime.

interface ReplayPoint { text: string; type: 'fact' | 'interpretation'; link?: { path: string } }
export interface ReplayStory { headline: string; points: ReplayPoint[] }
interface ReplayEntry { story: ReplayStory; chat: Record<string, string> }
interface ReplayFile { generatedFor: string; model: string | null; costUsd: number; accounts: Record<string, ReplayEntry> }

const replay = data as unknown as ReplayFile;
const anchorYear = Number(DEMO_ANCHOR.slice(0, 4));

export const replayChatKey = (question: string) => question.trim().toLowerCase().replace(/\s+/g, ' ');

export const NO_KEY_MESSAGE = 'This demo uses pre-generated answers, so it can only answer the suggested questions. Connect your own API key to ask anything.';

export function replayStories(world: DemoWorld): Record<string, { story: ReplayStory; model: string | null; generatedAt: string }> {
  const shift = (text: string) => shiftDatesInText(text, world.shift, anchorYear);
  return Object.fromEntries(Object.entries(replay.accounts ?? {}).filter(([, e]) => e.story).map(([label, e]) => [label, {
    story: { headline: shift(e.story.headline), points: e.story.points.map(p => ({ ...p, text: shift(p.text) })) },
    model: replay.model,
    generatedAt: `${world.today}T06:00:00.000Z`,
  }]));
}

export const replayShift = (today = new Date().toISOString().slice(0, 10)) => daysBetween(DEMO_ANCHOR, today);

export function replayAnswer(label: string, question: string, world: { shift: number }): string {
  const answer = replay.accounts?.[label]?.chat?.[replayChatKey(question)];
  return answer ? shiftDatesInText(answer, world.shift, anchorYear) : NO_KEY_MESSAGE;
}
