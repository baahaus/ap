import chalk from 'chalk';
import type { Message } from '@blushagent/ai';
import { renderLine } from '@blushagent/tui';

/**
 * /context -- Visualize context window usage.
 *
 * Shows a colored grid representing how the context window is being used:
 * system prompt, messages, tool results, available capacity.
 */
export function showContext(messages: Message[], model: string): void {
  // Rough token estimation (4 chars per token)
  const maxTokens = getModelContext(model);

  let systemTokens = 0;
  let userTokens = 0;
  let assistantTokens = 0;
  let toolTokens = 0;

  for (const msg of messages) {
    const text = typeof msg.content === 'string'
      ? msg.content
      : msg.content.map((b) => {
          if (b.type === 'text') return b.text;
          if (b.type === 'tool_result') return b.content;
          if (b.type === 'tool_use') return JSON.stringify(b.input);
          if (b.type === 'thinking') return b.text;
          return '';
        }).join('');

    const tokens = Math.ceil(text.length / 4);

    if (msg.role === 'user') {
      // Check if it's a tool result
      const isToolResult = typeof msg.content !== 'string' &&
        msg.content.some((b) => b.type === 'tool_result');
      if (isToolResult) {
        toolTokens += tokens;
      } else {
        userTokens += tokens;
      }
    } else {
      assistantTokens += tokens;
    }
  }

  // Estimate system prompt at ~250 tokens (under 1000 target)
  systemTokens = 250;
  const totalUsed = systemTokens + userTokens + assistantTokens + toolTokens;
  const remaining = maxTokens - totalUsed;
  const pct = (n: number) => Math.round((n / maxTokens) * 100);

  const width = process.stdout.columns || 80;
  const barWidth = width - 2;

  // Build proportional bar
  const segments = [
    { tokens: systemTokens, color: chalk.bgBlue, label: 'system' },
    { tokens: userTokens, color: chalk.bgGreen, label: 'user' },
    { tokens: assistantTokens, color: chalk.bgYellow, label: 'assistant' },
    { tokens: toolTokens, color: chalk.bgMagenta, label: 'tools' },
    { tokens: remaining, color: chalk.bgGray, label: 'available' },
  ];

  let bar = '';
  for (const seg of segments) {
    const chars = Math.max(0, Math.round((seg.tokens / maxTokens) * barWidth));
    bar += seg.color(' '.repeat(chars));
  }

  renderLine('');
  renderLine(bar);
  renderLine('');

  for (const seg of segments) {
    const indicator = seg.color('  ');
    renderLine(`  ${indicator} ${seg.label}: ~${seg.tokens.toLocaleString()} tokens (${pct(seg.tokens)}%)`);
  }

  renderLine('');
  renderLine(`  Total: ~${totalUsed.toLocaleString()} / ${maxTokens.toLocaleString()} tokens (${pct(totalUsed)}% used)`);
  renderLine('');
}

function getModelContext(model: string): number {
  if (model.includes('opus')) return 1_000_000;
  if (model.includes('sonnet')) return 200_000;
  if (model.includes('haiku')) return 200_000;
  if (model.includes('gpt-4o')) return 128_000;
  if (model.includes('o1') || model.includes('o3')) return 200_000;
  return 200_000; // sensible default
}
