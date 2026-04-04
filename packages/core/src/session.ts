import { readFile, writeFile, mkdir, unlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import type { Message } from '@blushagent/ai';

const SESSIONS_DIR = join(homedir(), '.blush', 'sessions');

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
  title?: string;
}

export interface SessionSummary {
  id: string;
  cwd: string;
  cwdLabel: string;
  createdAt: number;
  updatedAt: number;
  entryCount: number;
  activeMessageCount: number;
  title: string;
  model?: string;
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

export interface BranchInfo {
  id: string;
  messageCount: number;
  lastMessage?: string;
  isCurrent: boolean;
}

/**
 * Walk the entry tree and return info about each branch (leaf path).
 * A "branch" is a leaf entry -- one that no other entry points to as its parent.
 * The branch ID is the leaf entry's ID.
 */
export function listBranches(session: Session): BranchInfo[] {
  if (session.entries.length === 0) return [];

  // Find all entry IDs that are referenced as a parentId (i.e. they have children)
  const parentIds = new Set<string>();
  for (const entry of session.entries) {
    if (entry.parentId) {
      parentIds.add(entry.parentId);
    }
  }

  // Leaves are entries that are NOT a parent of any other entry
  const leaves = session.entries.filter((e) => !parentIds.has(e.id));

  // Build a lookup for walking back
  const entriesById = new Map(session.entries.map((e) => [e.id, e]));

  return leaves.map((leaf) => {
    // Walk back from leaf to count messages in this branch
    let count = 0;
    let currentId: string | null = leaf.id;
    while (currentId) {
      const entry = entriesById.get(currentId);
      if (!entry) break;
      count++;
      currentId = entry.parentId;
    }

    // Get the last message text for preview
    const lastMsg = getMessageText(leaf.message);
    const preview = lastMsg ? lastMsg.slice(0, 80) : undefined;

    return {
      id: leaf.id,
      messageCount: count,
      lastMessage: preview,
      isCurrent: leaf.id === session.currentBranch,
    };
  });
}

/**
 * Switch to a different branch by setting currentBranch to the given branch (leaf) ID.
 * This changes which messages getActiveMessages returns.
 */
export function switchBranch(session: Session, branchId: string): void {
  const entry = session.entries.find((e) => e.id === branchId);
  if (!entry) throw new Error(`Branch not found: ${branchId}`);
  session.currentBranch = branchId;
}

export async function saveSession(session: Session): Promise<void> {
  const dir = sessionDir(session.cwd);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${session.id}.jsonl`);

  const meta = JSON.stringify({ _meta: true, title: session.title || '' });
  const lines = session.entries.map((e) => JSON.stringify(e)).join('\n');
  const content = meta + '\n' + lines + '\n';

  // Atomic write: write to temp file then rename to prevent corruption
  // from concurrent reads seeing partial writes
  const tmpPath = join(dir, `.${session.id}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, path);
  } catch (err) {
    // Clean up temp file on failure
    try { await unlink(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

export async function loadSession(cwd: string, sessionId: string): Promise<Session | null> {
  const dir = sessionDir(cwd);
  const path = join(dir, `${sessionId}.jsonl`);

  if (!existsSync(path)) return null;

  const content = await readFile(path, 'utf-8');
  const lines = content
    .trim()
    .split('\n')
    .filter(Boolean);

  let title: string | undefined;
  const entryLines: string[] = [];

  let skippedLines = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed._meta) {
        title = parsed.title || undefined;
      } else {
        entryLines.push(line);
      }
    } catch {
      skippedLines++;
    }
  }

  if (skippedLines > 0) {
    process.stderr.write(`Warning: skipped ${skippedLines} malformed line(s) in session ${sessionId}\n`);
  }

  const entries: SessionEntry[] = entryLines
    .map((line) => {
      try {
        const parsed = JSON.parse(line);
        // Validate required SessionEntry fields
        if (
          typeof parsed.id !== 'string' ||
          typeof parsed.timestamp !== 'number' ||
          !parsed.message ||
          typeof parsed.message.role !== 'string'
        ) {
          return null;
        }
        return parsed as SessionEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is SessionEntry => entry !== null);

  const lastEntry = entries[entries.length - 1];

  return {
    id: sessionId,
    cwd,
    entries,
    currentBranch: lastEntry?.id || '',
    title,
  };
}

export async function listSessions(cwd: string): Promise<string[]> {
  const summaries = await listSessionSummaries(cwd);
  return summaries.map((summary) => summary.id);
}

function getMessageText(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content.trim();
  }

  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cwdLabel(cwd: string): string {
  const home = homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(home + '/')) return '~/' + cwd.slice(home.length + 1);
  return cwd;
}

function extractModel(session: Session): string | undefined {
  // Check metadata on entries for model info
  for (const entry of session.entries) {
    const model = entry.metadata?.model as string | undefined;
    if (model) return model;
  }
  return undefined;
}

function summarizeSession(session: Session): SessionSummary {
  const activeMessages = getActiveMessages(session);
  const firstEntry = session.entries[0];
  const lastEntry = session.entries[session.entries.length - 1];

  let title = session.title || '';
  if (!title) {
    const firstUserMessage = activeMessages.find((message) => message.role === 'user');
    const rawTitle = firstUserMessage ? getMessageText(firstUserMessage) : '';
    title = rawTitle ? rawTitle.slice(0, 72) : 'Untitled session';
  }

  return {
    id: session.id,
    cwd: session.cwd,
    cwdLabel: cwdLabel(session.cwd),
    createdAt: firstEntry?.timestamp ?? 0,
    updatedAt: lastEntry?.timestamp ?? 0,
    entryCount: session.entries.length,
    activeMessageCount: activeMessages.length,
    title,
    model: extractModel(session),
  };
}

export async function listSessionSummaries(cwd: string): Promise<SessionSummary[]> {
  const dir = sessionDir(cwd);
  if (!existsSync(dir)) return [];

  const { readdir } = await import('node:fs/promises');
  const files = await readdir(dir);
  const sessionIds = files
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace('.jsonl', ''));

  const loaded = await Promise.all(sessionIds.map((sessionId) => loadSession(cwd, sessionId)));
  return loaded
    .filter((session): session is Session => Boolean(session))
    .map((session) => summarizeSession(session))
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export async function deleteSession(cwd: string, sessionId: string): Promise<boolean> {
  const dir = sessionDir(cwd);
  const path = join(dir, `${sessionId}.jsonl`);
  if (!existsSync(path)) return false;
  await unlink(path);
  return true;
}
