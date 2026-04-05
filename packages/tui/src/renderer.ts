import chalk from 'chalk';
import { getTheme } from './themes.js';
import { sym, rule, box } from './symbols.js';
import {
  appendTranscript,
  clearFooterLines,
  isLayoutActive,
  renderLayout,
  setFooterLines,
  setHeaderLines,
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
  'go make something.',
  'that was a good one.',
  'see you tomorrow.',
  'don\'t forget to push.',
  'the code is better now.',
  'rest. you earned it.',
  'back whenever.',
  'left it better than we found it.',
  'onwards.',
  'save your work.',
  'good taste takes time.',
  'trust the process.',
];

// ─────────────────────────────────────────
// Animated gradient bar
// ─────────────────────────────────────────

let gradientTimer: ReturnType<typeof setInterval> | null = null;
let gradientPhase = 0;
const GRADIENT_ROWS = 4;

// Star shape: each row has its own curve exponent + threshold.
// High exponent = narrow spike (top/bottom points).
// Low exponent = wide spread (horizontal star points).
const ROW_CURVES = [
  { exp: 7, threshold: 0.20 },   // top point: sharp narrow spike
  { exp: 4, threshold: 0.15 },   // inner: medium
  { exp: 2.2, threshold: 0.08 }, // wider
  { exp: 1.0, threshold: 0.02 }, // horizontal points: very wide
];

/**
 * Start the breathing gradient animation.
 * A 3-row mirrored mountain of block shades with a bright pulse traveling through.
 * Renders through the layout system's header zone so it doesn't fight redraws.
 */
export function startGradientBreathing(_width?: number): void {
  if (prefersReducedMotion() || gradientTimer) return;

  gradientTimer = setInterval(() => {
    if (!isLayoutActive()) return;
    const w = (process.stdout.columns || 80) - 4;
    gradientPhase = (gradientPhase + 0.012) % 1.0;
    const theme = getTheme();
    const rows = animatedGradientBlock(w, theme.border, theme.prompt, gradientPhase);
    setHeaderLines(rows.map((r) => `  ${r}`));
    renderLayout();
  }, 33);
}

export function stopGradientBreathing(): void {
  if (gradientTimer) {
    clearInterval(gradientTimer);
    gradientTimer = null;
  }
}

/** 3-row gradient mountain with a traveling bright pulse. */
function animatedGradientBlock(width: number, baseColor: string, peakColor: string, phase: number): string[] {
  const shades = [' ', '░', '▒', '▓', '█'];
  const rows: string[] = [];

  for (let row = 0; row < GRADIENT_ROWS; row++) {
    const { exp, threshold } = ROW_CURVES[row];
    let line = '';

    for (let i = 0; i < width; i++) {
      const t = i / (width - 1);
      // Each row has its own curve: high exp = narrow, low exp = wide
      const baseIntensity = Math.pow(Math.sin(t * Math.PI), exp);
      // Traveling pulse: smooth gaussian-ish, wider than before
      const pulseDist = Math.min(Math.abs(t - phase), Math.abs(t - phase + 1), Math.abs(t - phase - 1));
      const pulseBoost = Math.exp(-pulseDist * pulseDist * 30) * 0.5;
      const intensity = Math.min(1, baseIntensity + pulseBoost);

      if (intensity < threshold) {
        line += ' ';
        continue;
      }

      // Map the excess above threshold to shade level
      const excess = (intensity - threshold) / (1 - threshold);
      const shadeIdx = Math.round(excess * (shades.length - 1));
      const shade = shades[Math.min(shadeIdx, shades.length - 1)];
      const colorT = Math.min(1, excess + pulseBoost * 2);
      const color = lerpColor(baseColor, peakColor, colorT);
      line += shade === ' ' ? ' ' : chalk.hex(color)(shade);
    }

    rows.push(line);
  }

  // Mirror: append rows in reverse for the bottom half
  for (let r = GRADIENT_ROWS - 1; r >= 0; r--) {
    rows.push(rows[r]);
  }

  return rows;
}

/**
 * Interpolate between two hex colors.
 */
function lerpColor(a: string, b: string, t: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(ar + (br - ar) * t);
  const g = clamp(ag + (bg - ag) * t);
  const bl = clamp(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

/**
 * Generate a gradient bar -- a warm pulse of color that rises and falls
 * across the terminal width. Uses block shade characters with per-character
 * truecolor interpolation. Like color rising to the surface.
 */
function gradientBar(width: number, fromColor: string, peakColor: string, toColor: string): string {
  const shades = [' ', '░', '▒', '▓', '█'];
  let result = '';
  for (let i = 0; i < width; i++) {
    const t = i / (width - 1); // 0 → 1
    // Bell curve: peak at center, fade at edges. Squared for sharper peak.
    const intensity = Math.pow(Math.sin(t * Math.PI), 2);
    const shadeIdx = Math.round(intensity * (shades.length - 1));
    const shade = shades[Math.min(shadeIdx, shades.length - 1)];
    // Smooth color: from → peak → to
    const color = t < 0.5
      ? lerpColor(fromColor, peakColor, t * 2)
      : lerpColor(peakColor, toColor, (t - 0.5) * 2);
    result += shade === ' ' ? ' ' : chalk.hex(color)(shade);
  }
  return result;
}

export async function renderWelcome(
  version: string,
  model: string,
  project = 'workspace',
  session = 'new session',
): Promise<void> {
  const theme = getTheme();
  const w = process.stdout.columns || 80;

  // Letter-spaced wordmark with gradient
  const wordmark = 'b l u s h'.split('').map((c, i) => {
    const t = i / 8;
    const color = lerpColor(theme.prompt, theme.accent, t);
    return c === ' ' ? ' ' : chalk.hex(color).bold(c);
  }).join('');

  const barWidth = w - 4;
  renderLine('');
  renderLine(`  ${wordmark}    ${chalk.hex(theme.dim)(timeGreeting())}`);
  renderLine('');
  renderLine(`  ${chalk.hex(theme.muted)('project')}  ${chalk.hex(theme.text).bold(project)}`);
  renderLine(`  ${chalk.hex(theme.muted)('model')}    ${chalk.hex(theme.accent)(model)}`);
  renderLine(`  ${chalk.hex(theme.muted)('session')}  ${chalk.hex(theme.dim)(session)}`);
  renderLine('');
  renderLine(`  ${chalk.hex(theme.dim)(`ap.haus ${sym.dot} v${version}`)}`);
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
// Tool execution (tool timeline)
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

// Tracks whether a no-newline start line was written in non-layout mode
// so the end/error handler knows to erase and overwrite it.
let nonLayoutToolInProgress = false;

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
  nonLayoutToolInProgress = false;
  if (isLayoutActive()) {
    clearFooterLines();
    renderLayout();
  }
}

/** Build the elapsed-time label. Silent <200ms, subtle 200ms-2s, prominent 2s+. */
function elapsedLabel(elapsed: number, theme: ReturnType<typeof getTheme>): string {
  if (elapsed >= 2000) return `  ${chalk.hex(theme.warning)(`${(elapsed / 1000).toFixed(1)}s`)}`;
  if (elapsed >= 200) return `  ${chalk.hex(theme.muted)(`${(elapsed / 1000).toFixed(1)}s`)}`;
  return '';
}

/** Compact output summary with fold hint for long results. */
function outputSummary(name: string, result: string): string {
  const lines = result.split('\n');
  const lineCount = lines.length;

  if (name === 'edit' && result.toLowerCase().includes('applied')) return 'applied';
  if (lineCount === 1) return result.slice(0, 50).trim() || 'done';

  // Fold hint: short outputs just count lines, long outputs signal they are collapsed
  const countLabel = lineCount > 20
    ? `${sym.ellipsis} ${lineCount} lines`
    : `${lineCount} lines`;
  return countLabel;
}

export function renderToolStart(name: string, detail?: string): void {
  const theme = getTheme();
  // Running state: calm — dim dot, muted name and detail
  const line = `  ${chalk.hex(theme.dim)(sym.dot)} ${chalk.hex(theme.dim)(name)}  ${chalk.hex(theme.muted)(detail || '')}`;
  startToolTimer(name);
  if (isLayoutActive()) {
    upsertToolActivity({ name, status: 'running', line });
    renderToolActivityFooter();
    return;
  }
  // Non-layout: write without newline so the end handler can overwrite in place
  process.stdout.write(line);
  nonLayoutToolInProgress = true;
}

export function renderToolEnd(name: string, result: string): void {
  const theme = getTheme();
  const elapsed = finishToolTimer(name);
  const glyph = toolGlyphs[name] || sym.toolRun;
  const summary = outputSummary(name, result);
  const time = elapsedLabel(elapsed, theme);

  // Done: accent glyph, normal-weight name, dim summary, time
  const line = `  ${chalk.hex(theme.accent)(glyph)} ${chalk.hex(theme.text)(name)}  ${chalk.hex(theme.dim)(summary)}${time}`;
  if (isLayoutActive()) {
    upsertToolActivity({ name, status: 'done', line });
    renderToolActivityFooter();
    return;
  }
  // Erase the pending start line (if any) and emit the final one-liner
  if (nonLayoutToolInProgress) {
    process.stdout.write(`\r\x1b[2K${line}\n`);
    nonLayoutToolInProgress = false;
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export function renderToolError(name: string, error: string): void {
  const theme = getTheme();
  finishToolTimer(name);
  const line = `  ${chalk.hex(theme.error)(sym.toolFail)} ${chalk.hex(theme.text)(name)}  ${chalk.hex(theme.error)(error.slice(0, 60))}`;
  if (isLayoutActive()) {
    upsertToolActivity({ name, status: 'error', line });
    renderToolActivityFooter();
    return;
  }
  if (nonLayoutToolInProgress) {
    process.stdout.write(`\r\x1b[2K${line}\n`);
    nonLayoutToolInProgress = false;
  } else {
    process.stdout.write(`${line}\n`);
  }
}

/**
 * Render expanded tool output below the one-liner (verbose mode).
 * By default tools are collapsed to a single summary line.
 * Pass expanded=true to show a preview with left-border decoration.
 */
export function renderToolResult(name: string, result: string, expanded = false): void {
  const theme = getTheme();
  const lines = result.split('\n');

  if (!expanded || lines.length <= 3) {
    return; // Default: collapsed — summary already in renderToolEnd
  }

  // Expanded: show up to 12 lines with left-border, then fold indicator
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

/**
 * Action-hint lines from error messages (e.g. "  Run: blush init").
 * These are rendered distinctly to guide the user toward a fix.
 */
const ACTION_HINT_RE = /^\s+(Run:|Set |Add |Visit |Go to |Try )/;

export function renderError(error: string): void {
  const theme = getTheme();
  const lines = error.split('\n');
  renderLine(`  ${chalk.hex(theme.error).bold(sym.toolFail)} ${chalk.hex(theme.error).bold('error')}  ${chalk.hex(theme.text)(lines[0])}`);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (ACTION_HINT_RE.test(line)) {
      renderLine(`           ${chalk.hex(theme.accent)(sym.arrow)} ${chalk.hex(theme.dim)(line.trim())}`);
    } else {
      renderLine(`           ${chalk.hex(theme.dim)(line)}`);
    }
  }
}

/** Rate limit retry feedback — shown inline while blush waits before re-sending. */
export function renderRetry(waitSeconds: number, isFinal?: boolean): void {
  const theme = getTheme();
  if (isFinal) {
    renderLine(`  ${chalk.hex(theme.warning).bold('!')} ${chalk.hex(theme.warning)('rate limited')}  ${chalk.hex(theme.dim)('retry-after exceeds limit — wait, then try again or switch model with /model')}`);
  } else {
    renderLine(`  ${chalk.hex(theme.warning)(sym.ellipsis)} ${chalk.hex(theme.warning)('rate limited')}  ${chalk.hex(theme.dim)(`retrying in ${waitSeconds}s${sym.ellipsis}`)}`);
  }
}

/**
 * Turn separator with sweep animation.
 *
 * A bright pulse travels left-to-right, leaving the thin rule behind.
 * Like a fuse burning across the terminal. ~250ms total.
 * Falls back to static rule on reduced motion or when layout is active
 * (to avoid conflicting with retained-mode redraws).
 */
export function renderTurnSeparator(): void {
  const theme = getTheme();
  const w = Math.min(process.stdout.columns || 80, 48) - 4;

  if (prefersReducedMotion() || isLayoutActive()) {
    renderLine(`  ${chalk.hex(theme.border)(rule(w, sym.thinRule))}`);
    return;
  }

  // Animated sweep: schedule frames, final state commits to transcript
  const totalFrames = 8;
  const frameMs = 30;
  let currentFrame = 0;

  function drawFrame() {
    if (currentFrame >= totalFrames) {
      // Final: clear animation, commit static rule to transcript
      process.stderr.write('\r\x1b[K');
      renderLine(`  ${chalk.hex(theme.border)(rule(w, sym.thinRule))}`);
      return;
    }

    const progress = currentFrame / totalFrames;
    const headPos = Math.floor(progress * w);
    let line = '  ';

    for (let x = 0; x < w; x++) {
      if (x < headPos - 2) {
        // Trail: settled thin rule
        line += chalk.hex(theme.border)(sym.thinRule);
      } else if (x >= headPos - 2 && x <= headPos) {
        // Pulse head: bright accent, 3 chars wide with gradient
        const dist = headPos - x;
        const bright = dist === 0 ? theme.prompt : dist === 1 ? theme.accent : theme.border;
        line += chalk.hex(bright)('\u2501'); // ━ heavy horizontal
      } else {
        line += ' ';
      }
    }

    process.stderr.write(`\r\x1b[K${line}`);
    currentFrame++;
    setTimeout(drawFrame, frameMs);
  }

  drawFrame();
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
