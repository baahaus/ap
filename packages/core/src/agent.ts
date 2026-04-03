import type {
  Provider,
  CompletionRequest,
  CompletionResponse,
  Message,
  ContentBlock,
  StreamEvent,
  ToolUseContent,
} from '@blush/ai';
import { UsageTracker, compressToolOutput } from '@blush/ai';
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
import {
  connectAllMCPServers,
  closeMCPConnections,
  type MCPServerConfig,
  type MCPConnection,
} from './mcp.js';

export interface AgentConfig {
  provider: Provider;
  model: string;
  cwd: string;
  tools?: CoreTool[];
  extensions?: ExtensionManager;
  session?: Session; // Pass existing session for resume
  thinking?: boolean;
  mcpServers?: MCPServerConfig[];
  onStream?: (event: StreamEvent) => void;
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: string) => void;
}

export interface Agent {
  session: Session;
  usage: UsageTracker;
  extensions: ExtensionManager;
  mcpConnections: MCPConnection[];
  mcpTools: CoreTool[];
  send(content: string, options?: { signal?: AbortSignal }): Promise<Message>;
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

  // Connect MCP servers
  let mcpConnections: MCPConnection[] = [];
  let mcpTools: CoreTool[] = [];
  if (config.mcpServers && config.mcpServers.length > 0) {
    mcpConnections = await connectAllMCPServers(config.mcpServers);
    mcpTools = mcpConnections.flatMap((conn) => conn.tools);
  }

  // Merge core tools with extension tools and MCP tools
  const extTools = extensions.getTools();
  const allTools: CoreTool[] = [
    ...tools,
    ...extTools.map((t) => t as unknown as CoreTool),
    ...mcpTools,
  ];
  const toolDefs = getToolDefinitions(allTools);

  // Build system prompt with extension context
  let systemPrompt = await assembleContext(cwd);
  const appendedCtx = extensions.getAppendedContext();
  if (appendedCtx.length > 0) {
    systemPrompt += '\n\n' + appendedCtx.join('\n\n');
  }
  const maxToolRounds = 24;
  const forcedFinalResponsePrompt = [
    'You have reached the tool-use safety limit for this turn.',
    'Do not call any more tools.',
    'Respond to the user with the best possible answer using only the information already gathered.',
    'If the task is incomplete, say exactly what remains blocked instead of attempting more tool calls.',
  ].join(' ');

  async function runToolCalls(content: ContentBlock[], signal?: AbortSignal): Promise<Message> {
    const toolUses = content.filter((b): b is ToolUseContent => b.type === 'tool_use');
    const results: ContentBlock[] = [];

    for (const toolUse of toolUses) {
      if (signal?.aborted) break;
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
        tool_use_id: toolUse.call_id || toolUse.id,
        content: compressed,
      });
    }

    return { role: 'user', content: results };
  }

  async function send(content: string, options?: { signal?: AbortSignal }): Promise<Message> {
    const signal = options?.signal;
    // Add user message to session
    const userMessage: Message = { role: 'user', content };
    addEntry(session, userMessage);
    let toolRoundCount = 0;
    let lastToolSignature = '';
    let repeatedToolSignatureCount = 0;
    let forceFinalResponse = false;

    // Agent loop: send -> tool calls -> send results -> repeat
    while (true) {
      if (signal?.aborted) {
        await saveSession(session);
        return { role: 'assistant', content: [{ type: 'text', text: '' }] };
      }

      const messages = getActiveMessages(session);

      const request: CompletionRequest = {
        model,
        messages,
        system: forceFinalResponse
          ? `${systemPrompt}\n\n${forcedFinalResponsePrompt}`
          : systemPrompt,
        tools: forceFinalResponse ? undefined : toolDefs,
        maxTokens: config.thinking ? 16384 : 8192,
        thinking: config.thinking,
      };

      let response: CompletionResponse;

      if (onStream) {
        // Streaming path
        const collected: ContentBlock[] = [];
        let currentText = '';
        let streamUsage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } = {
          inputTokens: 0,
          outputTokens: 0,
        };
        const pendingToolUses: Map<string, { id: string; name: string; input: string; callId?: string }> = new Map();

        for await (const event of provider.stream(request)) {
          if (signal?.aborted) break;
          onStream(event);

          switch (event.type) {
            case 'text':
              currentText += event.text || '';
              break;
            case 'usage':
              if (event.usage) {
                streamUsage = { ...event.usage };
              }
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
                collected.push({ type: 'tool_use', id: tu.id, name: tu.name, input, call_id: tu.callId });
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
          usage: streamUsage,
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
      if (response.stopReason !== 'tool_use' || forceFinalResponse) {
        await saveSession(session);
        return response.message;
      }

      toolRoundCount++;
      if (toolRoundCount >= maxToolRounds) {
        forceFinalResponse = true;
        addEntry(session, {
          role: 'user',
          content: 'Tool loop limit reached. Stop using tools and answer now with the best possible response from the information already gathered.',
        });
        continue;
      }

      // Execute tool calls and add results
      const blocks = Array.isArray(response.message.content)
        ? response.message.content
        : [];

      const toolUses = blocks.filter((b): b is ToolUseContent => b.type === 'tool_use');
      const toolSignature = JSON.stringify(toolUses.map((toolUse) => ({
        name: toolUse.name,
        input: toolUse.input,
      })));

      if (toolSignature && toolSignature === lastToolSignature) {
        repeatedToolSignatureCount++;
      } else {
        lastToolSignature = toolSignature;
        repeatedToolSignatureCount = 1;
      }

      if (repeatedToolSignatureCount >= 3) {
        forceFinalResponse = true;
        addEntry(session, {
          role: 'user',
          content: 'You are repeating the same tool calls. Stop using tools and answer now with the best possible response from the information already gathered.',
        });
        continue;
      }

      const toolResultMessage = await runToolCalls(blocks, signal);
      addEntry(session, toolResultMessage);

      // Continue the loop for the next LLM turn
    }
  }

  // Close MCP connections on process exit
  if (mcpConnections.length > 0) {
    const cleanup = () => { closeMCPConnections(mcpConnections).catch(() => {}); };
    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  return {
    session,
    usage,
    extensions,
    mcpConnections,
    mcpTools,
    send,
    getMessages: () => getActiveMessages(session),
  };
}
