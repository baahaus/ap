import chalk from 'chalk';
import { getTheme } from './themes.js';
import { sym, rule, box } from './symbols.js';
import {
  appendTranscript,
  clearFooterLines,
  isLayoutActive,
  renderLayout,
  setFooterLines,
} from './layout.js';
import { pause, typeOut, drawRule, prefersReducedMotion } from './motion.js';

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

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return pick([
    'burning the midnight oil?',
    'the quiet hours.',
    'just us and the compiler.',
  ]);
  if (hour < 9) return pick([
    'early bird gets the merge.',
    'fresh start.',
    'morning. coffee first?',
  ]);
  if (hour < 12) return pick([
    'good morning.',
    'let\'s build something.',
    'morning. what are we working on?',
  ]);
  if (hour < 17) return pick([
    'good afternoon.',
    'afternoon. where were we?',
    'let\'s keep the momentum.',
  ]);
  if (hour < 21) return pick([
    'good evening.',
    'evening session.',
    'winding down or ramping up?',
  ]);
  return pick([
    'night owl mode.',
    'late night. ship it?',
    'the best code happens after dark.',
  ]);
}

const farewells = [
  'until next time.',
  'happy shipping.',
  'go build something great.',
  'see you soon.',
  'good work today.',
  'take care out there.',
  'nice work.',
  'ship it.',
  'onwards.',
  'that was a good one.',
  'rest well.',
  'back at it whenever you are.',
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
    `  ${chalk.hex(theme.prompt).bold('blush')}  ${chalk.hex(theme.dim)(timeGreeting())}`,
    '',
    `  ${chalk.hex(theme.border)(rule(Math.max(12, w - 14), sym.thinRule))}`,
    '',
    `  ${chalk.hex(theme.muted)('project')}  ${chalk.hex(theme.text).bold(project)}`,
    `  ${chalk.hex(theme.muted)('model')}    ${chalk.hex(theme.accent)(model)}`,
    `  ${chalk.hex(theme.muted)('session')}  ${chalk.hex(theme.dim)(session)}`,
    '',
    `  ${chalk.hex(theme.dim)(`ap.haus ${sym.dot} v${version}`)}`,
    '',
  ];

  const bordered = box(lines.map((l) => l || ''), w);
  renderLine('');
  for (const [index, line] of bordered.entries()) {
    renderLine(chalk.hex(theme.border)(line));
    if (index < bordered.length - 1) {
      // First line (top border) gets a longer pause for "frame first" feel
      await pause(index === 0 ? 30 : 10);
    }
  }
  renderLine('');
}

/**
 * Graceful goodbye on exit -- warm sign-off with optional session receipt.
 */
export function renderGoodbye(sessionId?: string, stats?: {
  duration?: number;     // ms
  messages?: number;
  toolCalls?: number;
  tokens?: number;
}): void {
  const theme = getTheme();
  const farewell = pick(farewells);

  process.stderr.write('\n');
  if (stats) {
    const parts: string[] = [];
    if (stats.duration) {
      const mins = Math.floor(stats.duration / 60_000);
      const secs = Math.floor((stats.duration % 60_000) / 1000);
      parts.push(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
    }
    if (stats.messages) parts.push(`${stats.messages} messages`);
    if (stats.toolCalls) parts.push(`${stats.toolCalls} tools`);
    if (stats.tokens) parts.push(`${formatTokens(stats.tokens)} tokens`);
    if (parts.length > 0) {
      process.stderr.write(`  ${chalk.hex(theme.muted)(parts.join(`  ${sym.dot}  `))}\n`);
    }
  }
  if (sessionId) {
    process.stderr.write(`  ${chalk.hex(theme.muted)(`saved ${sym.dot} ${sessionId}`)}\n`);
  }
  process.stderr.write(`\n  ${chalk.hex(theme.dim)(farewell)}\n\n`);
}

// ─────────────────────────────────────────
// Tool execution (progressive reveal)
// ─────────────────────────────────────────

const toolGlyphs: Record<string, string> = {
  read: sym.toolRead,
  write: sym.toolWrite,
  edit: sym.toolEdit,
  bash: sym.toolBash,
  grep: sym.toolGrep,
  glob: sym.toolGlob,
  web_fetch: sym.toolWeb,
  web_search: sym.toolWeb,
  todo: sym.toolTodo,
};

interface ToolActivity {
  name: string;
  status: 'running' | 'done' | 'error';
  line: string;
}

const MAX_VISIBLE_TOOL_ACTIVITY = 6;
const toolTimers = new Map<string, number[]>();
const toolActivity: ToolActivity[] = [];

function startToolTimer(name: string): void {
  const timers = toolTimers.get(name) || [];
  timers.push(Date.now());
  toolTimers.set(name, timers);
}

function finishToolTimer(name: string): number {
  const timers = toolTimers.get(name) || [];
  const started = timers.pop();
  if (timers.length === 0) {
    toolTimers.delete(name);
  } else {
    toolTimers.set(name, timers);
  }
  return started ? Date.now() - started : 0;
}

function findLastRunningTool(name: string): number {
  for (let index = toolActivity.length - 1; index >= 0; index--) {
    const entry = toolActivity[index];
    if (entry?.name === name && entry.status === 'running') {
      return index;
    }
  }
  return -1;
}

function upsertToolActivity(entry: ToolActivity): void {
  const existingIndex = findLastRunningTool(entry.name);
  if (existingIndex >= 0) {
    toolActivity[existingIndex] = entry;
  } else {
    toolActivity.push(entry);
  }
  if (toolActivity.length > MAX_VISIBLE_TOOL_ACTIVITY) {
    toolActivity.splice(0, toolActivity.length - MAX_VISIBLE_TOOL_ACTIVITY);
  }
}

function renderToolActivityFooter(): void {
  if (!isLayoutActive()) return;
  if (toolActivity.length === 0) {
    clearFooterLines();
    renderLayout();
    return;
  }
  setFooterLines(toolActivity.map((entry) => entry.line));
  renderLayout();
}

export function clearToolActivity(): void {
  toolActivity.length = 0;
  toolTimers.clear();
  if (isLayoutActive()) {
    clearFooterLines();
    renderLayout();
  }
}

export function renderToolStart(name: string, detail?: string): void {
  const theme = getTheme();
  const glyph = toolGlyphs[name] || sym.toolRun;
  startToolTimer(name);
  const line = `  ${chalk.hex(theme.muted)(glyph)} ${chalk.hex(theme.dim)(name)}  ${chalk.hex(theme.muted)(detail || '')}`;
  if (isLayoutActive()) {
    upsertToolActivity({ name, status: 'running', line });
    renderToolActivityFooter();
    return;
  }
  renderLine(line);
}

export function renderToolEnd(name: string, result: string): void {
  const theme = getTheme();

  // Elapsed time
  const elapsed = finishToolTimer(name);
  const timeLabel = elapsed > 500 ? `  ${chalk.hex(theme.muted)(`${(elapsed / 1000).toFixed(1)}s`)}` : '';

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

  // End is confident -- bold name, accent checkmark, visible summary
  const line = `  ${chalk.hex(theme.accent)(sym.toolDone)} ${chalk.hex(theme.text).bold(name)}  ${chalk.hex(theme.dim)(summary)}${timeLabel}`;
  if (isLayoutActive()) {
    upsertToolActivity({ name, status: 'done', line });
    renderToolActivityFooter();
    return;
  }
  renderLine(line);
}

export function renderToolError(name: string, error: string): void {
  const theme = getTheme();
  finishToolTimer(name);
  const line = `  ${chalk.hex(theme.error)(sym.toolFail)} ${chalk.hex(theme.text).bold(name)}  ${chalk.hex(theme.error)(error)}`;
  if (isLayoutActive()) {
    upsertToolActivity({ name, status: 'error', line });
    renderToolActivityFooter();
    return;
  }
  renderLine(line);
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
  renderLine(`  ${chalk.hex(theme.error).bold(sym.toolFail)} ${chalk.hex(theme.error).bold('error')}  ${chalk.hex(theme.text)(error)}`);
}

export function renderSuccess(message: string): void {
  const theme = getTheme();
  renderLine(`  ${chalk.hex(theme.success)(sym.toolDone)} ${chalk.hex(theme.text).bold(message)}`);
}

export function renderWarning(message: string): void {
  const theme = getTheme();
  renderLine(`  ${chalk.hex(theme.warning).bold('!')} ${chalk.hex(theme.warning)(message)}`);
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
  toolActivity.length = 0;
  toolTimers.clear();
  const items = Object.entries(parts)
    .map(([k, v]) => `${chalk.hex(theme.muted)(k)} ${chalk.hex(theme.dim)(v)}`)
    .join(`  ${chalk.hex(theme.muted)(sym.dot)}  `);
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
 * Theme swatch -- shows a preview of key theme colors after switching.
 */
export async function renderThemeSwatch(): Promise<void> {
  const theme = getTheme();
  const block = '\u2588\u2588'; // two full blocks per color
  const colors = [theme.prompt, theme.accent, theme.text, theme.success, theme.error, theme.dim];

  if (prefersReducedMotion()) {
    renderLine(`  ${colors.map((c) => chalk.hex(c)(block)).join(' ')}`);
    return;
  }

  process.stderr.write('  ');
  for (const [i, color] of colors.entries()) {
    process.stderr.write(chalk.hex(color)(block));
    if (i < colors.length - 1) {
      process.stderr.write(' ');
      await pause(50);
    }
  }
  process.stderr.write('\n');
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

  // Contextual note at thresholds
  const note = ratio > 0.95 ? 'time to /compact'
    : ratio > 0.85 ? 'getting full'
    : '';
  const noteStr = note ? `  ${chalk.hex(ratio > 0.85 ? theme.warning : theme.muted)(note)}` : '';

  renderLine(`  ${bar} ${chalk.hex(theme.dim)(pct)} ${chalk.hex(theme.muted)(`(${formatTokens(used)}/${formatTokens(total)})`)}${noteStr}`);
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

  if (label) {
    renderLine(`  ${chalk.hex(theme.text).bold(label.toUpperCase())}`);
  } else {
    const w = Math.min(process.stdout.columns || 80, 60);
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
      `  ${chalk.hex(theme.accent).bold(cmd.padEnd(maxCmd + 2))} ${chalk.hex(theme.muted)(desc)}`,
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
