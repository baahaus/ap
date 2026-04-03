import type { Provider } from '@blushagent/ai';
import { createAgent, type Agent } from '@blushagent/core';
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
  return 'blush-team-' + Date.now().toString(36);
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

export interface ReviewResult {
  approved: boolean;
  feedback: string;
  reviewerName: string;
  targetName: string;
}

/**
 * Review pattern: one agent reviews another's output before merge.
 * Returns approval status and feedback. Does not auto-merge.
 */
export async function reviewPeer(
  session: TeamSession,
  reviewerName: string,
  targetName: string,
  provider: Provider,
  model: string,
  criteria?: string,
): Promise<ReviewResult> {
  const reviewer = session.peers.get(reviewerName);
  const target = session.peers.get(targetName);

  if (!reviewer) throw new Error(`Reviewer agent "${reviewerName}" not found`);
  if (!target) throw new Error(`Target agent "${targetName}" not found`);

  // Get the target agent's last output
  const targetMessages = target.agent.getMessages();
  const lastOutput = [...targetMessages].reverse().find((m) => m.role === 'assistant');

  if (!lastOutput) {
    return {
      approved: false,
      feedback: `Agent "${targetName}" has no output to review.`,
      reviewerName,
      targetName,
    };
  }

  const outputText = typeof lastOutput.content === 'string'
    ? lastOutput.content
    : lastOutput.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('');

  // Get the diff from the target's worktree
  let diff = '';
  try {
    const { execSync } = await import('node:child_process');
    diff = execSync('git diff HEAD~1 --stat && echo "---" && git diff HEAD~1', {
      cwd: target.worktree.path,
      encoding: 'utf-8',
      timeout: 10_000,
    });
  } catch {
    diff = '(no diff available)';
  }

  const reviewPrompt = [
    `Review the following output from agent "${targetName}".`,
    criteria ? `\nReview criteria: ${criteria}` : '',
    `\n## Agent Output\n${outputText}`,
    diff !== '(no diff available)' ? `\n## Code Changes\n\`\`\`diff\n${diff}\n\`\`\`` : '',
    '\nRespond with:\n1. APPROVED or CHANGES_REQUESTED on the first line',
    '2. Your detailed feedback below',
  ].filter(Boolean).join('\n');

  // Send review prompt to the reviewer agent
  reviewer.status = 'working';
  await reviewer.agent.send(reviewPrompt);
  reviewer.status = 'idle';

  // Parse the reviewer's response
  const reviewerMessages = reviewer.agent.getMessages();
  const reviewResponse = [...reviewerMessages].reverse().find((m) => m.role === 'assistant');

  const responseText = reviewResponse
    ? typeof reviewResponse.content === 'string'
      ? reviewResponse.content
      : reviewResponse.content
          .filter((b) => b.type === 'text')
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('')
    : '';

  const approved = responseText.trim().toUpperCase().startsWith('APPROVED');

  // If not approved, send feedback back to the target
  if (!approved && responseText) {
    await sendMessage(session.id, reviewerName, targetName, 'response', responseText);
    const targetPeer = session.peers.get(targetName);
    if (targetPeer && targetPeer.status === 'idle') {
      targetPeer.status = 'working';
      await targetPeer.agent.send(`[Review from ${reviewerName}]: ${responseText}`);
      targetPeer.status = 'idle';
    }
  }

  return {
    approved,
    feedback: responseText,
    reviewerName,
    targetName,
  };
}

export interface PipelineStage {
  name: string;
  prompt: string;
}

export interface PipelineResult {
  stages: Array<{ name: string; output: string }>;
  finalOutput: string;
}

/**
 * Pipeline pattern: sequential handoff from agent to agent.
 * Each stage receives the previous stage's output as context.
 * Spawns agents on-demand and cleans up after.
 */
export async function runPipeline(
  session: TeamSession,
  stages: PipelineStage[],
): Promise<PipelineResult> {
  if (stages.length === 0) throw new Error('Pipeline requires at least one stage');

  const results: Array<{ name: string; output: string }> = [];
  let previousOutput = '';

  for (const stage of stages) {
    const prompt = previousOutput
      ? `${stage.prompt}\n\n## Input from previous stage\n${previousOutput}`
      : stage.prompt;

    // Spawn the agent if it doesn't exist
    let peer = session.peers.get(stage.name);
    if (!peer) {
      peer = await spawnPeer(session, stage.name);
    }

    peer.status = 'working';
    await peer.agent.send(prompt);
    peer.status = 'idle';

    // Extract output
    const messages = peer.agent.getMessages();
    const lastOutput = [...messages].reverse().find((m) => m.role === 'assistant');

    const outputText = lastOutput
      ? typeof lastOutput.content === 'string'
        ? lastOutput.content
        : lastOutput.content
            .filter((b) => b.type === 'text')
            .map((b) => (b.type === 'text' ? b.text : ''))
            .join('')
      : '';

    results.push({ name: stage.name, output: outputText });
    previousOutput = outputText;
  }

  return {
    stages: results,
    finalOutput: previousOutput,
  };
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
