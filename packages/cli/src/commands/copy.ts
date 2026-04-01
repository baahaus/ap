import chalk from 'chalk';
import { execSync } from 'node:child_process';
import type { Message, ContentBlock } from '@ap/ai';
import { renderLine, renderError } from '@ap/tui';

function extractText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:\w*)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function copyToClipboard(text: string): boolean {
  try {
    // macOS
    execSync('pbcopy', { input: text, stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    try {
      // Linux
      execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'pipe', 'pipe'] });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * /copy [N] -- Copy the Nth-latest assistant response to clipboard.
 * If the response contains code blocks, copies just the code.
 * Default: most recent response.
 */
export function copy(args: string, messages: Message[]): void {
  const n = args.trim() ? parseInt(args.trim(), 10) : 1;

  // Get assistant messages in reverse order
  const assistantMessages = messages
    .filter((m) => m.role === 'assistant')
    .reverse();

  if (assistantMessages.length === 0) {
    renderError('No assistant responses to copy.');
    return;
  }

  const idx = Math.max(0, Math.min(n - 1, assistantMessages.length - 1));
  const message = assistantMessages[idx];
  const text = extractText(message);

  // Check for code blocks
  const codeBlocks = extractCodeBlocks(text);

  let toCopy: string;
  if (codeBlocks.length === 1) {
    toCopy = codeBlocks[0];
    renderLine(chalk.dim('Copied code block to clipboard.'));
  } else if (codeBlocks.length > 1) {
    // Copy all code blocks joined
    toCopy = codeBlocks.join('\n\n');
    renderLine(chalk.dim(`Copied ${codeBlocks.length} code blocks to clipboard.`));
  } else {
    toCopy = text;
    renderLine(chalk.dim('Copied response to clipboard.'));
  }

  if (!copyToClipboard(toCopy)) {
    renderError('Failed to copy. No clipboard tool found (pbcopy/xclip).');
    renderLine(chalk.dim('Response text:'));
    renderLine(toCopy.slice(0, 200) + (toCopy.length > 200 ? '...' : ''));
  }
}
