import type { Provider } from '@ap/ai';
import { createAgent, type Agent } from '@ap/core';
import { createWorktree, mergeWorktree, type Worktree } from './worktree.js';
import { sendMessage, readMessages, markRead } from './mailbox.js';
import {
  createTask,
  claimTask,
  startTask,
  completeTask,
  listTasks,
  type TeamTask,
} from './taskqueue.js';

export interface PeerAgent {
  name: string;
  agent: Agent;
  worktree: Worktree;
  status: 'idle' | 'working' | 'done';
}

export interface TeamSession {
  id: string;
  repoPath: string;
  peers: Map<string, PeerAgent>;
  provider: Provider;
  model: string;
}

function generateSessionId(): string {
  return 'team-' + Date.now().toString(36);
}

export function createTeamSession(
  repoPath: string,
  provider: Provider,
  model: string,
): TeamSession {
  return {
    id: generateSessionId(),
    repoPath,
    peers: new Map(),
    provider,
    model,
  };
}

export async function spawnPeer(
  session: TeamSession,
  name: string,
  prompt?: string,
): Promise<PeerAgent> {
  if (session.peers.has(name)) {
    throw new Error(`Agent "${name}" already exists in this session`);
  }

  const worktree = createWorktree(session.repoPath, name);

  const agent = await createAgent({
    provider: session.provider,
    model: session.model,
    cwd: worktree.path,
  });

  const peer: PeerAgent = {
    name,
    agent,
    worktree,
    status: 'idle',
  };

  session.peers.set(name, peer);

  // If there's an initial prompt, send it
  if (prompt) {
    peer.status = 'working';
    await agent.send(prompt);
    peer.status = 'idle';
  }

  return peer;
}

export async function messagePeer(
  session: TeamSession,
  from: string,
  to: string,
  message: string,
): Promise<void> {
  await sendMessage(session.id, from, to, 'request', message);

  // If the target agent exists, deliver immediately
  const peer = session.peers.get(to);
  if (peer && peer.status === 'idle') {
    const unread = await readMessages(session.id, to);
    for (const msg of unread) {
      peer.status = 'working';
      await peer.agent.send(`[Message from ${msg.from}]: ${msg.payload}`);
      await markRead(session.id, to, msg.id);
      peer.status = 'idle';
    }
  }
}

export async function synthesize(
  session: TeamSession,
  provider: Provider,
  model: string,
): Promise<string> {
  // Collect outputs from all peers
  const outputs: string[] = [];

  for (const [name, peer] of session.peers) {
    const messages = peer.agent.getMessages();
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant) {
      const text = typeof lastAssistant.content === 'string'
        ? lastAssistant.content
        : lastAssistant.content
            .filter((b) => b.type === 'text')
            .map((b) => (b.type === 'text' ? b.text : ''))
            .join('');
      outputs.push(`## Agent: ${name}\n${text}`);
    }
  }

  // Use LLM to synthesize
  const response = await provider.complete({
    model,
    messages: [
      {
        role: 'user',
        content: `Multiple agents worked on related tasks. Synthesize their outputs into a unified result.\n\n${outputs.join('\n\n---\n\n')}`,
      },
    ],
    system: 'You are a synthesis agent. Combine multiple agent outputs into a coherent unified result. Resolve conflicts, deduplicate, and produce the best combined output.',
    maxTokens: 8192,
  });

  return typeof response.message.content === 'string'
    ? response.message.content
    : response.message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('');
}

export async function mergePeer(session: TeamSession, name: string): Promise<{ success: boolean; output: string }> {
  const peer = session.peers.get(name);
  if (!peer) {
    return { success: false, output: `Agent "${name}" not found` };
  }

  peer.worktree.cleanup();
  const result = mergeWorktree(session.repoPath, peer.worktree.branch);
  peer.status = 'done';

  return result;
}

export function getTeamStatus(session: TeamSession): {
  agents: Array<{ name: string; status: string; branch: string }>;
} {
  const agents = [...session.peers.entries()].map(([name, peer]) => ({
    name,
    status: peer.status,
    branch: peer.worktree.branch,
  }));

  return { agents };
}
