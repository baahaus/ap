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
      ['/model claude-sonnet-4-20250514', 'model', 'claude-sonnet-4-20250514'],
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

describe('init command', () => {
  it('init module exports init function', async () => {
    const initModule = await import('./commands/init.js');
    expect(typeof initModule.init).toBe('function');
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
