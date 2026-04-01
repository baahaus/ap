import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import type { Message } from '@ap/ai';

const SESSIONS_DIR = join(homedir(), '.ap', 'sessions');

export interface SessionEntry {
  id: string;
  parentId: string | null;
  timestamp: number;
  message: Message;
  metadata?: Record<string, unknown>;
}

export interface Session {
  id: string;
  cwd: string;
  entries: SessionEntry[];
  currentBranch: string; // ID of the latest entry in the active branch
}

function encodeCwd(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16);
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function sessionDir(cwd: string): string {
  return join(SESSIONS_DIR, encodeCwd(cwd));
}

export async function createSession(cwd: string): Promise<Session> {
  const id = generateId();
  const dir = sessionDir(cwd);
  await mkdir(dir, { recursive: true });

  const session: Session = {
    id,
    cwd,
    entries: [],
    currentBranch: '',
  };

  return session;
}

export function addEntry(
  session: Session,
  message: Message,
  metadata?: Record<string, unknown>,
): SessionEntry {
  const entry: SessionEntry = {
    id: generateId(),
    parentId: session.currentBranch || null,
    timestamp: Date.now(),
    message,
    metadata,
  };

  session.entries.push(entry);
  session.currentBranch = entry.id;
  return entry;
}

export function getActiveMessages(session: Session): Message[] {
  if (session.entries.length === 0) return [];

  // Walk back from currentBranch to build the active chain
  const chain: SessionEntry[] = [];
  let currentId: string | null = session.currentBranch;

  const entriesById = new Map(session.entries.map((e) => [e.id, e]));

  while (currentId) {
    const entry = entriesById.get(currentId);
    if (!entry) break;
    chain.unshift(entry);
    currentId = entry.parentId;
  }

  return chain.map((e) => e.message);
}

export function branchAt(session: Session, entryId: string): void {
  // Set currentBranch to the given entry, future entries fork from here
  const entry = session.entries.find((e) => e.id === entryId);
  if (!entry) throw new Error(`Entry not found: ${entryId}`);
  session.currentBranch = entryId;
}

export async function saveSession(session: Session): Promise<void> {
  const dir = sessionDir(session.cwd);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${session.id}.jsonl`);

  const lines = session.entries.map((e) => JSON.stringify(e)).join('\n');
  await writeFile(path, lines + '\n', 'utf-8');
}

export async function loadSession(cwd: string, sessionId: string): Promise<Session | null> {
  const dir = sessionDir(cwd);
  const path = join(dir, `${sessionId}.jsonl`);

  if (!existsSync(path)) return null;

  const content = await readFile(path, 'utf-8');
  const entries: SessionEntry[] = content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const lastEntry = entries[entries.length - 1];

  return {
    id: sessionId,
    cwd,
    entries,
    currentBranch: lastEntry?.id || '',
  };
}

export async function listSessions(cwd: string): Promise<string[]> {
  const dir = sessionDir(cwd);
  if (!existsSync(dir)) return [];

  const { readdir } = await import('node:fs/promises');
  const files = await readdir(dir);
  return files
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace('.jsonl', ''));
}
