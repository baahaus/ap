import type { Provider, Message } from '@blushagent/ai';
import { addEntry, type Session } from '@blushagent/core';
import { renderDim, renderLine, renderError, getTheme, sym } from '@blushagent/tui';
import chalk from 'chalk';

/**
 * /compact [focus] -- Compress conversation with optional focus instructions.
 *
 * Uses a cheap model to summarize the conversation, then replaces
 * the message history with the summary. Preserves full JSONL history.
 */
export async function compact(
  session: Session,
  provider: Provider,
  model: string,
  focus?: string,
): Promise<void> {
  const { getActiveMessages } = await import('@blushagent/core');
  const messages = getActiveMessages(session);

  if (messages.length < 4) {
    renderError('Not enough messages to compact.');
    return;
  }

  const focusInstr = focus
    ? `Focus the summary on: ${focus}`
    : '';

  const summaryRequest = {
    model,
    messages: [
      ...messages,
      {
        role: 'user' as const,
        content: `Summarize this conversation so far in a way that preserves all important context, decisions, file paths, and code changes. Be thorough but concise. ${focusInstr}`,
      },
    ],
    system: 'You are a conversation summarizer. Produce a structured summary preserving all technical details, file paths, decisions, and context.',
    maxTokens: 4096,
  };

  const response = await provider.complete(summaryRequest);

  const summaryText = typeof response.message.content === 'string'
    ? response.message.content
    : response.message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('');

  // Create a new branch point with the summary as a single user message
  const summaryMessage: Message = {
    role: 'user',
    content: `[Conversation compacted. Summary of ${messages.length} messages]\n\n${summaryText}\n\n---\nContinue from here.`,
  };

  // Branch instead of destroying -- old messages stay in JSONL
  const branchId = `compact-${Date.now().toString(36)}`;
  session.currentBranch = branchId;
  addEntry(session, summaryMessage);

  const theme = getTheme();
  renderLine(`  ${chalk.hex(theme.success)(sym.toolDone)} ${chalk.hex(theme.dim)(`${messages.length} messages`)} ${chalk.hex(theme.muted)(sym.arrow)} ${chalk.hex(theme.dim)('summary')}`);
}
