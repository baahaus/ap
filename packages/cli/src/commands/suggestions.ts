import chalk from 'chalk';
import type { Message } from '@ap/ai';
import { renderLine } from '@ap/tui';

/**
 * Generate and display prompt suggestions after an agent response.
 * Uses the sidecar model for cheap generation.
 */
export async function showSuggestions(
  messages: Message[],
  provider: { complete: Function },
  model: string,
): Promise<void> {
  // Only suggest after a few exchanges
  if (messages.length < 2) return;

  try {
    // Get the last few messages for context
    const recentMessages = messages.slice(-4);
    const context = recentMessages
      .map((m) => {
        const text = typeof m.content === 'string'
          ? m.content.slice(0, 300)
          : m.content
              .filter((b) => b.type === 'text')
              .map((b) => (b.type === 'text' ? b.text : '').slice(0, 300))
              .join('');
        return `${m.role}: ${text}`;
      })
      .join('\n');

    const response = await (provider as any).complete({
      model,
      messages: [
        {
          role: 'user',
          content: `Based on this conversation, suggest 3 short follow-up prompts the user might want to type next. Each should be under 60 chars and be a natural next step.

${context}

Respond with exactly 3 lines, one suggestion per line. No numbering, no bullets, no quotes.`,
        },
      ],
      system: 'You suggest follow-up prompts. Be concise and practical. Focus on what would naturally come next in a coding session.',
      maxTokens: 150,
      temperature: 0.5,
    });

    const text = typeof response.message.content === 'string'
      ? response.message.content
      : response.message.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('');

    const suggestions = text.trim().split('\n')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0 && s.length < 80)
      .slice(0, 3);

    if (suggestions.length > 0) {
      renderLine(chalk.dim('\n  Suggestions:'));
      for (const s of suggestions) {
        renderLine(chalk.dim(`    ${chalk.cyan('>')} ${s}`));
      }
    }
  } catch {
    // Silently skip if sidecar unavailable
  }
}
