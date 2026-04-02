import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

// vi.hoisted runs at mock-hoist time, so TEST_HOME is available for vi.mock
const TEST_HOME = vi.hoisted(() => {
  // Use createRequire since we're in ESM but need sync fs at hoist time
  const { mkdtempSync } = require('node:fs');
  return mkdtempSync('/tmp/blush-team-test-') as string;
});

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return { ...original, homedir: () => TEST_HOME };
});

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { sendMessage, readMessages, markRead } from './mailbox.js';
import {
  createTask,
  claimTask,
  completeTask,
  listTasks,
  getAvailableTasks,
} from './taskqueue.js';

const cleanupDirs: string[] = [TEST_HOME];

afterEach(() => {
  const teamDir = join(TEST_HOME, '.blush', 'team');
  if (existsSync(teamDir)) {
    rmSync(teamDir, { recursive: true, force: true });
  }
});

afterAll(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('mailbox', () => {
  const sessionId = 'test-session-1';

  it('sends and reads a message', async () => {
    await sendMessage(sessionId, 'alice', 'bob', 'request', 'do the thing');
    const msgs = await readMessages(sessionId, 'bob');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from).toBe('alice');
    expect(msgs[0].to).toBe('bob');
    expect(msgs[0].type).toBe('request');
    expect(msgs[0].payload).toBe('do the thing');
    expect(msgs[0].read).toBe(false);
  });

  it('filters read messages when unreadOnly is true', async () => {
    const msg = await sendMessage(sessionId, 'alice', 'bob', 'request', 'first');
    await sendMessage(sessionId, 'alice', 'bob', 'request', 'second');

    await markRead(sessionId, 'bob', msg.id);

    const unread = await readMessages(sessionId, 'bob', true);
    expect(unread).toHaveLength(1);
    expect(unread[0].payload).toBe('second');

    const all = await readMessages(sessionId, 'bob', false);
    expect(all).toHaveLength(2);
  });

  it('markRead persists to file', async () => {
    const msg = await sendMessage(sessionId, 'alice', 'bob', 'request', 'test');
    await markRead(sessionId, 'bob', msg.id);

    const msgs = await readMessages(sessionId, 'bob', false);
    const updated = msgs.find((m) => m.id === msg.id);
    expect(updated?.read).toBe(true);
  });

  it('returns empty for nonexistent agent', async () => {
    const msgs = await readMessages(sessionId, 'nobody');
    expect(msgs).toEqual([]);
  });

  it('returns messages in timestamp order', async () => {
    await sendMessage(sessionId, 'alice', 'bob', 'request', 'first');
    await new Promise((r) => setTimeout(r, 5));
    await sendMessage(sessionId, 'alice', 'bob', 'request', 'second');

    const msgs = await readMessages(sessionId, 'bob');
    expect(msgs[0].payload).toBe('first');
    expect(msgs[1].payload).toBe('second');
    expect(msgs[0].timestamp).toBeLessThanOrEqual(msgs[1].timestamp);
  });
});

describe('taskqueue', () => {
  const sessionId = 'test-tasks-1';

  it('creates a pending task', async () => {
    const task = await createTask(sessionId, 'Fix bug', 'The login is broken', 'alice');
    expect(task.title).toBe('Fix bug');
    expect(task.status).toBe('pending');
    expect(task.createdBy).toBe('alice');
    expect(task.assignedTo).toBeNull();
  });

  it('creates a blocked task when dependencies exist', async () => {
    const dep = await createTask(sessionId, 'First', 'do first', 'alice');
    const blocked = await createTask(sessionId, 'Second', 'do second', 'alice', [dep.id]);
    expect(blocked.status).toBe('blocked');
    expect(blocked.dependencies).toEqual([dep.id]);
  });

  it('claims a pending task', async () => {
    const task = await createTask(sessionId, 'Fix', 'broken', 'alice');
    const claimed = await claimTask(sessionId, task.id, 'bob');
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.assignedTo).toBe('bob');
  });

  it('rejects claiming an already-claimed task', async () => {
    const task = await createTask(sessionId, 'Fix', 'broken', 'alice');
    await claimTask(sessionId, task.id, 'bob');
    const second = await claimTask(sessionId, task.id, 'charlie');
    expect(second).toBeNull();
  });

  it('completeTask unblocks dependent tasks', async () => {
    const first = await createTask(sessionId, 'First', 'first thing', 'alice');
    const second = await createTask(sessionId, 'Second', 'depends on first', 'alice', [first.id]);

    let tasks = await listTasks(sessionId);
    expect(tasks.find((t) => t.id === second.id)?.status).toBe('blocked');

    await completeTask(sessionId, first.id, 'done');

    tasks = await listTasks(sessionId);
    expect(tasks.find((t) => t.id === first.id)?.status).toBe('done');
    expect(tasks.find((t) => t.id === second.id)?.status).toBe('pending');
  });

  it('getAvailableTasks returns only pending tasks', async () => {
    await createTask(sessionId, 'Pending', 'waiting', 'alice');
    const claimed = await createTask(sessionId, 'WillClaim', 'will be claimed', 'alice');
    await claimTask(sessionId, claimed.id, 'bob');

    const available = await getAvailableTasks(sessionId);
    expect(available).toHaveLength(1);
    expect(available[0].title).toBe('Pending');
  });

  it('listTasks returns all tasks', async () => {
    await createTask(sessionId, 'A', 'a', 'alice');
    await createTask(sessionId, 'B', 'b', 'bob');
    const tasks = await listTasks(sessionId);
    expect(tasks).toHaveLength(2);
  });
});

describe('worktree', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync('/tmp/blush-worktree-test-');
    cleanupDirs.push(repoDir);
    execSync('git init && git commit --allow-empty -m "init"', { cwd: repoDir, stdio: 'pipe' });
  });

  it('creates a worktree with a branch', async () => {
    const { createWorktree } = await import('./worktree.js');
    const wt = createWorktree(repoDir, 'alpha');
    expect(existsSync(wt.path)).toBe(true);
    expect(wt.branch).toContain('blush-agent/alpha-');

    const branches = execSync('git branch', { cwd: repoDir, encoding: 'utf-8' });
    expect(branches).toContain('blush-agent/alpha-');
    wt.cleanup();
  });

  it('throws for non-git directory', async () => {
    const { createWorktree } = await import('./worktree.js');
    const notGit = mkdtempSync('/tmp/not-git-');
    cleanupDirs.push(notGit);
    expect(() => createWorktree(notGit, 'test')).toThrow('Not a git repository');
  });

  it('merges worktree changes back to main', async () => {
    const { createWorktree, mergeWorktree } = await import('./worktree.js');
    const wt = createWorktree(repoDir, 'merger');

    execSync('echo "hello" > test.txt && git add . && git commit -m "add test"', {
      cwd: wt.path,
      stdio: 'pipe',
    });

    wt.cleanup();
    const result = mergeWorktree(repoDir, wt.branch);
    expect(result.success).toBe(true);
    expect(existsSync(join(repoDir, 'test.txt'))).toBe(true);
  });
});
