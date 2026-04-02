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
import { getAnthropicAuthHeaders } from '../auth.js';

const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Fetch with rate limit handling.
 * On 429: retry once after a short wait, then fall back to haiku.
 */
async function fetchWithFallback(
  url: string,
  init: RequestInit,
  requestBody: Record<string, unknown>,
): Promise<Response> {
  const response = await fetch(url, init);

  if (response.status === 429) {
    const originalModel = requestBody.model as string;

    // One retry after 2s
    const retryAfter = response.headers.get('retry-after');
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;
    process.stderr.write(`Rate limited on ${originalModel}, retrying in ${Math.round(waitMs / 1000)}s...\n`);
    await new Promise((r) => setTimeout(r, waitMs));

    const retry = await fetch(url, init);
    if (retry.ok) return retry;

    // If still 429 and not already haiku, fall back
    if (retry.status === 429 && !originalModel.includes('haiku')) {
      process.stderr.write(`${originalModel} rate limited. Falling back to ${FALLBACK_MODEL}\n`);
      const fallbackBody = { ...requestBody, model: FALLBACK_MODEL };
      return fetch(url, {
        ...init,
        body: JSON.stringify(fallbackBody),
      });
    }

    return retry;
  }

  return response;
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

  // Get auth -- tries OAuth (Claude subscription) first, then API key
  const auth = getAnthropicAuthHeaders(apiKey);
  const urlSuffix = auth.queryParams ? `?${auth.queryParams}` : '';

  async function* stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    const body: Record<string, unknown> = {
      model: request.model || config.defaultModel || 'claude-sonnet-4-20250514',
      messages: toAnthropicMessages(request.messages),
      max_tokens: request.maxTokens || 8192,
      stream: true,
    };

    if (request.system) body.system = request.system;
    if (request.tools?.length) body.tools = request.tools;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stopSequences?.length) body.stop_sequences = request.stopSequences;

    const response = await fetchWithFallback(
      `${baseUrl}/v1/messages${urlSuffix}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...auth.headers,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      },
      body,
    );

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `Anthropic API error ${response.status}: ${error}` };
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

        if (eventType === 'content_block_start') {
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

    if (request.system) body.system = request.system;
    if (request.tools?.length) body.tools = request.tools;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stopSequences?.length) body.stop_sequences = request.stopSequences;

    const response = await fetchWithFallback(
      `${baseUrl}/v1/messages${urlSuffix}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...auth.headers,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      },
      body,
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${error}`);
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
