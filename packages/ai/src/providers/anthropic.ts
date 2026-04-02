import type {
  Provider,
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  Message,
  ContentBlock,
  TokenUsage,
} from '../types.js';
import { getApiKey } from '../config.js';
import { getAnthropicAuth } from '../auth.js';

const MAX_INTERACTIVE_RETRY_WAIT_MS = 10_000;

/** Parse raw API error body into a clean human-readable message. */
function formatApiError(status: number, raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    const msg = parsed?.error?.message || parsed?.message;
    if (msg) {
      return `API error ${status}: ${msg}`;
    }
  } catch {
    // Not JSON, use raw
  }
  // Truncate long raw responses
  const clean = raw.slice(0, 200).trim();
  return `API error ${status}: ${clean}`;
}

export function getAnthropicRetryDelayMs(
  retryAfterHeader: string | null,
  attempt: number,
): number | null {
  const parsedSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : Number.NaN;
  const headerDelayMs = Number.isFinite(parsedSeconds) && parsedSeconds >= 0
    ? parsedSeconds * 1000
    : null;
  const fallbackDelayMs = (attempt + 1) * 2000;
  const waitMs = headerDelayMs ?? fallbackDelayMs;

  if (waitMs > MAX_INTERACTIVE_RETRY_WAIT_MS) {
    return null;
  }

  return waitMs;
}

/**
 * Fetch with retry on 429.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 2,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt === maxRetries) return response;
    const retryAfter = response.headers.get('retry-after');
    const waitMs = getAnthropicRetryDelayMs(retryAfter, attempt);
    if (waitMs === null) {
      const retrySeconds = retryAfter || 'unknown';
      process.stderr.write(
        `Rate limited, retry-after ${retrySeconds}s exceeds ${Math.round(MAX_INTERACTIVE_RETRY_WAIT_MS / 1000)}s cap; failing fast.\n`,
      );
      return response;
    }
    process.stderr.write(`Rate limited, retrying in ${Math.round(waitMs / 1000)}s...\n`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return fetch(url, init);
}

function toAnthropicMessages(messages: Message[]): unknown[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    const blocks = msg.content.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text };
        case 'tool_use':
          return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          };
        case 'thinking':
          return { type: 'thinking', thinking: block.text };
        default:
          return block;
      }
    });

    return { role: msg.role, content: blocks };
  });
}

export function createAnthropicProvider(config: ProviderConfig): Provider {
  const apiKey = config.apiKey || getApiKey('anthropic');
  const baseUrl = config.baseUrl || 'https://api.anthropic.com';

  const auth = getAnthropicAuth(apiKey);
  const urlSuffix = auth.queryParams ? `?${auth.queryParams}` : '';

  // OAuth requires this exact identity string -- the API validates it.
  // Blush's actual identity comes from the system prompt in @blush/core.
  const OAUTH_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

  /**
   * Format the system prompt for the API.
   * OAuth requires: array format + identity string prefix.
   */
  function formatSystem(system?: string): unknown {
    if (auth.mode === 'api_key') {
      return system || undefined;
    }
    // OAuth: must be array format with identity string first
    const blocks = [{ type: 'text', text: OAUTH_IDENTITY }];
    if (system) {
      blocks.push({ type: 'text', text: system });
    }
    return blocks;
  }

  async function* stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    const body: Record<string, unknown> = {
      model: request.model || config.defaultModel || 'claude-sonnet-4-20250514',
      messages: toAnthropicMessages(request.messages),
      max_tokens: request.maxTokens || 8192,
      stream: true,
    };

    const sys = formatSystem(request.system);
    if (sys) body.system = sys;
    if (request.tools?.length) body.tools = request.tools;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stopSequences?.length) body.stop_sequences = request.stopSequences;

    const response = await fetchWithRetry(`${baseUrl}/v1/messages${urlSuffix}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...auth.headers,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const raw = await response.text();
      yield { type: 'error', error: formatApiError(response.status, raw) };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolUse: { id: string; name: string; input: string } | null = null;
    let streamUsage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } = {
      inputTokens: 0,
      outputTokens: 0,
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        const eventType = event.type as string;

        if (eventType === 'message_start') {
          // Anthropic sends input token count in message_start
          const msg = event.message as Record<string, unknown> | undefined;
          const usage = msg?.usage as Record<string, number> | undefined;
          if (usage) {
            streamUsage.inputTokens = usage.input_tokens || 0;
            streamUsage.cacheReadTokens = usage.cache_read_input_tokens;
            streamUsage.cacheWriteTokens = usage.cache_creation_input_tokens;
          }
        } else if (eventType === 'message_delta') {
          // Anthropic sends output token count in message_delta
          const usage = event.usage as Record<string, number> | undefined;
          if (usage) {
            streamUsage.outputTokens = usage.output_tokens || 0;
          }
          // Emit accumulated usage
          yield { type: 'usage', usage: { ...streamUsage } };
        } else if (eventType === 'content_block_start') {
          const block = event.content_block as Record<string, unknown>;
          if (block.type === 'tool_use') {
            currentToolUse = {
              id: block.id as string,
              name: block.name as string,
              input: '',
            };
            yield { type: 'tool_use_start', toolUse: { ...currentToolUse } };
          }
        } else if (eventType === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown>;
          if (delta.type === 'text_delta') {
            yield { type: 'text', text: delta.text as string };
          } else if (delta.type === 'thinking_delta') {
            yield { type: 'thinking', text: delta.thinking as string };
          } else if (delta.type === 'input_json_delta' && currentToolUse) {
            currentToolUse.input += delta.partial_json as string;
            yield { type: 'tool_use_delta', toolUse: { ...currentToolUse } };
          }
        } else if (eventType === 'content_block_stop') {
          if (currentToolUse) {
            yield { type: 'tool_use_end', toolUse: { ...currentToolUse } };
            currentToolUse = null;
          }
        } else if (eventType === 'message_stop') {
          yield { type: 'done' };
        }
      }
    }
  }

  async function complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body: Record<string, unknown> = {
      model: request.model || config.defaultModel || 'claude-sonnet-4-20250514',
      messages: toAnthropicMessages(request.messages),
      max_tokens: request.maxTokens || 8192,
    };

    const sys = formatSystem(request.system);
    if (sys) body.system = sys;
    if (request.tools?.length) body.tools = request.tools;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stopSequences?.length) body.stop_sequences = request.stopSequences;

    const response = await fetchWithRetry(`${baseUrl}/v1/messages${urlSuffix}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...auth.headers,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(formatApiError(response.status, raw));
    }

    const data = (await response.json()) as Record<string, unknown>;
    const content = data.content as Array<Record<string, unknown>>;
    const usage = data.usage as Record<string, number>;

    const blocks: ContentBlock[] = content.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'text' as const, text: block.text as string };
        case 'tool_use':
          return {
            type: 'tool_use' as const,
            id: block.id as string,
            name: block.name as string,
            input: block.input as Record<string, unknown>,
          };
        case 'thinking':
          return { type: 'thinking' as const, text: block.thinking as string };
        default:
          return { type: 'text' as const, text: JSON.stringify(block) };
      }
    });

    const tokenUsage: TokenUsage = {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens,
      cacheWriteTokens: usage.cache_creation_input_tokens,
    };

    return {
      message: { role: 'assistant', content: blocks },
      usage: tokenUsage,
      stopReason: (data.stop_reason as CompletionResponse['stopReason']) || 'end_turn',
    };
  }

  return {
    name: 'anthropic',
    stream,
    complete,
    models: () => [
      'claude-opus-4-6-20250610',
      'claude-sonnet-4-6-20250610',
      'claude-sonnet-4-20250514',
      'claude-haiku-4-5-20251001',
    ],
  };
}
