import chalk from 'chalk';
import { sym, rule } from './symbols.js';
import { getTheme } from './themes.js';

const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

interface LayoutState {
  active: boolean;
  headerLines: string[];
  transcriptLines: string[];
  transcriptTail: string;
  footerLines: string[];
  prompt: string;
  inputLine: string;
  cursor: number;
  composerLines: string[];
  composerLabel: string;
}

const state: LayoutState = {
  active: false,
  headerLines: [],
  transcriptLines: [],
  transcriptTail: '',
  footerLines: [],
  prompt: '',
  inputLine: '',
  cursor: 0,
  composerLines: [],
  composerLabel: '',
};

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

function rowsForWidth(width: number, columns: number): number {
  if (columns <= 0) return 1;
  return Math.max(1, Math.floor(Math.max(width - 1, 0) / columns) + 1);
}

function lineRows(line: string, columns: number): number {
  return rowsForWidth(visibleWidth(line), columns);
}

function totalRows(lines: string[], columns: number): number {
  return lines.reduce((sum, line) => sum + lineRows(line, columns), 0);
}

function sliceLinesToRows(lines: string[], maxRows: number, columns: number): {
  lines: string[];
  rows: number;
} {
  if (maxRows <= 0 || lines.length === 0) {
    return { lines: [], rows: 0 };
  }

  let usedRows = 0;
  let start = lines.length;
  for (let index = lines.length - 1; index >= 0; index--) {
    const nextRows = lineRows(lines[index] || '', columns);
    if (usedRows + nextRows > maxRows) {
      break;
    }
    usedRows += nextRows;
    start = index;
  }

  return {
    lines: lines.slice(start),
    rows: usedRows,
  };
}

function clearScreen(): void {
  process.stdout.write('\x1b[?25l\x1b[H\x1b[2J');
}

export function resetLayout(): void {
  if (!state.active) return;
  state.transcriptLines = [];
  state.transcriptTail = '';
  state.footerLines = [];
  state.prompt = '';
  state.inputLine = '';
  state.cursor = 0;
  state.composerLines = [];
  state.composerLabel = '';
  clearScreen();
}

function showCursor(): void {
  process.stdout.write('\x1b[?25h');
}

function hideCursor(): void {
  process.stdout.write('\x1b[?25l');
}

function moveCursorUp(n = 1): void {
  if (n > 0) process.stdout.write(`\x1b[${n}A`);
}

function moveCursorRight(n = 1): void {
  if (n > 0) process.stdout.write(`\x1b[${n}C`);
}

function moveCursorToColumn(col: number): void {
  process.stdout.write('\r');
  if (col > 0) moveCursorRight(col);
}

function buildTranscriptLines(): string[] {
  const lines = [...state.transcriptLines];
  if (state.transcriptTail.length > 0) {
    lines.push(state.transcriptTail);
  }
  return lines;
}

/** Visible width of the prompt string (ANSI stripped). */
function promptVisibleWidth(): number {
  return visibleWidth(state.prompt);
}

/**
 * Count total terminal rows consumed by the (possibly multiline) input.
 * First line includes the prompt prefix; continuation lines are padded
 * with spaces to the same column width as the prompt.
 */
function promptRows(columns: number): number {
  const inputLines = state.inputLine.split('\n');
  const prefixWidth = promptVisibleWidth();
  let rows = 0;
  for (let i = 0; i < inputLines.length; i++) {
    const lineWidth = (i === 0 ? prefixWidth : prefixWidth) + (inputLines[i]?.length ?? 0);
    rows += rowsForWidth(lineWidth, columns);
  }
  return rows;
}

/**
 * Compute which terminal row the cursor sits on (0-based from the start
 * of the prompt area), accounting for multiline input and line wrapping.
 */
function cursorRow(columns: number): number {
  const inputLines = state.inputLine.split('\n');
  const prefixWidth = promptVisibleWidth();
  // Find which input-line the cursor is on
  let remaining = state.cursor;
  let termRow = 0;
  for (let i = 0; i < inputLines.length; i++) {
    const len = inputLines[i]?.length ?? 0;
    if (remaining <= len) {
      // Cursor is on this input-line
      const charsBefore = (i === 0 ? prefixWidth : prefixWidth) + remaining;
      termRow += Math.floor(charsBefore / columns);
      return termRow;
    }
    // Account for full rows consumed by this input-line, then skip past \n
    const lineWidth = (i === 0 ? prefixWidth : prefixWidth) + len;
    termRow += rowsForWidth(lineWidth, columns);
    remaining -= len + 1; // +1 for the \n
  }
  return termRow;
}

/**
 * Compute which terminal column the cursor sits on.
 */
function cursorCol(columns: number): number {
  const inputLines = state.inputLine.split('\n');
  const prefixWidth = promptVisibleWidth();
  let remaining = state.cursor;
  for (let i = 0; i < inputLines.length; i++) {
    const len = inputLines[i]?.length ?? 0;
    if (remaining <= len) {
      const charsBefore = (i === 0 ? prefixWidth : prefixWidth) + remaining;
      return charsBefore % columns;
    }
    remaining -= len + 1;
  }
  return 0;
}

export function isLayoutActive(): boolean {
  return state.active;
}

export function activateLayout(): void {
  state.active = true;
  state.transcriptLines = [];
  state.transcriptTail = '';
  state.footerLines = [];
  state.prompt = '';
  state.inputLine = '';
  state.cursor = 0;
  state.composerLines = [];
  state.composerLabel = '';
  clearScreen();
}

export function deactivateLayout(): void {
  if (!state.active) return;
  state.active = false;
  state.footerLines = [];
  state.composerLines = [];
  state.prompt = '';
  state.inputLine = '';
  state.cursor = 0;
  state.composerLabel = '';
  showCursor();
  process.stdout.write('\n');
}

export function appendTranscript(text: string): void {
  if (!state.active) {
    process.stdout.write(text);
    return;
  }

  const parts = text.split('\n');
  state.transcriptTail += parts[0] || '';
  for (let i = 1; i < parts.length; i++) {
    state.transcriptLines.push(state.transcriptTail);
    state.transcriptTail = parts[i] || '';
  }
}

export function setHeaderLines(lines: string[]): void {
  state.headerLines = lines;
}

export function setFooterLines(lines: string[]): void {
  if (!state.active) {
    if (lines.length > 0) {
      process.stdout.write(lines.join('\n') + '\n');
    }
    return;
  }

  state.footerLines = lines;
}

export function clearFooterLines(): void {
  state.footerLines = [];
}

export function commitInputToTranscript(line: string): void {
  if (!state.active) return;
  const theme = getTheme();
  const inputLines = line.split('\n');
  const continuationMark = chalk.hex(theme.border)(sym.boxV) + ' ';
  const formatted = inputLines.map((l, i) => (i === 0 ? state.prompt : continuationMark) + l).join('\n');
  appendTranscript(`\n${formatted}\n`);
}

export function setComposerState(
  prompt: string,
  inputLine: string,
  cursor: number,
  composerLines: string[] = [],
  composerLabel = '',
): void {
  if (!state.active) return;
  state.prompt = prompt;
  state.inputLine = inputLine;
  state.cursor = cursor;
  state.composerLines = composerLines;
  state.composerLabel = composerLabel;
}

function composerDivider(columns: number): string {
  const theme = getTheme();
  const label = state.composerLabel || 'ready';
  const left = 3;
  const right = Math.max(2, Math.min(columns - 12, 56) - left - label.length - 2);
  const accent = state.inputLine.trim().length > 0 ? theme.prompt : theme.accent;
  return `  ${chalk.hex(theme.border)(sym.thinRule.repeat(left))} ${chalk.hex(accent)(label)} ${chalk.hex(theme.border)(sym.thinRule.repeat(right))}`;
}

export function renderLayout(): void {
  if (!state.active) return;

  const columns = Math.max(20, process.stdout.columns || 80);
  const rows = Math.max(10, process.stdout.rows || 24);

  const header = state.headerLines;
  const transcript = buildTranscriptLines();
  const footer = state.footerLines;
  const composerExtra = state.composerLines;
  const dividerLine = composerDivider(columns);
  const promptRowCount = promptRows(columns);
  const headerRows = totalRows(header, columns);
  const footerRows = totalRows(footer, columns);
  const composerRows = totalRows(composerExtra, columns);
  const dividerRows = lineRows(dividerLine, columns);
  const reservedRows = headerRows + footerRows + composerRows + promptRowCount + dividerRows;
  const transcriptSpace = Math.max(0, rows - reservedRows);
  const visibleTranscript = sliceLinesToRows(transcript, transcriptSpace, columns);
  const blankRows = Math.max(0, transcriptSpace - visibleTranscript.rows);

  clearScreen();
  hideCursor();

  // Header (animated gradient lives here)
  if (header.length > 0) {
    process.stdout.write(header.join('\n'));
    process.stdout.write('\n');
  }

  if (visibleTranscript.lines.length > 0) {
    process.stdout.write(visibleTranscript.lines.join('\n'));
  }

  const bodyPadding = blankRows + (visibleTranscript.lines.length > 0 ? 1 : 0);
  if (bodyPadding > 0) {
    process.stdout.write('\n'.repeat(bodyPadding));
  }

  if (footer.length > 0) {
    process.stdout.write(footer.join('\n'));
    process.stdout.write('\n');
  }

  process.stdout.write(dividerLine);
  process.stdout.write('\n');

  // Render the (possibly multiline) input with prompt/continuation marker
  const inputLines = state.inputLine.split('\n');
  const theme = getTheme();
  const continuationMark = chalk.hex(theme.border)(sym.boxV) + ' ';
  for (let i = 0; i < inputLines.length; i++) {
    if (i > 0) process.stdout.write('\n');
    process.stdout.write((i === 0 ? state.prompt : continuationMark) + inputLines[i]);
  }

  if (composerExtra.length > 0) {
    process.stdout.write('\n' + composerExtra.join('\n'));
  }

  const bottomRows = composerRows + (promptRowCount - 1 - cursorRow(columns));
  moveCursorUp(bottomRows);
  moveCursorToColumn(cursorCol(columns));
  showCursor();
}
