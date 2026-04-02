import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completeInput, getCompletionWindow, isCommand, parseCommand } from './input.js';
import { themes, setTheme, getTheme, listThemes } from './themes.js';
import { renderMarkdown } from './renderer.js';
import { sym, dotLeader, rule, box } from './symbols.js';

describe('isCommand', () => {
  it('returns true for slash-prefixed input', () => {
    expect(isCommand('/help')).toBe(true);
    expect(isCommand('/btw what is this')).toBe(true);
  });

  it('returns false for regular input', () => {
    expect(isCommand('hello')).toBe(false);
    expect(isCommand('what is /slash')).toBe(false);
    expect(isCommand('')).toBe(false);
  });
});

describe('parseCommand', () => {
  it('parses command name without args', () => {
    expect(parseCommand('/help')).toEqual({ name: 'help', args: '' });
    expect(parseCommand('/exit')).toEqual({ name: 'exit', args: '' });
  });

  it('parses command name with args', () => {
    expect(parseCommand('/btw what is this')).toEqual({ name: 'btw', args: 'what is this' });
    expect(parseCommand('/model claude-sonnet-4-20250514')).toEqual({
      name: 'model',
      args: 'claude-sonnet-4-20250514',
    });
  });

  it('trims whitespace around args', () => {
    expect(parseCommand('/team   spawn alpha')).toEqual({ name: 'team', args: 'spawn alpha' });
  });
});

describe('completeInput', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('completes slash commands from the provided command list', async () => {
    const completions = await completeInput('/re', {
      commands: ['/resume', '/help', '/theme'],
    });

    expect(completions).toContain('/resume');
    expect(completions).not.toContain('/help');
  });

  it('completes relative paths from the current cwd', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'blush-tui-'));
    await mkdir(join(tempDir, 'src'));
    await writeFile(join(tempDir, 'src', 'index.ts'), 'export {};\n', 'utf-8');

    const completions = await completeInput('read src/in', { cwd: tempDir });
    expect(completions).toContain('read src/index.ts');
  });

  it('centers the completion window around the selected item when possible', () => {
    expect(getCompletionWindow(10, 0, 5)).toEqual({ start: 0, end: 5 });
    expect(getCompletionWindow(10, 4, 5)).toEqual({ start: 2, end: 7 });
    expect(getCompletionWindow(10, 9, 5)).toEqual({ start: 5, end: 10 });
  });
});

describe('themes', () => {
  afterEach(() => {
    setTheme('blush');
  });

  it('has 7 themes', () => {
    expect(listThemes()).toHaveLength(7);
    expect(listThemes()).toEqual(
      expect.arrayContaining(['blush', 'mono', 'ocean', 'forest', 'sunset', 'rose', 'hacker']),
    );
  });

  it('each theme has required color fields', () => {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    for (const name of listThemes()) {
      const theme = themes[name];
      expect(theme.name).toBe(name);
      expect(theme.prompt).toMatch(hexPattern);
      expect(theme.accent).toMatch(hexPattern);
      expect(theme.text).toMatch(hexPattern);
      expect(theme.dim).toMatch(hexPattern);
      expect(theme.muted).toMatch(hexPattern);
      expect(theme.error).toMatch(hexPattern);
      expect(theme.success).toMatch(hexPattern);
      expect(theme.warning).toMatch(hexPattern);
      expect(theme.border).toMatch(hexPattern);
      expect(theme.highlight).toMatch(hexPattern);
    }
  });

  it('each theme has a label', () => {
    for (const name of listThemes()) {
      expect(themes[name].label).toBeTruthy();
      expect(themes[name].label.length).toBeGreaterThan(0);
    }
  });

  it('defaults to blush theme', () => {
    expect(getTheme().name).toBe('blush');
  });

  it('setTheme changes active theme', () => {
    expect(setTheme('ocean')).toBe(true);
    expect(getTheme().name).toBe('ocean');
  });

  it('setTheme returns false for unknown theme', () => {
    expect(setTheme('nonexistent')).toBe(false);
    expect(getTheme().name).toBe('blush');
  });
});

describe('symbols', () => {
  it('has required prompt and tool symbols', () => {
    expect(sym.prompt).toBeTruthy();
    expect(sym.toolRun).toBeTruthy();
    expect(sym.toolDone).toBeTruthy();
    expect(sym.toolFail).toBeTruthy();
  });

  it('has box drawing characters', () => {
    expect(sym.boxTL).toBe('\u256d');
    expect(sym.boxTR).toBe('\u256e');
    expect(sym.boxBL).toBe('\u2570');
    expect(sym.boxBR).toBe('\u256f');
  });

  it('spinner has 8 frames', () => {
    expect(sym.spinner).toHaveLength(8);
  });

  it('dotLeader fills space between label and value', () => {
    const result = dotLeader('model', 'claude', 30);
    expect(result).toContain('model');
    expect(result).toContain('claude');
    expect(result).toContain(sym.dotRule);
  });

  it('rule generates a line of given width', () => {
    const r = rule(10);
    expect(r).toHaveLength(10);
  });

  it('box wraps lines with rounded corners', () => {
    const result = box(['hello', 'world'], 20);
    expect(result[0]).toContain(sym.boxTL);
    expect(result[result.length - 1]).toContain(sym.boxBR);
    expect(result.length).toBe(4); // top + 2 content + bottom
  });

  it('box pads colored lines using visible width', () => {
    const result = box([chalk.red('hello')], 20);
    const stripAnsi = (text: string) => text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
    expect(stripAnsi(result[1])).toHaveLength(stripAnsi(result[0]).length);
  });
});

describe('renderMarkdown', () => {
  it('renders inline code', () => {
    const result = renderMarkdown('use `npm install` to install');
    expect(result).toContain('npm install');
    expect(result).not.toContain('`');
  });

  it('renders bold text', () => {
    const result = renderMarkdown('this is **bold** text');
    expect(result).toContain('bold');
    expect(result).not.toContain('**');
  });

  it('renders headers', () => {
    const result = renderMarkdown('# Title\n## Subtitle');
    expect(result).toContain('Title');
    expect(result).toContain('Subtitle');
    expect(result).not.toContain('#');
  });

  it('renders code blocks', () => {
    const result = renderMarkdown('```js\nconst x = 1;\n```');
    expect(result).toContain('const x = 1;');
    expect(result).not.toContain('```');
  });

  it('renders bullet lists with custom bullet', () => {
    const result = renderMarkdown('- item one\n- item two');
    expect(result).toContain(sym.bullet);
    expect(result).toContain('item one');
  });

  it('passes through plain text unchanged', () => {
    expect(renderMarkdown('hello world')).toBe('hello world');
  });
});
