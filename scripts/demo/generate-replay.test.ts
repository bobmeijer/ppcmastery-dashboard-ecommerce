import { writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { answerChat } from '@/lib/chatRun';
import { SUGGESTED_QUESTIONS } from '@/components/ai/suggestions';
import { ACCOUNTS } from '@/lib/config';
import { getDemoClient, type DemoClient } from '@/lib/demo/fakeClient';
import { replayChatKey } from '@/lib/demo/replay';
import { AGENT_MODEL } from '@/lib/insightAgent';
import { runInsight } from '@/lib/insightRun';
import { readView } from '@/lib/insightView';

// Runs the real AI code on the fictional data and stores the result for demo mode.
// Needs ANTHROPIC_API_KEY and no database settings:
//   ANTHROPIC_API_KEY=... npm run demo:replay
// Only fictional demo data is ever sent. Stops starting runs before the budget is used up.

// Vitest cannot follow the require in supabaseAdmin.ts, so hand it the same fake client.
vi.mock('@/lib/supabaseAdmin', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabaseAdmin')>()),
  getSupabaseAdmin: () => getDemoClient(),
}));

const OUTPUT = 'src/lib/demo/replay.json';
const STOP_AT_USD = 3.75;   // one more run costs less than the rest of the 5 USD budget
const PERIOD = 'start=2026-10-01&end=2026-10-31&compare=previous';

it('generates the replay', async () => {
  expect(process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY is required').toBeTruthy();
  expect(process.env.SUPABASE_SERVICE_ROLE_KEY, 'never run this with database settings').toBeFalsy();
  const store = (getDemoClient() as unknown as DemoClient).store;
  const spent = () => store.spendTotal();
  const accounts: Record<string, { story: unknown; chat: Record<string, string> }> = {};
  const save = () => writeFileSync(OUTPUT, `${JSON.stringify({ generatedFor: new Date().toISOString().slice(0, 10), model: AGENT_MODEL, costUsd: Math.round(spent() * 100) / 100, accounts }, null, 1)}\n`);

  for (const account of ACCOUNTS.slice(0, 2)) {
    if (spent() >= STOP_AT_USD) break;
    const view = await readView(new URLSearchParams(`scope=${account.label}&${PERIOD}`));
    if ('error' in view) throw new Error(view.error);
    const { insight } = await runInsight('overview', view, 'client', { fresh: true });
    console.log(account.label, 'analysis', insight.source, 'spent', spent().toFixed(2));
    expect(insight.source).toBe('ai');
    const entry: { story: unknown; chat: Record<string, string> } = { story: insight.story, chat: {} };
    accounts[account.label] = entry;
    save();
    const analysis = [insight.story.headline, ...insight.story.points.map(p => p.text)].join('\n');
    for (const question of SUGGESTED_QUESTIONS) {
      if (spent() >= STOP_AT_USD) break;
      const result = await answerChat({ view, isAdmin: false, question, history: [], analysis });
      console.log(account.label, 'chat', result.source, 'spent', spent().toFixed(2));
      if (result.source === 'ai') entry.chat[replayChatKey(question)] = result.answer;
      save();
    }
  }
  console.log('total USD', spent().toFixed(2));
});
