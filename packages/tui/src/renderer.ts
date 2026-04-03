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
// Heartbeat monitor
// ─────────────────────────────────────────

const BRAILLE_BASE = 0x2800;
const BRAILLE_DOTS = [
  [0x01, 0x08], // row 0
  [0x02, 0x10], // row 1
  [0x04, 0x20], // row 2
  [0x40, 0x80], // row 3
];

/** Generate EKG waveform y-values. */
function generateEKG(pixelWidth: number, pixelHeight: number, cycles = 1.5): number[] {
  const baseline = Math.floor(pixelHeight * 0.62);
  const wave: number[] = [];

  for (let x = 0; x < pixelWidth; x++) {
    const phase = ((x / pixelWidth) * cycles) % 1.0;
    let y = baseline;

    if (phase >= 0.08 && phase < 0.18) {
      const p = (phase - 0.08) / 0.10;
      y = baseline - Math.sin(p * Math.PI) * (pixelHeight * 0.12);
    } else if (phase >= 0.28 && phase < 0.32) {
      const q = (phase - 0.28) / 0.04;
      y = baseline + Math.sin(q * Math.PI) * (pixelHeight * 0.07);
    } else if (phase >= 0.32 && phase < 0.40) {
      const r = (phase - 0.32) / 0.08;
      y = baseline - Math.sin(r * Math.PI) * (pixelHeight * 0.52);
    } else if (phase >= 0.40 && phase < 0.46) {
      const s = (phase - 0.40) / 0.06;
      y = baseline + Math.sin(s * Math.PI) * (pixelHeight * 0.18);
    } else if (phase >= 0.54 && phase < 0.68) {
      const tw = (phase - 0.54) / 0.14;
      y = baseline - Math.sin(tw * Math.PI) * (pixelHeight * 0.10);
    }

    wave.push(Math.max(0, Math.min(pixelHeight - 1, Math.round(y))));
  }
  return wave;
}

/** Render waveform to braille strings, optionally revealing only up to a column. */
function waveformToBraille(
  wave: number[],
  cols: number,
  rows: number,
  revealTo: number,
  color: string,
  cursorColor: string,
): string[] {
  const grid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const pixelW = cols * 2;

  // Plot with line interpolation
  for (let x = 0; x < Math.min(pixelW, wave.length) - 1; x++) {
    const bc = Math.floor(x / 2);
    if (bc > revealTo) break;

    const y0 = wave[x];
    const y1 = wave[x + 1];
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      const cr = Math.floor(y / 4);
      const dr = y % 4;
      const dc = x % 2;
      if (cr >= 0 && cr < rows && bc >= 0 && bc < cols) {
        grid[cr][bc] |= BRAILLE_DOTS[dr][dc];
      }
    }
  }

  // Also draw a faint baseline dot every 4 columns for the "monitor grid" feel
  const baselineY = Math.floor(wave.length > 0 ? wave[0] : rows * 2);
  const baseRow = Math.floor(baselineY / 4);
  const baseDotRow = baselineY % 4;
  for (let c = 0; c <= revealTo && c < cols; c += 4) {
    if (baseRow >= 0 && baseRow < rows) {
      grid[baseRow][c] |= BRAILLE_DOTS[baseDotRow][0];
    }
  }

  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      if (c > revealTo) { line += ' '; continue; }
      const val = grid[r][c];
      if (val === 0) { line += ' '; continue; }
      const ch = String.fromCharCode(BRAILLE_BASE + val);
      // Cursor glow: bright at cursor, warm behind
      const dist = revealTo - c;
      if (dist <= 1) {
        line += chalk.hex(cursorColor).bold(ch);
      } else if (dist <= 3) {
        line += chalk.hex(color)(ch);
      } else {
        line += chalk.hex(color)(ch);
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Animated heartbeat monitor -- EKG waveform draws left-to-right.
 * Writes directly to stdout (must run BEFORE layout activates).
 */
export async function renderHeartbeatAnimation(width: number): Promise<void> {
  const theme = getTheme();
  const cols = Math.min(width - 4, 60);
  const rows = 3;
  const pixelW = cols * 2;
  const pixelH = rows * 4;

  if (prefersReducedMotion()) {
    // Static fallback
    const wave = generateEKG(pixelW, pixelH);
    const lines = waveformToBraille(wave, cols, rows, cols - 1, theme.prompt, theme.prompt);
    process.stdout.write('\n');
    for (const line of lines) {
      process.stdout.write(`  ${line}\n`);
    }
    return;
  }

  const wave = generateEKG(pixelW, pixelH);

  // Print empty rows to reserve space
  process.stdout.write('\n');
  for (let r = 0; r < rows; r++) {
    process.stdout.write('\n');
  }

  const totalFrames = Math.ceil(cols / 2);
  const frameDelay = 16; // ~60fps

  for (let frame = 0; frame < totalFrames; frame++) {
    const revealCol = frame * 2;
    const lines = waveformToBraille(wave, cols, rows, revealCol, theme.prompt, '#FFFFFF');

    // Move cursor up to first heartbeat row and redraw
    process.stdout.write(`\x1b[${rows}A`);
    for (const line of lines) {
      process.stdout.write(`\r\x1b[K  ${line}\n`);
    }

    await new Promise((r) => setTimeout(r, frameDelay));
  }

  // Final frame: full waveform, no cursor highlight
  process.stdout.write(`\x1b[${rows}A`);
  const finalLines = waveformToBraille(wave, cols, rows, cols - 1, theme.prompt, theme.prompt);
  for (const line of finalLines) {
    process.stdout.write(`\r\x1b[K  ${line}\n`);
  }
}

/** Render static heartbeat for transcript (after layout activates). */
export function renderStaticHeartbeat(width: number): void {
  const theme = getTheme();
  const cols = Math.min(width - 4, 60);
  const rows = 3;
  const wave = generateEKG(cols * 2, rows * 4);
  const lines = waveformToBraille(wave, cols, rows, cols - 1, theme.prompt, theme.prompt);
  for (const line of lines) {
    renderLine(`  ${line}`);
  }
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
  const w = Math.min(process.stdout.columns || 80, 64);

  // Letter-spaced wordmark with gradient
  const wordmark = 'b l u s h'.split('').map((c, i) => {
    const t = i / 8;
    const color = lerpColor(theme.prompt, theme.accent, t);
    return c === ' ' ? ' ' : chalk.hex(color).bold(c);
  }).join('');

  renderLine('');
  renderStaticHeartbeat(w);
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

  // Elapsed time -- progressive: silent under 200ms, subtle 200ms-2s, prominent 2s+
  const elapsed = finishToolTimer(name);
  const timeLabel = elapsed >= 2000
    ? `  ${chalk.hex(theme.warning)(`${(elapsed / 1000).toFixed(1)}s`)}`
    : elapsed >= 200
      ? `  ${chalk.hex(theme.muted)(`${(elapsed / 1000).toFixed(1)}s`)}`
      : '';

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
  const lines = error.split('\n');
  renderLine(`  ${chalk.hex(theme.error).bold(sym.toolFail)} ${chalk.hex(theme.error).bold('error')}  ${chalk.hex(theme.text)(lines[0])}`);
  for (let i = 1; i < lines.length; i++) {
    renderLine(`           ${chalk.hex(theme.dim)(lines[i])}`);
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
