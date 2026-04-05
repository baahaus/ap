import type { TokenUsage } from './types.js';

type ModelRates = { input: number; output: number; cacheRead?: number };

/**
 * Per-model pricing rates (USD per 1M tokens).
 * Cache reads are discounted at 10% of standard input (Anthropic).
 *
 * Last verified: 2026-04-05
 * Source: https://www.anthropic.com/pricing, https://openai.com/pricing
 */
const pricing: Record<string, ModelRates> = {
  // Anthropic — verified 2026-04-05
  'claude-opus-4-6':          { input: 15,   output: 75,  cacheRead: 1.5  },
  'claude-sonnet-4-6':        { input: 3,    output: 15,  cacheRead: 0.3  },
  'claude-sonnet-4-6-20250610': { input: 3,  output: 15,  cacheRead: 0.3  },
  'claude-sonnet-4':          { input: 3,    output: 15,  cacheRead: 0.3  },
  'claude-sonnet-4-20250514': { input: 3,    output: 15,  cacheRead: 0.3  },
  'claude-haiku-4-5':         { input: 0.8,  output: 4,   cacheRead: 0.08 },
  'claude-haiku-4-5-20251001':{ input: 0.8,  output: 4,   cacheRead: 0.08 },
  // OpenAI — verified 2026-04-05
  'gpt-4o':       { input: 2.5,  output: 10  },
  'gpt-4o-mini':  { input: 0.15, output: 0.6 },
  'o1':           { input: 15,   output: 60  },
  'o1-mini':      { input: 1.1,  output: 4.4 },
  'o3-mini':      { input: 1.1,  output: 4.4 },
  // GPT-5.x (Codex) pricing is not yet publicly available — omitted intentionally.
  // estimateCost() returns null for unknown models; cost is not displayed.
};

/**
 * Normalize a model string for pricing lookup.
 * Strips provider prefixes (e.g. "anthropic:") so callers don't need to.
 */
function normalizeModel(model: string): string {
  return model.includes(':') ? model.split(':', 2)[1] : model;
}

/**
 * Calculate the USD cost for a given model and token usage.
 * Uses static pricing verified at the date above — returns null for unknown models
 * so the caller can omit cost display rather than show a wrong number.
 */
export function estimateCost(
  model: string,
  usage: Pick<TokenUsage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens'>,
): number | null {
  const rates = pricing[normalizeModel(model)];
  if (!rates) return null;

  const inputTokens = usage.inputTokens - (usage.cacheReadTokens || 0);
  const cacheTokens = usage.cacheReadTokens || 0;
  const cacheRate = rates.cacheRead ?? rates.input;

  return (
    inputTokens * rates.input +
    cacheTokens * cacheRate +
    usage.outputTokens * rates.output
  ) / 1_000_000;
}
