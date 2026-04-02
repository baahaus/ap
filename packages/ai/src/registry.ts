import type { Provider, ProviderConfig, TokenUsage } from './types.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createOpenAIProvider } from './providers/openai.js';
import { createCodexProvider } from './providers/codex.js';
import { loadConfig } from './config.js';

type ProviderFactory = (config: ProviderConfig) => Provider;

const factories = new Map<string, ProviderFactory>([
  ['anthropic', createAnthropicProvider],
  ['openai', createOpenAIProvider],
  // ChatGPT subscription via Codex OAuth (uses ~/.codex/auth.json)
  ['codex', createCodexProvider],
  ['chatgpt', createCodexProvider],
  // OpenAI-compatible endpoints (Ollama, vLLM, LM Studio, etc.)
  // Use the OpenAI provider with custom baseUrl
  ['ollama', (config) => createOpenAIProvider({
    ...config,
    baseUrl: config.baseUrl || 'http://localhost:11434/v1',
    apiKey: config.apiKey || 'ollama', // Ollama doesn't need a real key
  })],
  ['local', (config) => createOpenAIProvider({
    ...config,
    baseUrl: config.baseUrl || 'http://localhost:8000/v1',
    apiKey: config.apiKey || 'local',
  })],
]);

const instances = new Map<string, Provider>();

export function registerProvider(name: string, factory: ProviderFactory): void {
  factories.set(name, factory);
}

export function getProvider(name: string, config?: ProviderConfig): Provider {
  const cacheKey = name + (config?.baseUrl || '');
  const cached = instances.get(cacheKey);
  if (cached) return cached;

  const factory = factories.get(name);
  if (!factory) {
    throw new Error(`Unknown provider: ${name}. Available: ${[...factories.keys()].join(', ')}`);
  }

  const provider = factory(config || {});
  instances.set(cacheKey, provider);
  return provider;
}

/**
 * Resolve a model string to a provider + model name.
 *
 * Formats:
 *   claude-sonnet-4-20250514           Auto-detect Anthropic
 *   gpt-4o                             Auto-detect OpenAI
 *   anthropic:claude-sonnet-4-20250514 Explicit provider
 *   ollama:llama3.1                    Ollama on localhost:11434
 *   local:qwen-2.5-coder              Local vLLM on localhost:8000
 *   http://host:port/v1:model-name     Custom endpoint
 */
export function resolveProvider(model: string): { provider: Provider; model: string } {
  // Custom endpoint URL format: http://host:port/v1:model-name
  const urlMatch = model.match(/^(https?:\/\/[^:]+:\d+\/[^:]*):(.+)$/);
  if (urlMatch) {
    const [, baseUrl, modelName] = urlMatch;
    const provider = createOpenAIProvider({ baseUrl, apiKey: 'custom' });
    return { provider, model: modelName };
  }

  // Explicit provider prefix
  if (model.includes(':')) {
    const [providerName, modelName] = model.split(':', 2);
    return { provider: getProvider(providerName), model: modelName };
  }

  // Auto-detect provider from model name
  if (model.startsWith('claude')) {
    return { provider: getProvider('anthropic'), model };
  }
  // GPT-5.x models → Codex (ChatGPT subscription via Responses API)
  // Match both "gpt-5" and "gpt5" (with or without dash)
  if (model.startsWith('gpt-5') || model.startsWith('gpt5')) {
    try {
      return { provider: getProvider('codex'), model };
    } catch {
      return { provider: getProvider('openai'), model };
    }
  }
  // GPT-4 and older → OpenAI API key
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) {
    return { provider: getProvider('openai'), model };
  }

  // Check config for default provider
  const config = loadConfig();
  if (config.default_provider) {
    return { provider: getProvider(config.default_provider), model };
  }

  throw new Error(
    `Cannot auto-detect provider for model: ${model}\n` +
    'Use one of these formats:\n' +
    '  anthropic:model-name\n' +
    '  openai:model-name\n' +
    '  ollama:model-name\n' +
    '  http://host:port/v1:model-name'
  );
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
