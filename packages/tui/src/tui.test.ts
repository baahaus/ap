import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCommand, parseCommand } from './input.js';
import { themes, setTheme, getTheme, listThemes } from './themes.js';
import { renderMarkdown } from './renderer.js';

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

describe('themes', () => {
  afterEach(() => {
    setTheme('default');
  });

  it('has 7 themes', () => {
    expect(listThemes()).toHaveLength(7);
    expect(listThemes()).toEqual(
      expect.arrayContaining(['default', 'mono', 'ocean', 'forest', 'sunset', 'rose', 'hacker']),
    );
  });

  it('each theme has required color fields', () => {
    for (const name of listThemes()) {
      const theme = themes[name];
      expect(theme.name).toBe(name);
      expect(theme.prompt).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.dim).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.error).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.success).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.warning).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('defaults to default theme', () => {
    expect(getTheme().name).toBe('default');
  });

  it('setTheme changes active theme', () => {
    expect(setTheme('ocean')).toBe(true);
    expect(getTheme().name).toBe('ocean');
  });

  it('setTheme returns false for unknown theme', () => {
    expect(setTheme('nonexistent')).toBe(false);
    expect(getTheme().name).toBe('default');
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

  it('passes through plain text unchanged', () => {
    expect(renderMarkdown('hello world')).toBe('hello world');
  });
});
