import { createInterface } from 'node:readline';
import { resolveProvider, type StreamEvent, type Message } from '@blushagent/ai';
import { createAgent, saveSession } from '@blushagent/core';

/**
 * RPC Mode -- JSON over stdin/stdout (LF-delimited JSONL).
 *
 * Input messages (one per line):
 *   {"type": "send", "content": "your message"}
 *   {"type": "command", "name": "btw", "args": "question"}
 *   {"type": "ping"}
 *
 * Output messages (one per line):
 *   {"type": "text", "content": "response text"}
 *   {"type": "tool_start", "name": "read", "input": {...}}
 *   {"type": "tool_end", "name": "read", "result": "..."}
 *   {"type": "done", "usage": {...}}
 *   {"type": "error", "message": "..."}
 *   {"type": "pong"}
 */

interface RpcInput {
  type: 'send' | 'command' | 'ping';
  content?: string;
  name?: string;
  args?: string;
}

interface RpcOutput {
  type: 'text' | 'tool_start' | 'tool_end' | 'done' | 'error' | 'pong' | 'ready';
  [key: string]: unknown;
}

function emit(msg: RpcOutput): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

export async function runRpc(model: string): Promise<void> {
  const { provider, model: resolvedModel } = resolveProvider(model);
  const cwd = process.cwd();

  const agent = await createAgent({
    provider,
    model: resolvedModel,
    cwd,
    onStream: (event: StreamEvent) => {
      switch (event.type) {
        case 'text':
          emit({ type: 'text', content: event.text || '' });
          break;
        case 'tool_use_start':
          if (event.toolUse) {
            emit({ type: 'tool_start', name: event.toolUse.name, input: event.toolUse.input });
          }
          break;
        case 'tool_use_end':
          if (event.toolUse) {
            emit({ type: 'tool_end', name: event.toolUse.name });
          }
          break;
        case 'error':
          emit({ type: 'error', message: event.error || 'Unknown error' });
          break;
      }
    },
    onToolStart: (name, input) => {
      emit({ type: 'tool_start', name, input });
    },
    onToolEnd: (name, result) => {
      emit({ type: 'tool_end', name, result: result.slice(0, 1000) });
    },
  });

  emit({ type: 'ready', model: resolvedModel, session: agent.session.id });

  const rl = createInterface({ input: process.stdin });

  rl.on('line', async (line) => {
    let msg: RpcInput;
    try {
      msg = JSON.parse(line);
    } catch {
      emit({ type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'ping':
        emit({ type: 'pong' });
        break;

      case 'send': {
        if (!msg.content) {
          emit({ type: 'error', message: 'Missing content' });
          return;
        }
        try {
          const response = await agent.send(msg.content);
          const text = typeof response.content === 'string'
            ? response.content
            : response.content
                .filter((b) => b.type === 'text')
                .map((b) => (b.type === 'text' ? b.text : ''))
                .join('');
          emit({ type: 'done', content: text, usage: agent.usage.total });
          await saveSession(agent.session);
        } catch (err) {
          emit({ type: 'error', message: (err as Error).message });
        }
        break;
      }

      case 'command':
        emit({ type: 'error', message: 'Commands not yet supported in RPC mode' });
        break;

      default:
        emit({ type: 'error', message: `Unknown message type: ${(msg as Record<string, unknown>).type}` });
    }
  });

  rl.on('close', async () => {
    await saveSession(agent.session);
    process.exit(0);
  });
}
