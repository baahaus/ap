import type {
  Provider,
  CompletionRequest,
  CompletionResponse,
  Message,
  ContentBlock,
  StreamEvent,
  ToolUseContent,
} from '@ap/ai';
import { UsageTracker } from '@ap/ai';
import { coreTools, findTool, getToolDefinitions, type CoreTool } from './tools/index.js';
import { assembleContext } from './context.js';
import {
  createSession,
  addEntry,
  getActiveMessages,
  saveSession,
  type Session,
} from './session.js';

export interface AgentConfig {
  provider: Provider;
  model: string;
  cwd: string;
  tools?: CoreTool[];
  onStream?: (event: StreamEvent) => void;
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: string) => void;
}

export interface Agent {
  session: Session;
  usage: UsageTracker;
  send(content: string): Promise<Message>;
  getMessages(): Message[];
}

export async function createAgent(config: AgentConfig): Promise<Agent> {
  const { provider, model, cwd, onStream, onToolStart, onToolEnd } = config;
  const tools = config.tools || coreTools;
  const toolDefs = getToolDefinitions(tools);
  const usage = new UsageTracker();
  const session = await createSession(cwd);
  const systemPrompt = await assembleContext(cwd);

  async function runToolCalls(content: ContentBlock[]): Promise<Message> {
    const toolUses = content.filter((b): b is ToolUseContent => b.type === 'tool_use');
    const results: ContentBlock[] = [];

    for (const toolUse of toolUses) {
      onToolStart?.(toolUse.name, toolUse.input);

      const tool = findTool(toolUse.name, tools);
      let result: string;

      if (!tool) {
        result = `Error: Unknown tool: ${toolUse.name}`;
      } else {
        try {
          result = await tool.execute(toolUse.input);
        } catch (err) {
          result = `Error executing ${toolUse.name}: ${(err as Error).message}`;
        }
      }

      onToolEnd?.(toolUse.name, result);

      results.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    return { role: 'user', content: results };
  }

  async function send(content: string): Promise<Message> {
    // Add user message to session
    const userMessage: Message = { role: 'user', content };
    addEntry(session, userMessage);

    // Agent loop: send -> tool calls -> send results -> repeat
    while (true) {
      const messages = getActiveMessages(session);

      const request: CompletionRequest = {
        model,
        messages,
        system: systemPrompt,
        tools: toolDefs,
        maxTokens: 8192,
      };

      let response: CompletionResponse;

      if (onStream) {
        // Streaming path
        const collected: ContentBlock[] = [];
        let currentText = '';
        const pendingToolUses: Map<string, { id: string; name: string; input: string }> = new Map();

        for await (const event of provider.stream(request)) {
          onStream(event);

          switch (event.type) {
            case 'text':
              currentText += event.text || '';
              break;
            case 'tool_use_start':
              if (event.toolUse) {
                pendingToolUses.set(event.toolUse.id, { ...event.toolUse });
              }
              break;
            case 'tool_use_delta':
              if (event.toolUse) {
                pendingToolUses.set(event.toolUse.id, { ...event.toolUse });
              }
              break;
            case 'tool_use_end':
              if (event.toolUse) {
                const tu = event.toolUse;
                let input: Record<string, unknown>;
                try {
                  input = JSON.parse(tu.input);
                } catch {
                  input = {};
                }
                collected.push({ type: 'tool_use', id: tu.id, name: tu.name, input });
              }
              break;
            case 'error':
              throw new Error(event.error);
          }
        }

        if (currentText) {
          collected.unshift({ type: 'text', text: currentText });
        }

        const hasToolUse = collected.some((b) => b.type === 'tool_use');

        response = {
          message: { role: 'assistant', content: collected },
          usage: { inputTokens: 0, outputTokens: 0 }, // Not available in stream mode
          stopReason: hasToolUse ? 'tool_use' : 'end_turn',
        };
      } else {
        // Non-streaming path
        response = await provider.complete(request);
      }

      usage.record(response.usage);

      // Add assistant message to session
      addEntry(session, response.message);

      // If no tool calls, we're done
      if (response.stopReason !== 'tool_use') {
        await saveSession(session);
        return response.message;
      }

      // Execute tool calls and add results
      const blocks = Array.isArray(response.message.content)
        ? response.message.content
        : [];

      const toolResultMessage = await runToolCalls(blocks);
      addEntry(session, toolResultMessage);

      // Continue the loop for the next LLM turn
    }
  }

  return {
    session,
    usage,
    send,
    getMessages: () => getActiveMessages(session),
  };
}
