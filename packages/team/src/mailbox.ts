import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const TEAM_DIR = join(homedir(), '.ap', 'team');

export type MessageType = 'request' | 'response' | 'broadcast' | 'status' | 'artifact';

export interface TeamMessage {
  id: string;
  from: string;
  to: string; // agent name or '*' for broadcast
  type: MessageType;
  payload: unknown;
  timestamp: number;
  read: boolean;
}

function mailboxDir(sessionId: string, agentName: string): string {
  return join(TEAM_DIR, sessionId, 'mailbox', agentName);
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function sendMessage(
  sessionId: string,
  from: string,
  to: string,
  type: MessageType,
  payload: unknown,
): Promise<TeamMessage> {
  const msg: TeamMessage = {
    id: generateId(),
    from,
    to,
    type,
    payload,
    timestamp: Date.now(),
    read: false,
  };

  const dir = mailboxDir(sessionId, to);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${msg.id}.json`), JSON.stringify(msg, null, 2));

  // If broadcast, also write to all known mailboxes
  if (to === '*') {
    const teamDir = join(TEAM_DIR, sessionId, 'mailbox');
    if (existsSync(teamDir)) {
      const agents = await readdir(teamDir);
      for (const agent of agents) {
        if (agent === from) continue;
        const agentDir = mailboxDir(sessionId, agent);
        await mkdir(agentDir, { recursive: true });
        await writeFile(join(agentDir, `${msg.id}.json`), JSON.stringify({ ...msg, to: agent }));
      }
    }
  }

  return msg;
}

export async function readMessages(
  sessionId: string,
  agentName: string,
  unreadOnly = true,
): Promise<TeamMessage[]> {
  const dir = mailboxDir(sessionId, agentName);
  if (!existsSync(dir)) return [];

  const files = await readdir(dir);
  const messages: TeamMessage[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const content = await readFile(join(dir, file), 'utf-8');
    const msg: TeamMessage = JSON.parse(content);
    if (unreadOnly && msg.read) continue;
    messages.push(msg);
  }

  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

export async function markRead(sessionId: string, agentName: string, messageId: string): Promise<void> {
  const dir = mailboxDir(sessionId, agentName);
  const path = join(dir, `${messageId}.json`);
  if (!existsSync(path)) return;

  const content = await readFile(path, 'utf-8');
  const msg: TeamMessage = JSON.parse(content);
  msg.read = true;
  await writeFile(path, JSON.stringify(msg, null, 2));
}
