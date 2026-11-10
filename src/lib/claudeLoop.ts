// The tool loop shared by the AI analysis (Opus 5.5) and the chat (Sonnet 5.5): Claude
// calls the read-only data tools until it returns JSON in the given schema. Collects
// every tool result as the corpus the number check runs against, and keeps one monthly
// spend total per dashboard against the cap.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { runTool, TOOL_STEP, toolDefinitions, type ToolContext } from './insightTools';
import { getSupabaseAdmin } from './supabaseAdmin';
import { citeResult, type ToolCall } from './insightSources';
import { DEMO_MODE } from './demoMode';

// USD per token, list prices; cache writes at the 5-minute rate.
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4e-6, output: 20e-6, cacheRead: 0.4e-6, cacheWrite: 5e-6 },
  'claude-opus-5-5:fast': { input: 8e-6, output: 40e-6, cacheRead: 0.8e-6, cacheWrite: 10e-6 },   // fast mode, 2x
  'claude-sonnet-5-5': { input: 2e-6, output: 10e-6, cacheRead: 0.2e-6, cacheWrite: 2.5e-6 },
};
const MONTHLY_CAP_USD = 55;

// Spend per month lives in ai_spend (migration 0008): every function instance on Vercel
// sees the same total, so the cap holds. Each turn first reserves TURN_RESERVE_USD in one
// locked statement (migration 0022) and the run settles the real cost at the end, so
// parallel runs at the cap boundary cannot all pass the check and overspend together.
const monthKey = () => new Date().toISOString().slice(0, 7);
// Upper estimate of one turn: 16k output tokens plus a large prompt at the fast-mode price.
const TURN_RESERVE_USD = 1.25;
// A read error counts as "cap reached", never as zero spent.
export async function monthSpendUsd(): Promise<number> {
  const { data, error } = await getSupabaseAdmin().from('ai_spend').select('usd').eq('month', monthKey()).maybeSingle();
  if (error) { console.error(`claude loop: spend not readable: ${error.message}`); return MONTHLY_CAP_USD; }
  return Number((data as { usd: number } | null)?.usd ?? 0);
}
async function reserveSpend(usd: number): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc('reserve_ai_spend', { p_month: monthKey(), p_usd: usd, p_cap: MONTHLY_CAP_USD });
  if (error) { console.error(`claude loop: spend not reserved: ${error.message}`); return false; }
  return data === true;
}
async function settleSpend(delta: number) {
  if (delta === 0) return;
  const { error } = await getSupabaseAdmin().rpc('settle_ai_spend', { p_month: monthKey(), p_delta: delta });
  if (error) console.error(`claude loop: spend not settled: ${error.message}`);
}

let client: Anthropic | null = null;
function anthropic() {
  // A key that is not scoped to a workspace needs the workspace id on every request.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  client ??= new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {});
  return client;
}

export interface LoopInput {
  model: 'claude-opus-5-5' | 'claude-sonnet-5-5';
  effort: 'low' | 'medium' | 'high';
  system: string;
  schema?: Record<string, unknown>;              // JSON answer in this schema; without it a plain-text answer
  onText?: (delta: string) => void;              // streams the answer text as it is written
  onReset?: () => void;                          // streamed text turned out to precede a tool call: discard it
  fast?: boolean;                                // Opus fast mode: same model, up to 2.5x faster, 2x price
  messages: Anthropic.Beta.BetaMessageParam[];   // appended to in place
  ctx: ToolContext;
  maxTurns: number;
  onStep?: (label: string) => void;
  cite?: boolean;                                // number every tool result ([T3], [T3.2]) so the answer can cite it
}

export interface LoopUsage { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
export interface LoopResult<T> { parsed: T | null; corpus: string; calls: ToolCall[]; costUsd: number; model: string | null; usage: LoopUsage; turns: number }

export async function runToolLoop<T>({ model, effort, system, schema, messages, ctx, maxTurns, onStep, onText, onReset, fast = false, cite = false }: LoopInput): Promise<LoopResult<T>> {
  let corpus = '';
  const calls: ToolCall[] = [];   // in call order: calls[n - 1] is T<n>
  let cost = 0;
  let served: string | null = null;
  let turns = 0;
  const usage: LoopUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const done = (parsed: T | null): LoopResult<T> => ({ parsed, corpus, calls, costUsd: cost, model: served, usage, turns });
  // Fast mode drops back to standard speed for the rest of the run when it is rate
  // limited or not accepted, so a busy fast-mode pool never costs the answer.
  let speedFast = fast && model === 'claude-opus-5-5';
  if (!process.env.ANTHROPIC_API_KEY || (DEMO_MODE && process.env.NODE_ENV === 'production')) return done(null);
  let reserved = 0;
  const tools = toolDefinitions(ctx.isAdmin, ctx.platform);
  try {
    for (let turn = 0; turn < maxTurns; turn += 1) {
      if (!(await reserveSpend(TURN_RESERVE_USD))) break;
      reserved += TURN_RESERVE_USD;
      // The last turn has no tools: the model answers with what it found instead of
      // running out of turns while still looking (the chat did that on broad questions).
      const last = turn === maxTurns - 1;
      const params = {
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01', ...(speedFast ? ['fast-mode-2026-02-01'] : [])],
        ...(speedFast ? { speed: 'fast' as const } : {}),
        fallbacks: 'default' as const,
        cache_control: { type: 'ephemeral' as const },
        output_config: { effort, ...(schema ? { format: { type: 'json_schema' as const, schema } } : {}) },
        system,
        tools,
        ...(last ? { tool_choice: { type: 'none' as const } } : {}),
        messages,
      };
      let streamed = false;
      let response: Anthropic.Beta.BetaMessage;
      try {
        if (onText) {
          const stream = anthropic().beta.messages.stream(params);
          stream.on('text', delta => { streamed = true; onText(delta); });
          response = await stream.finalMessage();
        } else {
          response = await anthropic().beta.messages.create(params);
        }
      } catch (error) {
        if (speedFast && !streamed && (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.BadRequestError)) {
          console.error(`claude loop: fast mode unavailable (${error.status}), standard speed`);
          speedFast = false;
          turn -= 1;
          continue;
        }
        throw error;
      }
      const price = PRICES[response.usage.speed === 'fast' ? `${model}:fast` : model] ?? PRICES[model];
      const u = response.usage;
      served = response.model;
      turns += 1;
      usage.input_tokens += u.input_tokens; usage.output_tokens += u.output_tokens;
      usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0; usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
      cost += u.input_tokens * price.input + u.output_tokens * price.output + (u.cache_read_input_tokens ?? 0) * price.cacheRead + (u.cache_creation_input_tokens ?? 0) * price.cacheWrite;
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'tool_use') {
        if (streamed) onReset?.();
        const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        for (const c of uses) onStep?.(TOOL_STEP[c.name] ?? 'Looking further');
        const results = await Promise.all(uses.map(async c => {
          const input = (c.input ?? {}) as Record<string, unknown>;
          const r = await runTool(ctx, c.name, input);
          return { c, input, r };
        }));
        const blocks = results.map(({ c, input, r }) => {
          corpus += `\n${r.text}`;
          calls.push({ name: c.name, input, text: r.text });
          const content = cite && !r.isError ? citeResult(calls.length, c.name, r.text) : r.text;
          return { type: 'tool_result' as const, tool_use_id: c.id, content, is_error: r.isError };
        });
        const wrapUp = turn === maxTurns - 2
          ? [{ type: 'text' as const, text: 'You have looked up enough. Now give your answer with what you found, in the requested format.' }]
          : [];
        messages.push({ role: 'user', content: [...blocks, ...wrapUp] });
        continue;
      }
      if (response.stop_reason !== 'end_turn') { console.error(`claude loop: ${model} stopped with ${response.stop_reason} after ${turn + 1} turns`); break; }
      const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('');
      if (!text) break;
      return done((schema ? JSON.parse(text) : text) as T);
    }
    console.error(`claude loop: ${model} gave no answer within ${maxTurns} turns`);
    return done(null);
  } catch (error) {
    if (error instanceof Anthropic.APIError) console.error(`claude loop: API ${error.status}: ${error.message}`);
    else if (error instanceof SyntaxError) console.error('claude loop: model returned invalid JSON');
    else throw error;
    return done(null);
  } finally {
    await settleSpend(cost - reserved);
  }
}
