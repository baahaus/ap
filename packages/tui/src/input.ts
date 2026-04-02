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
      `  ${chalk.hex(theme.muted)('enter sends')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('up/down history')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('tab completes')}`,
    ];
  }

  return [
    `  ${chalk.hex(theme.muted)('up/down history')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('/ for commands')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('! for shell')} ${chalk.hex(theme.border)(sym.dot)} ${chalk.hex(theme.muted)('tab to explore')}`,
  ];
}

function composerLabel(line: string, completion: CompletionSession | null): string {
  if (completion) {
    return `${completionKind(completion)} ${completion.selected + 1}/${completion.matches.length}`;
  }
  if (line.startsWith('/')) return 'command';
  if (line.startsWith('!')) return 'shell';
  if (line.trim().length > 0) return 'compose';
  return 'ready';
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

export function createInput(): {
  readline: Interface;
  getLine: (prompt?: string) => Promise<string>;
  close: () => void;
};
export function createInput(options: InputOptions): {
  readline: Interface;
  getLine: (prompt?: string) => Promise<string>;
  close: () => void;
};
export function createInput(options: InputOptions = {}): {
  readline: Interface;
  getLine: (prompt?: string) => Promise<string>;
  close: () => void;
} {
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

    process.stdout.write('\r\x1b[K' + prompt + line);
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

    if (key.name === 'return' || key.name === 'enter') {
      finalizeLine();
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
      } else if (history.length > 0 && historyIndex > 0) {
        if (historyIndex === history.length) historyDraft = line;
        setHistoryEntry(historyIndex - 1);
      }
      render();
      return;
    }

    if (key.name === 'down') {
      if (completion) {
        cycleCompletion(false);
      } else if (historyIndex < history.length) {
        setHistoryEntry(historyIndex + 1);
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
      cursor = 0;
      resetCompletion();
      render();
      return;
    }

    if (key.name === 'end') {
      cursor = line.length;
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
    close,
  };
}
