import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

export interface Worktree {
  path: string;
  branch: string;
  cleanup: () => void;
}

/**
 * Create an isolated git worktree for an agent.
 * Each agent gets a full copy of the repo on a temporary branch.
 */
export function createWorktree(repoPath: string, agentName: string): Worktree {
  // Verify we're in a git repo
  try {
    execSync('git rev-parse --git-dir', { cwd: repoPath, stdio: 'pipe' });
  } catch {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  const branch = `ap-agent/${agentName}-${Date.now().toString(36)}`;
  const worktreeDir = mkdtempSync(join(tmpdir(), `ap-${agentName}-`));

  try {
    // Create worktree with new branch from HEAD
    execSync(
      `git worktree add -b "${branch}" "${worktreeDir}" HEAD`,
      { cwd: repoPath, stdio: 'pipe' },
    );
  } catch (err) {
    rmSync(worktreeDir, { recursive: true, force: true });
    throw new Error(`Failed to create worktree: ${(err as Error).message}`);
  }

  return {
    path: worktreeDir,
    branch,
    cleanup: () => {
      try {
        // Check if there are changes
        const status = execSync('git status --porcelain', {
          cwd: worktreeDir,
          encoding: 'utf-8',
        }).trim();

        if (status) {
          // Auto-commit changes before cleanup
          execSync('git add -A && git commit -m "ap-agent: auto-save on cleanup"', {
            cwd: worktreeDir,
            stdio: 'pipe',
          });
        }

        // Remove worktree
        execSync(`git worktree remove "${worktreeDir}" --force`, {
          cwd: repoPath,
          stdio: 'pipe',
        });
      } catch {
        // Force cleanup
        if (existsSync(worktreeDir)) {
          rmSync(worktreeDir, { recursive: true, force: true });
        }
        try {
          execSync('git worktree prune', { cwd: repoPath, stdio: 'pipe' });
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * Merge an agent's worktree branch back into the main branch.
 */
export function mergeWorktree(repoPath: string, branch: string): { success: boolean; output: string } {
  try {
    const output = execSync(`git merge "${branch}" --no-edit`, {
      cwd: repoPath,
      encoding: 'utf-8',
    });
    return { success: true, output };
  } catch (err) {
    return { success: false, output: (err as Error).message };
  }
}
