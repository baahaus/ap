import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { renderLine } from '@blushagent/tui';

/**
 * /diff -- Show uncommitted git changes with color.
 */
export function showDiff(): void {
  try {
    // Check if we're in a git repo
    execSync('git rev-parse --git-dir', { stdio: 'pipe' });
  } catch {
    renderLine(chalk.dim('Not a git repository.'));
    return;
  }

  // Get staged + unstaged diff
  let diff = '';
  try {
    const staged = execSync('git diff --cached --stat', { encoding: 'utf-8' }).trim();
    const unstaged = execSync('git diff --stat', { encoding: 'utf-8' }).trim();
    const fullDiff = execSync('git diff --cached && git diff', { encoding: 'utf-8', shell: 'bash' }).trim();

    if (!staged && !unstaged) {
      renderLine(chalk.dim('No uncommitted changes.'));
      return;
    }

    if (staged) {
      renderLine(chalk.bold.green('\nStaged:'));
      renderLine(staged);
    }

    if (unstaged) {
      renderLine(chalk.bold.yellow('\nUnstaged:'));
      renderLine(unstaged);
    }

    if (fullDiff) {
      renderLine(chalk.dim('\n' + '\u2500'.repeat(40)));

      // Colorize diff output
      for (const line of fullDiff.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          renderLine(chalk.green(line));
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          renderLine(chalk.red(line));
        } else if (line.startsWith('@@')) {
          renderLine(chalk.cyan(line));
        } else if (line.startsWith('diff ')) {
          renderLine(chalk.bold.white(line));
        } else {
          renderLine(chalk.dim(line));
        }
      }
    }

    renderLine('');
  } catch (err) {
    renderLine(chalk.red(`Error: ${(err as Error).message}`));
  }
}
