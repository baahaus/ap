import type { Provider, Message } from '@ap/ai';
import { renderOverlay } from '@ap/tui';

/**
 * /btw -- Ephemeral question.
 *
 * Full conversation context, zero tools, zero history pollution.
 * The inverse of a subagent: sees everything, can do nothing.
 * Response rendered in overlay, never added to session.
 */
export async function btw(
  question: string,
  messages: Message[],
  provider: Provider,
  model: string,
): Promise<void> {
  const response = await provider.complete({
    model,
    messages: [
      ...messages,
      { role: 'user', content: question },
    ],
    system: 'Answer the question concisely. You have no tools. Answer only from what you can see in the conversation.',
    maxTokens: 1024,
    temperature: 0,
  });

  const text = typeof response.message.content === 'string'
    ? response.message.content
    : response.message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('');

  renderOverlay(text);
}
