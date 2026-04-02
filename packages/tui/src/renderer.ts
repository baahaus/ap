import chalk from 'chalk';
import { getTheme } from './themes.js';
import { sym, rule, box } from './symbols.js';
import { appendTranscript, isLayoutActive, renderLayout, setFooterLines } from './layout.js';
import { pause } from './motion.js';

function metaLine(label: string, value: string): string {
  const theme = getTheme();
  return `  ${chalk.hex(theme.dim)(label)} ${chalk.hex(theme.text)(value)}`;
}

function inlineMeta(...pairs: Array<[string, string]>): string {
  const theme = getTheme();
  return `  ${pairs.map(([label, value]) =>
    `${chalk.hex(theme.dim)(label)} ${chalk.hex(theme.text)(value)}`,
  ).join(`  ${chalk.hex(theme.border)(sym.dot)}  `)}`;
}

// ─────────────────────────────────────────
// Core output primitives
// ─────────────────────────────────────────

export function renderText(text: string): void {
  if (isLayoutActive()) {
    appendTranscript(text);
    renderLayout();
    return;
  }
  process.stdout.write(text);
}

export function renderLine(text: string): void {
  renderText(text + '\n');
}

export function clearLine(): void {
  process.stdout.write('\r\x1b[K');
}

export function deleteLine(): void {
  process.stdout.write('\r\x1b[M');
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

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'burning the midnight oil?';
  if (hour < 9) return 'early bird gets the merge.';
  if (hour < 12) return 'good morning.';
  if (hour < 17) return 'good afternoon.';
  if (hour < 21) return 'good evening.';
  return 'night owl mode.';
}

const farewells = [
  'until next time.',
  'happy shipping.',
  'go build something great.',
  'see you soon.',
  'good work today.',
  'take care out there.',
];

export async function renderWelcome(
  version: string,
  model: string,
  project = 'workspace',
  session = 'new session',
): Promise<void> {
  const theme = getTheme();
  const w = Math.min(process.stdout.columns || 80, 68);

  const lines = [
    '',
    `  ${chalk.hex(theme.prompt).bold('blush')}  ${chalk.hex(theme.text).bold(timeGreeting())}`,
    `  ${chalk.hex(theme.dim)(`team cli agent from ap.haus ${sym.dot} v${version}`)}`,
    '',
    `  ${chalk.hex(theme.border)(rule(Math.max(12, w - 14), sym.thinRule))}`,
    '',
    metaLine('project', project),
    inlineMeta(['model', model], ['theme', theme.label]),
    metaLine('session', session),
    '',
    `  ${chalk.hex(theme.accent)('/model')} ${chalk.hex(theme.dim)('switch')}  ${chalk.hex(theme.border)(sym.dot)}  ${chalk.hex(theme.accent)('/theme')} ${chalk.hex(theme.dim)('style')}`,
    `  ${chalk.hex(theme.accent)('tab')} ${chalk.hex(theme.dim)('complete')}  ${chalk.hex(theme.border)(sym.dot)}  ${chalk.hex(theme.accent)('/help')} ${chalk.hex(theme.dim)('commands')}`,
    '',
  ];

  const bordered = box(lines.map((l) => l || ''), w);
  renderLine('');
  for (const [index, line] of bordered.entries()) {
    renderLine(chalk.hex(theme.border)(line));
    if (index < bordered.length - 1) {
      await pause(index < 2 ? 14 : 10);
    }
  }
  renderLine('');
}

/**
 * Graceful goodbye on exit -- warm sign-off.
 */
export function renderGoodbye(sessionId?: string): void {
  const theme = getTheme();
  const farewell = farewells[Math.floor(Math.random() * farewells.length)];

  renderLine('');
  if (sessionId) {
    renderLine(`  ${chalk.hex(theme.success)(sym.toolDone)} ${chalk.hex(theme.dim)(`session saved: ${sessionId}`)}`);
  }
  renderLine(`  ${chalk.hex(theme.prompt)(sym.prompt)} ${chalk.hex(theme.dim)(farewell)}`);
  renderLine('');
}

// ─────────────────────────────────────────
// Tool execution (progressive reveal)
// ─────────────────────────────────────────

export function renderToolStart(name: string, detail?: string): void {
  const theme = getTheme();
  renderLine(`  ${chalk.hex(theme.accent)(name)}  ${chalk.hex(theme.dim)(detail || 'working')}`);
}

export function renderToolEnd(name: string, result: string): void {
  const theme = getTheme();

  // Compute a compact summary
  const lineCount = result.split('\n').length;
  let summary: string;

  if (name === 'edit' && result.toLowerCase().includes('applied')) {
    summary = 'applied';
  } else if (lineCount > 1) {
    summary = `${lineCount} lines`;
  } else {
    summary = result.slice(0, 50).trim() || 'done';
  }

  renderLine(`  ${chalk.hex(theme.success)(name)}  ${chalk.hex(theme.dim)(summary)}`);
}

export function renderToolError(name: string, error: string): void {
  const theme = getTheme();
  renderLine(`  ${chalk.hex(theme.error)(name)}  ${chalk.hex(theme.error)(error)}`);
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
    renderLine(`    ${chalk.hex(theme.border)(sym.boxV)} ${chalk.hex(theme.dim)(line)}`);
  }
  if (lines.length > 12) {
    renderLine(
      `    ${chalk.hex(theme.border)(sym.boxV)} ${chalk.hex(theme.muted)(`${sym.ellipsis} ${lines.length - 12} more lines`)}`,
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
  renderLine(`  ${chalk.hex(theme.error)('error')}  ${chalk.hex(theme.error)(error)}`);
}

export function renderSuccess(message: string): void {
  const theme = getTheme();
  renderLine(`  ${chalk.hex(theme.success)('done')}  ${chalk.hex(theme.text)(message)}`);
}

export function renderWarning(message: string): void {
  const theme = getTheme();
  renderLine(`  ${chalk.hex(theme.warning)('note')}  ${chalk.hex(theme.warning)(message)}`);
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
    .map(([k, v]) => `${chalk.hex(theme.dim)(k)} ${chalk.hex(theme.text)(v)}`)
    .join(` ${chalk.hex(theme.border)(sym.dot)} `);
  if (isLayoutActive()) {
    setFooterLines([
      `  ${chalk.hex(theme.border)(rule(Math.min(process.stdout.columns || 80, 28), sym.thinRule))}`,
      `  ${items}`,
    ]);
    renderLayout();
    return;
  }
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
