import { emitKeypressEvents, type Interface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { getTheme } from './themes.js';
import { sym } from './symbols.js';
import { commitInputToTranscript, isLayoutActive, renderLayout, setComposerState } from './layout.js';

export interface InputOptions {
  prompt?: string;
  multiline?: boolean;
  cwd?: string;
  commands?: string[];
  complete?: (line: string) => string[] | Promise<string[]>;
  historyFile?: string;
}

interface KeyPress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

interface CompletionSession {
  source: string;
  matches: string[];
  selected: number;
}

const DEFAULT_HISTORY_FILE = join(homedir(), '.blush', 'history');
const HISTORY_LIMIT = 200;
const COMPLETION_WINDOW = 5;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function loadHistory(historyFile: string): string[] {
  if (!existsSync(historyFile)) return [];

  return readFileSync(historyFile, 'utf-8')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-HISTORY_LIMIT);
}

function saveHistory(historyFile: string, entries: string[]): void {
  mkdirSync(dirname(historyFile), { recursive: true });
  const normalized = unique(entries.filter(Boolean)).slice(-HISTORY_LIMIT);
  writeFileSync(historyFile, normalized.join('\n') + (normalized.length ? '\n' : ''), 'utf-8');
}

function matchCandidates(prefix: string, candidates: string[]): string[] {
  const normalizedPrefix = prefix.toLowerCase();
  return candidates.filter((candidate) => candidate.toLowerCase().startsWith(normalizedPrefix));
}

function shouldCompletePaths(line: string, token: string): boolean {
  if (line.startsWith('/') && !line.includes(' ')) {
    return false;
  }

  return line.startsWith('!')
    || token.startsWith('.')
    || token.startsWith('~')
    || token.startsWith('/')
    || token.includes('/');
}

function expandPathToken(token: string, cwd: string): { dir: string; fragment: string } {
  const home = homedir();
  const normalizedToken = token.startsWith('~/')
    ? join(home, token.slice(2))
    : token === '~'
      ? home
      : token;

  const absolutePath = normalizedToken.startsWith('/')
    ? normalizedToken
    : resolve(cwd, normalizedToken || '.');

  const endsWithSlash = token.endsWith('/');
  const baseDir = endsWithSlash ? absolutePath : dirname(absolutePath);
  const fragment = endsWithSlash ? '' : absolutePath.slice(baseDir.length + (baseDir.endsWith('/') ? 0 : 1));

  return { dir: baseDir, fragment };
}

function completePaths(line: string, cwd: string): string[] {
  const match = line.match(/(?:^|\s)([^\s]*)$/);
  const token = match?.[1] ?? '';
  if (!shouldCompletePaths(line, token)) return [];

  const tokenStart = line.slice(0, line.length - token.length);
  const { dir, fragment } = expandPathToken(token, cwd);
  if (!existsSync(dir)) return [];

  try {
    return readdirSync(dir)
      .filter((entry) => entry.startsWith(fragment))
      .map((entry) => {
        const absoluteEntry = join(dir, entry);
        const isDir = statSync(absoluteEntry).isDirectory();
        const replacement = token.startsWith('~/') || token === '~'
          ? absoluteEntry === homedir()
            ? '~'
            : `~/${absoluteEntry.slice(homedir().length + 1)}`
          : token.startsWith('/')
            ? absoluteEntry
            : relative(cwd, absoluteEntry) || '.';
        const value = replacement.replace(/\\/g, '/');
        return `${tokenStart}${value}${isDir ? '/' : ''}`;
      });
  } catch {
    return [];
  }
}

export async function completeInput(line: string, options: InputOptions = {}): Promise<string[]> {
  const commands = options.commands || [];
  const cwd = options.cwd || process.cwd();
  const completions: string[] = [];

  if (line.startsWith('/')) {
    const [commandToken] = line.split(/\s+/, 1);
    if (!line.includes(' ')) {
      completions.push(...matchCandidates(commandToken, commands));
    }
  }

  completions.push(...completePaths(line, cwd));

  if (options.complete) {
    completions.push(...await options.complete(line));
  }

  return unique(completions).sort((a, b) => a.localeCompare(b));
}

export function getCompletionWindow(total: number, selected: number, windowSize = COMPLETION_WINDOW): {
  start: number;
  end: number;
} {
  if (total <= windowSize) return { start: 0, end: total };

  const half = Math.floor(windowSize / 2);
  const start = Math.max(0, Math.min(selected - half, total - windowSize));
  return { start, end: start + windowSize };
}

function truncateCompletion(value: string, maxLength = 28): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return value.slice(0, maxLength - 1) + '…';
}

function completionLabel(session: CompletionSession, match: string): string {
  if (session.source && match.startsWith(session.source)) {
    return match.slice(session.source.length) || match;
  }
  return match;
}

function completionBarLines(session: CompletionSession): string[] {
  const theme = getTheme();
  const { start, end } = getCompletionWindow(session.matches.length, session.selected);
  const visible = session.matches.slice(start, end);
  const prefix = start > 0 ? chalk.hex(theme.muted)(`${sym.ellipsis} `) : '';
  const suffix = end < session.matches.length ? chalk.hex(theme.muted)(` ${sym.ellipsis}`) : '';
  const items = visible.map((match, index) => {
    const absoluteIndex = start + index;
    const label = truncateCompletion(completionLabel(session, match));
    if (absoluteIndex === session.selected) {
      return chalk.hex(theme.highlight).bold(`[${label}]`);
    }
    return chalk.hex(theme.text)(label);
  });
  const selected = session.matches[session.selected] || '';
  const kind = completionKind(session);
  const preview = truncateCompletion(completionLabel(session, selected), 44);

  return [
    `  ${chalk.hex(theme.dim)(kind)} ${chalk.hex(theme.muted)(`${session.selected + 1}/${session.matches.length}`)} ${prefix}${items.join(chalk.hex(theme.muted)('  '))}${suffix}`,
    `  ${chalk.hex(theme.accent)(sym.prompt)} ${chalk.hex(theme.text)(preview)}`,
    `  ${chalk.hex(theme.muted)('Tab/Shift-Tab cycle')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('Up/Down select')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('Esc cancel')}`,
  ];
}

function completionKind(session: CompletionSession): string {
  const matches = session.matches;
  if (matches.every((match) => match.startsWith('/model '))) return 'models';
  if (matches.every((match) => match.startsWith('/theme '))) return 'themes';
  if (matches.every((match) => match.startsWith('/resume '))) return 'sessions';
  if (matches.every((match) => match.startsWith('/team '))) return 'team';
  if (matches.every((match) => match.startsWith('/'))) return 'commands';
  if (matches.some((match) => match.includes('/') || match.startsWith('!'))) return 'paths';
  return 'completions';
}

function idleHelperLine(line: string): string[] {
  const theme = getTheme();

  if (line.startsWith('/')) {
    return [
      `  ${chalk.hex(theme.muted)('slash command')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('tab completes names and arguments')}`,
    ];
  }

  if (line.startsWith('!')) {
    return [
      `  ${chalk.hex(theme.muted)('shell passthrough')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('output is added back into the conversation')}`,
    ];
  }

  if (line.trim().length > 0) {
    return [
      `  ${chalk.hex(theme.muted)('enter sends')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('opt+enter newline')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('tab completes')}`,
    ];
  }

  return [
    `  ${chalk.hex(theme.muted)('up/down history')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('/ for commands')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('! for shell')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('tab to explore')}`,
  ];
}

/** Given a flat cursor index into a string with `\n`, return the line index and column. */
export function cursorToRowCol(text: string, cursor: number): { row: number; col: number } {
  let row = 0;
  let col = 0;
  for (let i = 0; i < cursor && i < text.length; i++) {
    if (text[i] === '\n') {
      row++;
      col = 0;
    } else {
      col++;
    }
  }
  return { row, col };
}

/** Return the flat index of the start of a given line within the text. */
export function lineStartIndex(text: string, targetRow: number): number {
  let row = 0;
  for (let i = 0; i < text.length; i++) {
    if (row === targetRow) return i;
    if (text[i] === '\n') row++;
  }
  return row === targetRow ? text.length : -1;
}

/** Return the length (character count) of a given line within the text. */
export function lineLength(text: string, targetRow: number): number {
  const lines = text.split('\n');
  if (targetRow < 0 || targetRow >= lines.length) return 0;
  return lines[targetRow]!.length;
}

/** Return the total number of lines in the text. */
export function lineCount(text: string): number {
  return text.split('\n').length;
}

function composerLabel(line: string, completion: CompletionSession | null): string {
  if (completion) {
    return `${completionKind(completion)} ${completion.selected + 1}/${completion.matches.length}`;
  }
  const numLines = lineCount(line);
  if (line.startsWith('/')) return 'command';
  if (line.startsWith('!')) return 'shell';
  if (numLines > 1) return `compose (${numLines} lines)`;
  if (line.trim().length > 0) return 'compose';
  return 'ready';
}

/** Move cursor to the start of the previous word (emacs Alt+B / Ctrl+Left). */
function wordBoundaryLeft(text: string, pos: number): number {
  let i = pos;
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
  return i;
}

/** Move cursor to the end of the next word (emacs Alt+F / Ctrl+Right). */
function wordBoundaryRight(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  while (i < text.length && !/\s/.test(text[i]!)) i++;
  return i;
}

export function isCommand(input: string): boolean {
  return input.startsWith('/');
}

export function parseCommand(input: string): { name: string; args: string } {
  const trimmed = input.slice(1).trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { name: trimmed, args: '' };
  }
  return {
    name: trimmed.slice(0, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim(),
  };
}

export interface InputHandle {
  readline: Interface;
  getLine: (prompt?: string) => Promise<string>;
  setQueueMode: (cb: ((line: string) => void) | null) => void;
  close: () => void;
}

export function createInput(): InputHandle;
export function createInput(options: InputOptions): InputHandle;
export function createInput(options: InputOptions = {}): InputHandle {
  const inputStream = process.stdin;
  const historyFile = options.historyFile || DEFAULT_HISTORY_FILE;
  const history = loadHistory(historyFile);

  let active = false;
  let rawEnabled = false;
  let prompt = '> ';
  let line = '';
  let cursor = 0;
  let historyIndex = history.length;
  let historyDraft = '';
  let completion: CompletionSession | null = null;
  let resolveLine: ((value: string) => void) | null = null;
  let completionRequestId = 0;
  let queueCallback: ((line: string) => void) | null = null;

  emitKeypressEvents(inputStream);

  const fakeReadline = {
    close() {},
  } as Interface;

  function applyCompletionSelection(): void {
    if (!completion) return;
    line = completion.matches[completion.selected] || completion.source;
    cursor = line.length;
  }

  function render(): void {
    const barLines = completion ? completionBarLines(completion) : idleHelperLine(line);
    if (isLayoutActive()) {
      setComposerState(prompt, line, cursor, barLines, composerLabel(line, completion));
      renderLayout();
      return;
    }

    const inputLines = line.split('\n');
    const continuationMark = chalk.hex(getTheme().border)(sym.boxV) + ' ';
    process.stdout.write('\r\x1b[K' + prompt + inputLines[0]);
    for (let i = 1; i < inputLines.length; i++) {
      process.stdout.write(`\n${continuationMark}${inputLines[i]}`);
    }
    for (const barLine of barLines) {
      process.stdout.write(`\n${barLine}`);
    }
  }

  function resetCompletion(restoreSource = false): void {
    if (completion && restoreSource) {
      line = completion.source;
      cursor = line.length;
    }
    completion = null;
  }

  function setHistoryEntry(index: number): void {
    if (index < 0 || index > history.length) return;
    historyIndex = index;
    line = index === history.length ? historyDraft : history[index] || '';
    cursor = line.length;
    resetCompletion();
  }

  function insertText(text: string): void {
    line = line.slice(0, cursor) + text + line.slice(cursor);
    cursor += text.length;
    resetCompletion();
  }

  function deleteBackward(): void {
    if (cursor === 0) return;
    line = line.slice(0, cursor - 1) + line.slice(cursor);
    cursor--;
    resetCompletion();
  }

  function deleteForward(): void {
    if (cursor >= line.length) return;
    line = line.slice(0, cursor) + line.slice(cursor + 1);
    resetCompletion();
  }

  function cycleCompletion(reverse = false): void {
    if (!completion || completion.matches.length === 0) return;
    const delta = reverse ? -1 : 1;
    const length = completion.matches.length;
    completion = {
      ...completion,
      selected: (completion.selected + delta + length) % length,
    };
    applyCompletionSelection();
  }

  function startCompletion(source: string, matches: string[]): void {
    if (matches.length === 0) {
      process.stdout.write('\x07');
      resetCompletion();
      return;
    }

    if (matches.length === 1) {
      line = matches[0] || source;
      cursor = line.length;
      resetCompletion();
      return;
    }

    completion = {
      source,
      matches,
      selected: 0,
    };
    applyCompletionSelection();
  }

  async function triggerCompletion(reverse = false): Promise<void> {
    if (completion) {
      cycleCompletion(reverse);
      render();
      return;
    }

    const source = line;
    const requestId = ++completionRequestId;
    const matches = await completeInput(source, options);
    if (!active || requestId !== completionRequestId) return;
    startCompletion(source, matches);
    render();
  }

  function finalizeLine(): void {
    const submitted = line;
    const submittedPrompt = prompt;
    if (submitted.trim()) {
      history.push(submitted);
      while (history.length > HISTORY_LIMIT) history.shift();
    }
    historyIndex = history.length;
    historyDraft = '';
    resetCompletion();

    // Queue mode: don't resolve the Promise, just forward to callback and reset input
    if (queueCallback && submitted.trim()) {
      if (isLayoutActive()) {
        commitInputToTranscript(submitted);
      }
      line = '';
      cursor = 0;
      queueCallback(submitted);
      render();
      return;
    }

    active = false;
    if (isLayoutActive()) {
      commitInputToTranscript(submitted);
      setComposerState(submittedPrompt, '', 0, []);
      renderLayout();
    } else {
      process.stdout.write('\n');
    }
    resolveLine?.(submitted);
    resolveLine = null;
  }

  function handleCtrlC(): void {
    cleanupRawMode();
    process.kill(process.pid, 'SIGINT');
  }

  function cleanupRawMode(): void {
    if (rawEnabled && inputStream.isTTY) {
      inputStream.setRawMode(false);
      rawEnabled = false;
    }
  }

  async function onKeypress(char: string, key: KeyPress): Promise<void> {
    if (!active) return;

    if (key.ctrl && key.name === 'c') {
      handleCtrlC();
      return;
    }

    // Ctrl+D — delete forward, or exit on empty line (standard readline)
    if (key.ctrl && key.name === 'd') {
      if (line.length === 0) {
        handleCtrlC();
        return;
      }
      deleteForward();
      render();
      return;
    }

    // Ctrl+A — beginning of current line (emacs)
    if (key.ctrl && key.name === 'a') {
      const { row } = cursorToRowCol(line, cursor);
      cursor = lineStartIndex(line, row);
      resetCompletion();
      render();
      return;
    }

    // Ctrl+E — end of current line (emacs)
    if (key.ctrl && key.name === 'e') {
      const { row } = cursorToRowCol(line, cursor);
      cursor = lineStartIndex(line, row) + lineLength(line, row);
      resetCompletion();
      render();
      return;
    }

    // Ctrl+K — kill to end of current line (emacs)
    if (key.ctrl && key.name === 'k') {
      const { row } = cursorToRowCol(line, cursor);
      const lineEnd = lineStartIndex(line, row) + lineLength(line, row);
      line = line.slice(0, cursor) + line.slice(lineEnd);
      resetCompletion();
      render();
      return;
    }

    // Ctrl+U — kill to beginning of current line (emacs)
    if (key.ctrl && key.name === 'u') {
      const { row } = cursorToRowCol(line, cursor);
      const lineStart = lineStartIndex(line, row);
      line = line.slice(0, lineStart) + line.slice(cursor);
      cursor = lineStart;
      resetCompletion();
      render();
      return;
    }

    // Ctrl+W / Alt+Backspace — delete word backward (emacs / bash)
    if ((key.ctrl && key.name === 'w') || (key.meta && key.name === 'backspace')) {
      const newPos = wordBoundaryLeft(line, cursor);
      line = line.slice(0, newPos) + line.slice(cursor);
      cursor = newPos;
      resetCompletion();
      render();
      return;
    }

    // Alt+D — delete word forward (emacs)
    if (key.meta && key.name === 'd') {
      const newEnd = wordBoundaryRight(line, cursor);
      line = line.slice(0, cursor) + line.slice(newEnd);
      resetCompletion();
      render();
      return;
    }

    // Alt+B / Ctrl+Left — move word backward (emacs)
    if ((key.meta && key.name === 'b') || (key.ctrl && key.name === 'left')) {
      cursor = wordBoundaryLeft(line, cursor);
      resetCompletion();
      render();
      return;
    }

    // Alt+F / Ctrl+Right — move word forward (emacs)
    if ((key.meta && key.name === 'f') || (key.ctrl && key.name === 'right')) {
      cursor = wordBoundaryRight(line, cursor);
      resetCompletion();
      render();
      return;
    }

    if (key.name === 'return' || key.name === 'enter') {
      // Option+Enter (meta) or Shift+Enter inserts a newline
      if (key.meta || key.shift) {
        insertText('\n');
        render();
        return;
      }
      finalizeLine();
      return;
    }

    // Ctrl+J is the Unix newline character -- alternative for terminals
    // that don't distinguish Shift+Enter from Enter
    if (key.ctrl && key.name === 'j') {
      insertText('\n');
      render();
      return;
    }

    if (key.name === 'tab') {
      await triggerCompletion(Boolean(key.shift));
      return;
    }

    if (key.name === 'escape') {
      if (completion) {
        resetCompletion(true);
        render();
      }
      return;
    }

    if (key.name === 'up') {
      if (completion) {
        cycleCompletion(true);
      } else {
        const { row, col } = cursorToRowCol(line, cursor);
        if (row > 0) {
          // Move cursor up one line, clamping column
          const prevLen = lineLength(line, row - 1);
          const prevStart = lineStartIndex(line, row - 1);
          cursor = prevStart + Math.min(col, prevLen);
          resetCompletion();
        } else if (history.length > 0 && historyIndex > 0) {
          if (historyIndex === history.length) historyDraft = line;
          setHistoryEntry(historyIndex - 1);
        }
      }
      render();
      return;
    }

    if (key.name === 'down') {
      if (completion) {
        cycleCompletion(false);
      } else {
        const { row, col } = cursorToRowCol(line, cursor);
        const totalLines = lineCount(line);
        if (row < totalLines - 1) {
          // Move cursor down one line, clamping column
          const nextLen = lineLength(line, row + 1);
          const nextStart = lineStartIndex(line, row + 1);
          cursor = nextStart + Math.min(col, nextLen);
          resetCompletion();
        } else if (historyIndex < history.length) {
          setHistoryEntry(historyIndex + 1);
        }
      }
      render();
      return;
    }

    if (key.name === 'left') {
      cursor = Math.max(0, cursor - 1);
      resetCompletion();
      render();
      return;
    }

    if (key.name === 'right') {
      cursor = Math.min(line.length, cursor + 1);
      resetCompletion();
      render();
      return;
    }

    if (key.name === 'home') {
      // Go to start of current line, not entire input
      const { row } = cursorToRowCol(line, cursor);
      cursor = lineStartIndex(line, row);
      resetCompletion();
      render();
      return;
    }

    if (key.name === 'end') {
      // Go to end of current line, not entire input
      const { row } = cursorToRowCol(line, cursor);
      cursor = lineStartIndex(line, row) + lineLength(line, row);
      resetCompletion();
      render();
      return;
    }

    if (key.name === 'backspace') {
      deleteBackward();
      render();
      return;
    }

    if (key.name === 'delete') {
      deleteForward();
      render();
      return;
    }

    if (char && !key.ctrl && !key.meta) {
      insertText(char);
      render();
    }
  }

  inputStream.on('keypress', onKeypress);

  function onResize(): void {
    if (active) {
      render();
    }
  }

  process.stdout.on('resize', onResize);

  function getLine(nextPrompt = options.prompt || '> '): Promise<string> {
    prompt = nextPrompt;
    line = '';
    cursor = 0;
    historyIndex = history.length;
    historyDraft = '';
    resetCompletion();
    active = true;

    if (!rawEnabled && inputStream.isTTY) {
      inputStream.setRawMode(true);
      rawEnabled = true;
    }

    render();

    return new Promise((resolve) => {
      resolveLine = resolve;
    });
  }

  function setQueueMode(cb: ((line: string) => void) | null): void {
    queueCallback = cb;
  }

  function close(): void {
    active = false;
    cleanupRawMode();
    saveHistory(historyFile, history);
    inputStream.off('keypress', onKeypress);
    process.stdout.off('resize', onResize);
  }

  return {
    readline: fakeReadline,
    getLine,
    setQueueMode,
    close,
  };
}
