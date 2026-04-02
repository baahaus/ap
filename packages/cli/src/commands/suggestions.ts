import chalk from 'chalk';
import { resolveProvider, type Message } from '@blush/ai';
import { renderLine, getTheme, sym, deleteLine, moveCursorUp, isLayoutActive } from '@blush/tui';

/** How many lines the last suggestion block took (0 = none shown) */
let lastSuggestionLines = 0;

/**
 * Clear previously rendered suggestions from the terminal.
 * Call this before rendering the next prompt.
 */
export function clearSuggestions(): void {
  clearSuggestionsBelowCursor(0);
}

export function clearSuggestionsBelowCursor(linesBelowCursor: number): void {
  if (isLayoutActive()) {
    lastSuggestionLines = 0;
    return;
  }
  if (lastSuggestionLines > 0) {
    moveCursorUp(lastSuggestionLines + linesBelowCursor);
    for (let i = 0; i < lastSuggestionLines; i++) {
      deleteLine();
    }
    lastSuggestionLines = 0;
  }
}

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
    const suggestionModel = (() => {
      try {
        return resolveProvider('claude-haiku-4-20250414');
      } catch {
        try {
          return resolveProvider('gpt-4o-mini');
        } catch {
          return { provider, model };
        }
      }
    })();

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

    const response = await (suggestionModel.provider as any).complete({
      model: suggestionModel.model,
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
      const theme = getTheme();
      let lines = 0;
      renderLine('');
      lines++;
      for (const s of suggestions) {
        renderLine(`  ${chalk.hex(theme.muted)(sym.prompt)} ${chalk.hex(theme.dim)(s)}`);
        lines++;
      }
      lastSuggestionLines = lines;
    }
  } catch {
    // Silently skip if sidecar unavailable
  }
}
