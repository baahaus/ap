/**
 * SDK Mode -- Programmatic API for embedding Blush in other tools.
 *
 * Usage:
 *   import { createBlushSession } from '@blush/cli/sdk';
 *
 *   const session = await createBlushSession({
 *     model: 'claude-sonnet-4-20250514',
 *     cwd: '/path/to/project',
 *   });
 *
 *   const response = await session.send('Read the package.json');
 *   console.log(response.text);
 *
 *   session.close();
 */

import { resolveProvider, type StreamEvent, type TokenUsage } from '@blush/ai';
import { createAgent, saveSession, type Agent } from '@blush/core';

export interface SdkConfig {
  model?: string;
  cwd?: string;
  onStream?: (event: StreamEvent) => void;
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: string) => void;
}

export interface SdkResponse {
  text: string;
  usage: TokenUsage & { calls: number };
}

export interface BlushSession {
  send: (content: string) => Promise<SdkResponse>;
  getMessages: () => Array<{ role: string; content: unknown }>;
  getUsage: () => TokenUsage & { calls: number };
  save: () => Promise<void>;
  sessionId: string;
}

export async function createBlushSession(config: SdkConfig = {}): Promise<BlushSession> {
  const model = config.model || process.env.BLUSH_MODEL || 'claude-sonnet-4-20250514';
  const cwd = config.cwd || process.cwd();
  const { provider, model: resolvedModel } = resolveProvider(model);

  const agent = await createAgent({
    provider,
    model: resolvedModel,
    cwd,
    onStream: config.onStream,
    onToolStart: config.onToolStart,
    onToolEnd: config.onToolEnd,
  });

  return {
    sessionId: agent.session.id,

    async send(content: string): Promise<SdkResponse> {
      const response = await agent.send(content);
      const text = typeof response.content === 'string'
        ? response.content
        : response.content
            .filter((b) => b.type === 'text')
            .map((b) => (b.type === 'text' ? b.text : ''))
            .join('');

      return {
        text,
        usage: agent.usage.total,
      };
    },

    getMessages() {
      return agent.getMessages();
    },

    getUsage() {
      return agent.usage.total;
    },

    async save() {
      await saveSession(agent.session);
    },
  };
}

// Backward-compatible alias for older SDK consumers.
export const createApSession = createBlushSession;
