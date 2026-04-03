import { describe, expect, it, vi } from 'vitest';

// Test the parseArgs function by extracting its logic
// Since parseArgs is not exported, we test the public behavior through the module

describe('CLI argument parsing', () => {
  // parseArgs is internal, so we test the behavior patterns it supports

  it('parseCommand handles /team subcommands', async () => {
    // Import from tui since that's where parseCommand lives
    const { parseCommand } = await import('@blush/tui');

    expect(parseCommand('/team spawn alpha')).toEqual({
      name: 'team',
      args: 'spawn alpha',
    });

    expect(parseCommand('/team msg bob hello there')).toEqual({
      name: 'team',
      args: 'msg bob hello there',
    });

    expect(parseCommand('/team review target reviewer --criteria "check types"')).toEqual({
      name: 'team',
      args: 'review target reviewer --criteria "check types"',
    });

    expect(parseCommand('/team pipeline a:"task1" b:"task2"')).toEqual({
      name: 'team',
      args: 'pipeline a:"task1" b:"task2"',
    });
  });

  it('parseCommand handles all slash commands', async () => {
    const { parseCommand } = await import('@blush/tui');

    const commands = [
      ['/btw what is this', 'btw', 'what is this'],
      ['/compact focus on tests', 'compact', 'focus on tests'],
      ['/branch', 'branch', ''],
      ['/context', 'context', ''],
      ['/diff', 'diff', ''],
      ['/effort on', 'effort', 'on'],
      ['/mcp', 'mcp', ''],
      ['/model claude-sonnet-4-20250514', 'model', 'claude-sonnet-4-20250514'],
      ['/resume abc123', 'resume', 'abc123'],
      ['/skills', 'skills', ''],
      ['/theme ocean', 'theme', 'ocean'],
      ['/save', 'save', ''],
      ['/copy 2', 'copy', '2'],
      ['/help', 'help', ''],
      ['/exit', 'exit', ''],
    ] as const;

    for (const [input, name, args] of commands) {
      expect(parseCommand(input)).toEqual({ name, args });
    }
  });

  it('isCommand identifies commands correctly', async () => {
    const { isCommand } = await import('@blush/tui');

    expect(isCommand('/help')).toBe(true);
    expect(isCommand('/team spawn alpha')).toBe(true);
    expect(isCommand('hello')).toBe(false);
    expect(isCommand('!ls')).toBe(false);
  });
});

describe('CLI version and branding', () => {
  it('package.json has correct name', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('@blush/cli');
  });

  it('bin entry is blush', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8'));
    expect(pkg.bin).toHaveProperty('blush');
  });
});

describe('stream rendering', () => {
  it('prefixes assistant chunks without adding markers to blank lines', async () => {
    const { prefixStreamChunk } = await import('./rendering.js');

    expect(prefixStreamChunk('hello', '  ▸ ', true)).toMatchObject({
      output: '  ▸ hello',
      lineStart: false,
    });

    expect(prefixStreamChunk('\nnext', '  ▸ ', false)).toMatchObject({
      output: '\n  ▸ next',
      lineStart: false,
    });

    expect(prefixStreamChunk('one\n\ntwo\n', '  ▸ ', true)).toMatchObject({
      output: '  ▸ one\n\n  ▸ two\n',
      lineStart: true,
    });
  });

  it('summarizes tool input for compact tool headers', async () => {
    const { summarizeToolInput } = await import('./rendering.js');

    expect(summarizeToolInput('bash', { command: 'ls -la ~/Desktop' })).toBe('ls -la ~/Desktop');
    expect(summarizeToolInput('read', { file_path: '/Users/brandon/Projects/blush/README.md' })).toContain('README.md');
    expect(summarizeToolInput('web_search', { query: 'latest gpt-5.4 cli ux patterns' })).toContain('gpt-5.4');
  });
});

describe('model selection', () => {
  it('resolves models by number and name', async () => {
    const { listSelectableModels, resolveModelSelection } = await import('./commands/models.js');

    const models = listSelectableModels();
    expect(models.length).toBeGreaterThan(3);
    expect(resolveModelSelection('1')).toBe(models[0].name);
    expect(resolveModelSelection(models[1].name)).toBe(models[1].name);
    expect(resolveModelSelection(models[1].name.toUpperCase())).toBe(models[1].name);
    expect(resolveModelSelection('999')).toBeNull();
  });
});

describe('init command', () => {
  it('init module exports init function', async () => {
    const initModule = await import('./commands/init.js');
    expect(typeof initModule.init).toBe('function');
  });
});

describe('sdk exports', () => {
  it('keeps createBlushSession as the canonical export and preserves the old alias', async () => {
    const sdk = await import('./sdk.js');
    expect(typeof sdk.createBlushSession).toBe('function');
    expect(sdk.createApSession).toBe(sdk.createBlushSession);
  });
});

describe('team command imports', () => {
  it('exports all team functions', async () => {
    const team = await import('@blush/team');
    expect(typeof team.createTeamSession).toBe('function');
    expect(typeof team.spawnPeer).toBe('function');
    expect(typeof team.messagePeer).toBe('function');
    expect(typeof team.synthesize).toBe('function');
    expect(typeof team.reviewPeer).toBe('function');
    expect(typeof team.runPipeline).toBe('function');
    expect(typeof team.mergePeer).toBe('function');
    expect(typeof team.getTeamStatus).toBe('function');
  });
});
