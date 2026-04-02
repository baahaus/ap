import chalk from 'chalk';
import { getTheme } from './themes.js';
import { sym } from './symbols.js';

/**
 * Render a warm floating card overlay for /btw responses.
 * Uses rounded box drawing for personality.
 */
export function renderOverlay(content: string, title?: string): void {
  const theme = getTheme();
  const maxWidth = Math.min(process.stdout.columns || 80, 64);
  const innerWidth = maxWidth - 4;

  // Header
  const headerLabel = title || 'btw';
  const headerLen = maxWidth - headerLabel.length - 5;
  process.stderr.write('\n');
  process.stderr.write(
    chalk.hex(theme.border)(
      `  ${sym.boxTL}${sym.boxH} ${chalk.hex(theme.accent)(headerLabel)} ${sym.boxH.repeat(Math.max(1, headerLen))}${sym.boxTR}\n`,
    ),
  );

  // Content lines with word wrapping
  const wrapped = wordWrap(content, innerWidth);
  process.stderr.write(
    chalk.hex(theme.border)(`  ${sym.boxV}`) + ' '.repeat(innerWidth + 1) + chalk.hex(theme.border)(sym.boxV) + '\n',
  );
  for (const line of wrapped) {
    const padded = line.padEnd(innerWidth);
    process.stderr.write(
      chalk.hex(theme.border)(`  ${sym.boxV} `) + chalk.hex(theme.text)(padded) + chalk.hex(theme.border)(sym.boxV) + '\n',
    );
  }
  process.stderr.write(
    chalk.hex(theme.border)(`  ${sym.boxV}`) + ' '.repeat(innerWidth + 1) + chalk.hex(theme.border)(sym.boxV) + '\n',
  );

  // Footer
  process.stderr.write(
    chalk.hex(theme.border)(`  ${sym.boxBL}${sym.boxH.repeat(innerWidth + 1)}${sym.boxBR}\n`),
  );
  process.stderr.write(
    `  ${chalk.hex(theme.muted)('press any key to dismiss')}\n`,
  );
}

export async function showOverlayAndWait(content: string, title?: string): Promise<void> {
  renderOverlay(content, title);

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
      process.stderr.write('\r\x1b[K');
      resolve();
    };

    process.stdin.on('data', onData);
  });
}

function wordWrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length <= width) {
      lines.push(paragraph);
      continue;
    }

    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      if (current.length + word.length + 1 > width) {
        lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}
