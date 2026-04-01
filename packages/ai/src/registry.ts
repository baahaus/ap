import type { Provider, ProviderConfig, TokenUsage } from './types.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createOpenAIProvider } from './providers/openai.js';

type ProviderFactory = (config: ProviderConfig) => Provider;

const factories = new Map<string, ProviderFactory>([
  ['anthropic', createAnthropicProvider],
  ['openai', createOpenAIProvider],
]);

const instances = new Map<string, Provider>();

export function registerProvider(name: string, factory: ProviderFactory): void {
  factories.set(name, factory);
}

export function getProvider(name: string, config?: ProviderConfig): Provider {
  const cached = instances.get(name);
  if (cached) return cached;

  const factory = factories.get(name);
  if (!factory) {
    throw new Error(`Unknown provider: ${name}. Available: ${[...factories.keys()].join(', ')}`);
  }

  const provider = factory(config || {});
  instances.set(name, provider);
  return provider;
}

export function resolveProvider(model: string): { provider: Provider; model: string } {
  // Check if model has provider prefix (e.g., "anthropic:claude-sonnet-4-20250514")
  if (model.includes(':')) {
    const [providerName, modelName] = model.split(':', 2);
    return { provider: getProvider(providerName), model: modelName };
  }

  // Auto-detect provider from model name
  if (model.startsWith('claude')) {
    return { provider: getProvider('anthropic'), model };
  }
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) {
    return { provider: getProvider('openai'), model };
  }

  throw new Error(`Cannot auto-detect provider for model: ${model}. Use "provider:model" format.`);
}

// Session-level usage tracking
export class UsageTracker {
  private totals: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private calls = 0;

  record(usage: TokenUsage): void {
    this.totals.inputTokens += usage.inputTokens;
    this.totals.outputTokens += usage.outputTokens;
    this.totals.cacheReadTokens = (this.totals.cacheReadTokens || 0) + (usage.cacheReadTokens || 0);
    this.totals.cacheWriteTokens = (this.totals.cacheWriteTokens || 0) + (usage.cacheWriteTokens || 0);
    this.calls++;
  }

  get total(): TokenUsage & { calls: number } {
    return { ...this.totals, calls: this.calls };
  }

  reset(): void {
    this.totals = { inputTokens: 0, outputTokens: 0 };
    this.calls = 0;
  }
}
