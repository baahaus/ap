import type {
  Provider,
  CompletionRequest,
  CompletionResponse,
  Message,
  ContentBlock,
  StreamEvent,
  ToolUseContent,
} from '@ap/ai';
import { UsageTracker, compressToolOutput } from '@ap/ai';
import { coreTools, findTool, getToolDefinitions, type CoreTool } from './tools/index.js';
import { assembleContext } from './context.js';
import { ExtensionManager } from './extensions.js';
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
  extensions?: ExtensionManager;
  session?: Session; // Pass existing session for resume
  onStream?: (event: StreamEvent) => void;
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: string) => void;
}

export interface Agent {
  session: Session;
  usage: UsageTracker;
  extensions: ExtensionManager;
  send(content: string): Promise<Message>;
  getMessages(): Message[];
}

export async function createAgent(config: AgentConfig): Promise<Agent> {
  const { provider, model, cwd, onStream, onToolStart, onToolEnd } = config;
  const tools = config.tools || coreTools;
  const usage = new UsageTracker();
  const session = config.session || await createSession(cwd);

  // Load extensions
  const extensions = config.extensions || new ExtensionManager();
  if (!config.extensions) {
    const loaded = await extensions.loadAll(cwd);
    if (loaded > 0) {
      process.stderr.write(`Loaded ${loaded} extension(s)\n`);
    }
  }

  // Merge core tools with extension tools
  const extTools = extensions.getTools();
  const allTools: CoreTool[] = [
    ...tools,
    ...extTools.map((t) => t as unknown as CoreTool),
  ];
  const toolDefs = getToolDefinitions(allTools);

  // Build system prompt with extension context
  let systemPrompt = await assembleContext(cwd);
  const appendedCtx = extensions.getAppendedContext();
  if (appendedCtx.length > 0) {
    systemPrompt += '\n\n' + appendedCtx.join('\n\n');
  }

  async function runToolCalls(content: ContentBlock[]): Promise<Message> {
    const toolUses = content.filter((b): b is ToolUseContent => b.type === 'tool_use');
    const results: ContentBlock[] = [];

    for (const toolUse of toolUses) {
      onToolStart?.(toolUse.name, toolUse.input);

      // Fire pre-tool event
      await extensions.emit('tool:before', { name: toolUse.name, input: toolUse.input });

      const tool = findTool(toolUse.name, allTools);
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

      // Compress tool output before adding to context (if Wren available)
      const compressed = await compressToolOutput(toolUse.name, result);

      // Fire post-tool event
      await extensions.emit('tool:after', { name: toolUse.name, result: compressed });

      results.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: compressed,
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
    extensions,
    send,
    getMessages: () => getActiveMessages(session),
  };
}
