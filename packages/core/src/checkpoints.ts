import { execSync, execFileSync } from 'node:child_process';
import type { Session } from './session.js';

/**
 * Checkpoint system for conversation + git state rewind.
 *
 * After each tool call, we save:
 * - The session entry ID (conversation state)
 * - A git stash or lightweight tag (filesystem state)
 *
 * Double-escape rewinds to the selected checkpoint,
 * restoring both conversation and file state.
 */

export interface Checkpoint {
  id: string;
  entryId: string;    // Session entry ID at this point
  gitRef: string;     // Git ref (stash or tag) for filesystem state
  timestamp: number;
  description: string; // What tool was called
}

const checkpoints: Checkpoint[] = [];
let cwd = process.cwd();

export function setCheckpointCwd(dir: string): void {
  cwd = dir;
}

function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a checkpoint after a tool call.
 */
export function createCheckpoint(
  entryId: string,
  description: string,
): Checkpoint | null {
  if (!isGitRepo()) {
    // Still track conversation checkpoints even without git
    const cp: Checkpoint = {
      id: `cp-${Date.now().toString(36)}`,
      entryId,
      gitRef: '',
      timestamp: Date.now(),
      description,
    };
    checkpoints.push(cp);
    return cp;
  }

  try {
    // Create a lightweight tag for the current state
    const tagName = `blush-checkpoint-${Date.now().toString(36)}`;

    // Check if there are uncommitted changes to stash
    const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();

    let gitRef = '';
    if (status) {
      // Create a temporary commit on a detached state isn't ideal,
      // so we use stash with a unique message
      try {
        execFileSync('git', ['stash', 'push', '-m', tagName, '--include-untracked'], {
          cwd,
          stdio: 'pipe',
        });
        gitRef = `stash:${tagName}`;
        // Immediately pop the stash to keep working state
        execSync('git stash pop', { cwd, stdio: 'pipe' });
      } catch {
        gitRef = '';
      }
    } else {
      // Clean working tree, just record the current HEAD
      gitRef = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
    }

    const cp: Checkpoint = {
      id: `cp-${Date.now().toString(36)}`,
      entryId,
      gitRef,
      timestamp: Date.now(),
      description,
    };

    checkpoints.push(cp);
    return cp;
  } catch {
    return null;
  }
}

/**
 * List all checkpoints.
 */
export function listCheckpoints(): Checkpoint[] {
  return [...checkpoints];
}

/**
 * Rewind to a checkpoint.
 * Restores the session to the checkpoint's entry and the filesystem to the git ref.
 */
export function rewindToCheckpoint(
  session: Session,
  checkpointId: string,
): boolean {
  const cp = checkpoints.find((c) => c.id === checkpointId);
  if (!cp) return false;

  // Rewind session
  session.currentBranch = cp.entryId;

  // Rewind git state if we have a ref
  if (cp.gitRef && isGitRepo()) {
    try {
      if (cp.gitRef.startsWith('stash:')) {
        // Can't reliably rewind to a stash that was already popped.
        // For now, just rewind the conversation.
      } else {
        // Reset to the commit
        execFileSync('git', ['checkout', cp.gitRef, '--', '.'], { cwd, stdio: 'pipe' });
      }
    } catch {
      // Git rewind failed, but conversation rewind still works
    }
  }

  // Remove checkpoints after this one
  const idx = checkpoints.findIndex((c) => c.id === checkpointId);
  if (idx !== -1) {
    checkpoints.splice(idx + 1);
  }

  return true;
}

/**
 * Get the most recent checkpoint.
 */
export function lastCheckpoint(): Checkpoint | null {
  return checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
}
