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

function toOpenAIMessages(messages: Message[], system?: string): unknown[] {
  const result: unknown[] = [];

  if (system) {
    result.push({ role: 'system', content: system });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Handle tool results as separate messages
    const toolResults = msg.content.filter((b) => b.type === 'tool_result');
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        if (tr.type === 'tool_result') {
          result.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id,
            content: tr.content,
          });
        }
      }
      continue;
    }

    // Handle assistant messages with tool calls
    const toolUses = msg.content.filter((b) => b.type === 'tool_use');
    const textBlocks = msg.content.filter((b) => b.type === 'text');
    const text = textBlocks.map((b) => (b.type === 'text' ? b.text : '')).join('');

    if (toolUses.length > 0) {
      result.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolUses.map((tu) => {
          if (tu.type !== 'tool_use') return null;
          return {
            id: tu.id,
            type: 'function',
            function: { name: tu.name, arguments: JSON.stringify(tu.input) },
          };
        }).filter(Boolean),
      });
    } else {
      result.push({ role: msg.role, content: text });
    }
  }

  return result;
}

function toOpenAITools(request: CompletionRequest): unknown[] | undefined {
  if (!request.tools?.length) return undefined;
  return request.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

export function createOpenAIProvider(config: ProviderConfig): Provider {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY required');
  }

  const key: string = apiKey;

  async function* stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    const body: Record<string, unknown> = {
      model: request.model || config.defaultModel || 'gpt-4o',
      messages: toOpenAIMessages(request.messages, request.system),
      max_tokens: request.maxTokens || 8192,
      stream: true,
    };

    const tools = toOpenAITools(request);
    if (tools) body.tools = tools;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stopSequences?.length) body.stop = request.stopSequences;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `OpenAI API error ${response.status}: ${error}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls = new Map<number, { id: string; name: string; input: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          // Emit tool_use_end for any pending tool calls
          for (const tc of toolCalls.values()) {
            yield { type: 'tool_use_end', toolUse: { ...tc } };
          }
          yield { type: 'done' };
          continue;
        }

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        const choices = chunk.choices as Array<Record<string, unknown>>;
        if (!choices?.length) continue;

        const delta = choices[0].delta as Record<string, unknown>;
        if (!delta) continue;

        if (delta.content) {
          yield { type: 'text', text: delta.content as string };
        }

        if (delta.tool_calls) {
          const tcs = delta.tool_calls as Array<Record<string, unknown>>;
          for (const tc of tcs) {
            const idx = tc.index as number;
            const fn = tc.function as Record<string, unknown> | undefined;

            if (!toolCalls.has(idx)) {
              const id = (tc.id as string) || `call_${idx}`;
              const name = fn?.name as string || '';
              toolCalls.set(idx, { id, name, input: '' });
              yield { type: 'tool_use_start', toolUse: { id, name, input: '' } };
            }

            if (fn?.arguments) {
              const existing = toolCalls.get(idx)!;
              existing.input += fn.arguments as string;
              yield { type: 'tool_use_delta', toolUse: { ...existing } };
            }
          }
        }
      }
    }
  }

  async function complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body: Record<string, unknown> = {
      model: request.model || config.defaultModel || 'gpt-4o',
      messages: toOpenAIMessages(request.messages, request.system),
      max_tokens: request.maxTokens || 8192,
    };

    const tools = toOpenAITools(request);
    if (tools) body.tools = tools;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stopSequences?.length) body.stop = request.stopSequences;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${error}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const choices = data.choices as Array<Record<string, unknown>>;
    const choice = choices[0];
    const message = choice.message as Record<string, unknown>;
    const usage = data.usage as Record<string, number>;

    const blocks: ContentBlock[] = [];

    if (message.content) {
      blocks.push({ type: 'text', text: message.content as string });
    }

    if (message.tool_calls) {
      const tcs = message.tool_calls as Array<Record<string, unknown>>;
      for (const tc of tcs) {
        const fn = tc.function as Record<string, string>;
        blocks.push({
          type: 'tool_use',
          id: tc.id as string,
          name: fn.name,
          input: JSON.parse(fn.arguments),
        });
      }
    }

    const stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use' as const
      : choice.finish_reason === 'length' ? 'max_tokens' as const
      : 'end_turn' as const;

    const tokenUsage: TokenUsage = {
      inputTokens: usage?.prompt_tokens || 0,
      outputTokens: usage?.completion_tokens || 0,
    };

    return {
      message: { role: 'assistant', content: blocks },
      usage: tokenUsage,
      stopReason,
    };
  }

  return {
    name: 'openai',
    stream,
    complete,
    models: () => ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o3-mini'],
  };
}
