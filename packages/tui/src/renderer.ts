import chalk from 'chalk';
import { getTheme } from './themes.js';
import { sym, dotLeader, rule, box } from './symbols.js';

// ─────────────────────────────────────────
// Core output primitives
// ─────────────────────────────────────────

export function renderText(text: string): void {
  process.stdout.write(text);
}

export function renderLine(text: string): void {
  process.stdout.write(text + '\n');
}

export function clearLine(): void {
  process.stdout.write('\r\x1b[K');
}

export function moveCursorUp(n = 1): void {
  process.stdout.write(`\x1b[${n}A`);
}

// ─────────────────────────────────────────
// Branded prompt
// ─────────────────────────────────────────

export function renderPrompt(color?: string): void {
  const theme = getTheme();
  const colorFn = color ? chalk.hex(color) : chalk.hex(theme.prompt);
  process.stdout.write(colorFn(`\n${sym.prompt} `));
}

// ─────────────────────────────────────────
// Welcome banner
// ─────────────────────────────────────────

export function renderWelcome(version: string, model: string): void {
  const theme = getTheme();
  const w = Math.min(process.stdout.columns || 80, 56);

  const lines = [
    '',
    `${chalk.hex(theme.prompt).bold('blush')} ${chalk.hex(theme.dim)(`v${version}`)}`,
    '',
    chalk.hex(theme.dim)(dotLeader('model', model, w - 6)),
    chalk.hex(theme.dim)(dotLeader('theme', theme.label, w - 6)),
    '',
    chalk.hex(theme.muted)(`${sym.prompt} type to chat ${sym.dot} /help for commands`),
    '',
  ];

  const bordered = box(lines.map((l) => l || ''), w);
  renderLine('');
  for (const line of bordered) {
    renderLine(chalk.hex(theme.border)(line));
  }
  renderLine('');
}

// ─────────────────────────────────────────
// Tool execution (progressive reveal)
// ─────────────────────────────────────────

export function renderToolStart(name: string, detail?: string): void {
  const theme = getTheme();
  const detailStr = detail ? chalk.hex(theme.muted)(` ${detail}`) : '';
  process.stderr.write(
    `\n  ${chalk.hex(theme.accent)(sym.toolRun)} ${chalk.hex(theme.dim)(name)}${detailStr} `,
  );
}

export function renderToolEnd(name: string, result: string): void {
  const theme = getTheme();

  // Compute a compact summary
  const lineCount = result.split('\n').length;
  const summary = lineCount > 1 ? `${lineCount} lines` : result.slice(0, 40).trim();

  process.stderr.write(
    `${chalk.hex(theme.success)(sym.toolDone)} ${chalk.hex(theme.muted)(summary)}\n`,
  );
}

export function renderToolError(name: string, error: string): void {
  const theme = getTheme();
  process.stderr.write(
    `${chalk.hex(theme.error)(sym.toolFail)} ${chalk.hex(theme.error)(error)}\n`,
  );
}

/**
 * Render a tool result in progressive-reveal style.
 * Shows compact summary by default. Full output available if expanded.
 */
export function renderToolResult(name: string, result: string, expanded = false): void {
  const theme = getTheme();
  const lines = result.split('\n');

  if (!expanded || lines.length <= 3) {
    return; // Default: collapsed, summary already shown by renderToolEnd
  }

  // Expanded view: show content with left border
  const preview = lines.slice(0, 12);
  for (const line of preview) {
    process.stderr.write(
      `    ${chalk.hex(theme.border)(sym.boxV)} ${chalk.hex(theme.dim)(line)}\n`,
    );
  }
  if (lines.length > 12) {
    process.stderr.write(
      `    ${chalk.hex(theme.border)(sym.boxV)} ${chalk.hex(theme.muted)(`${sym.ellipsis} ${lines.length - 12} more lines`)}\n`,
    );
  }
}

// ─────────────────────────────────────────
// Markdown rendering
// ─────────────────────────────────────────

export function renderMarkdown(text: string): string {
  const theme = getTheme();
  let result = text;

  // Fenced code blocks
  result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const header = lang
      ? `${chalk.hex(theme.border)(sym.boxTL)}${chalk.hex(theme.border)(sym.boxH.repeat(2))} ${chalk.hex(theme.muted)(lang)} ${chalk.hex(theme.border)(sym.boxH.repeat(20))}`
      : chalk.hex(theme.border)(rule(30, sym.thinRule));
    const footer = chalk.hex(theme.border)(rule(30, sym.thinRule));
    const codeLines = code.trimEnd().split('\n')
      .map((line: string) => `  ${chalk.hex(theme.text)(line)}`)
      .join('\n');
    return `${header}\n${codeLines}\n${footer}`;
  });

  // Inline code
  result = result.replace(/`([^`]+)`/g, (_match, code) =>
    chalk.hex(theme.accent)(code),
  );

  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, (_match, inner) =>
    chalk.hex(theme.text).bold(inner),
  );

  // Italic
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_match, inner) =>
    chalk.hex(theme.text).italic(inner),
  );

  // Headers
  result = result.replace(/^(#{1,3})\s+(.+)$/gm, (_match, hashes, heading) => {
    const level = hashes.length;
    if (level === 1) return chalk.hex(theme.prompt).bold(heading);
    if (level === 2) return chalk.hex(theme.accent).bold(heading);
    return chalk.hex(theme.text).bold(heading);
  });

  // Bullet lists
  result = result.replace(/^(\s*)[-*]\s+(.+)$/gm, (_match, indent, item) =>
    `${indent}  ${chalk.hex(theme.prompt)(sym.bullet)} ${item}`,
  );

  // Numbered lists
  result = result.replace(/^(\s*)\d+\.\s+(.+)$/gm, (_match, indent, item) =>
    `${indent}  ${chalk.hex(theme.dim)(sym.prompt)} ${item}`,
  );

  // Horizontal rules
  result = result.replace(/^---$/gm, () =>
    chalk.hex(theme.muted)(rule(40, sym.thinRule)),
  );

  // Links (show URL in dim after text)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) =>
    `${chalk.hex(theme.accent)(linkText)} ${chalk.hex(theme.muted)(`(${url})`)}`,
  );

  return result;
}

// ─────────────────────────────────────────
// Status & info rendering
// ─────────────────────────────────────────

export function renderError(error: string): void {
  const theme = getTheme();
  process.stderr.write(
    `\n  ${chalk.hex(theme.error)(sym.toolFail)} ${chalk.hex(theme.error)(error)}\n`,
  );
}

export function renderSuccess(message: string): void {
  const theme = getTheme();
  process.stderr.write(
    `  ${chalk.hex(theme.success)(sym.toolDone)} ${chalk.hex(theme.text)(message)}\n`,
  );
}

export function renderWarning(message: string): void {
  const theme = getTheme();
  process.stderr.write(
    `  ${chalk.hex(theme.warning)('!')} ${chalk.hex(theme.warning)(message)}\n`,
  );
}

export function renderDim(message: string): void {
  const theme = getTheme();
  renderLine(chalk.hex(theme.dim)(message));
}

/**
 * Status bar showing session metrics.
 * Rendered after each response.
 */
export function renderStatus(parts: Record<string, string>): void {
  const theme = getTheme();
  const items = Object.entries(parts)
    .map(([k, v]) => `${chalk.hex(theme.muted)(k)} ${chalk.hex(theme.dim)(v)}`)
    .join(chalk.hex(theme.muted)(` ${sym.dot} `));
  process.stderr.write(`\r\x1b[K  ${items}\n`);
}

/**
 * Context usage meter -- visual bar showing how full the context window is.
 */
export function renderContextMeter(used: number, total: number, width = 30): void {
  const theme = getTheme();
  const ratio = Math.min(used / total, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  const color = ratio > 0.9 ? theme.error
    : ratio > 0.7 ? theme.warning
    : theme.accent;

  const bar = chalk.hex(color)(sym.progressFull.repeat(filled))
    + chalk.hex(theme.muted)(sym.progressEmpty.repeat(empty));

  const pct = `${Math.round(ratio * 100)}%`;
  renderLine(`  ${bar} ${chalk.hex(theme.dim)(pct)} ${chalk.hex(theme.muted)(`(${formatTokens(used)}/${formatTokens(total)})`)}`);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ─────────────────────────────────────────
// Section dividers
// ─────────────────────────────────────────

export function renderDivider(label?: string): void {
  const theme = getTheme();
  const w = Math.min(process.stdout.columns || 80, 60);

  if (label) {
    const leftLen = 3;
    const rightLen = Math.max(2, w - leftLen - label.length - 4);
    renderLine(
      `  ${chalk.hex(theme.border)(sym.boxH.repeat(leftLen))} ${chalk.hex(theme.dim)(label)} ${chalk.hex(theme.border)(sym.boxH.repeat(rightLen))}`,
    );
  } else {
    renderLine(`  ${chalk.hex(theme.muted)(rule(w - 4, sym.thinRule))}`);
  }
}

// ─────────────────────────────────────────
// Help & commands
// ─────────────────────────────────────────

export function renderHelp(commands: Array<[string, string]>): void {
  const theme = getTheme();
  const maxCmd = Math.max(...commands.map(([cmd]) => cmd.length));

  for (const [cmd, desc] of commands) {
    renderLine(
      `  ${chalk.hex(theme.accent)(cmd.padEnd(maxCmd + 2))} ${chalk.hex(theme.dim)(desc)}`,
    );
  }
}

// ─────────────────────────────────────────
// Team status rendering
// ─────────────────────────────────────────

export function renderTeamStatus(
  agents: Array<{ name: string; status: string; branch: string }>,
): void {
  const theme = getTheme();

  for (const agent of agents) {
    const statusColor = agent.status === 'working' ? theme.warning
      : agent.status === 'done' ? theme.success
      : theme.text;
    const icon = agent.status === 'working' ? sym.spinner[0]
      : agent.status === 'done' ? sym.toolDone
      : sym.bullet;

    renderLine(
      `  ${chalk.hex(statusColor)(icon)} ${chalk.hex(theme.text).bold(agent.name)} ${chalk.hex(theme.muted)(agent.branch)}`,
    );
  }
}
