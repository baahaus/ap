import chalk from 'chalk';

/**
 * Render an overlay and wait for any keypress to dismiss.
 * Used by /btw for ephemeral responses.
 */
export function renderOverlay(content: string): void {
  const width = process.stdout.columns || 80;
  const border = chalk.dim('\u2500'.repeat(Math.min(width, 60)));

  process.stderr.write('\n' + border + '\n');
  process.stderr.write(chalk.yellow(content) + '\n');
  process.stderr.write(border + '\n');
  process.stderr.write(chalk.dim('(press any key to dismiss)'));
}

export async function showOverlayAndWait(content: string): Promise<void> {
  renderOverlay(content);

  // Wait for a single keypress
  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onData = () => {
      process.stdin.removeListener('data', onData);
      if (process.stdin.isTTY && wasRaw !== undefined) {
        process.stdin.setRawMode(wasRaw);
      }
      // Clear the dismiss hint
      process.stderr.write('\r\x1b[K\n');
      resolve();
    };

    process.stdin.on('data', onData);
  });
}
