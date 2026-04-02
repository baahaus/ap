import chalk from 'chalk';
import { getTheme } from './themes.js';
import { sym } from './symbols.js';

export interface Spinner {
  start: (label: string) => void;
  update: (label: string) => void;
  succeed: (label: string) => void;
  fail: (label: string) => void;
  stop: () => void;
}

/**
 * Animated braille spinner that renders on stderr.
 * Warm and alive -- the agent is thinking.
 */
export function createSpinner(): Spinner {
  let interval: ReturnType<typeof setInterval> | null = null;
  let frame = 0;
  let currentLabel = '';

  function render() {
    const theme = getTheme();
    const glyph = sym.spinner[frame % sym.spinner.length];
    const line = `  ${chalk.hex(theme.accent)(glyph)} ${chalk.hex(theme.dim)(currentLabel)}`;
    process.stderr.write(`\r\x1b[K${line}`);
    frame++;
  }

  function start(label: string) {
    stop();
    currentLabel = label;
    frame = 0;
    render();
    interval = setInterval(render, 80);
  }

  function update(label: string) {
    currentLabel = label;
  }

  function succeed(label: string) {
    stop();
    const theme = getTheme();
    process.stderr.write(
      `\r\x1b[K  ${chalk.hex(theme.success)(sym.toolDone)} ${chalk.hex(theme.dim)(label)}\n`,
    );
  }

  function fail(label: string) {
    stop();
    const theme = getTheme();
    process.stderr.write(
      `\r\x1b[K  ${chalk.hex(theme.error)(sym.toolFail)} ${chalk.hex(theme.dim)(label)}\n`,
    );
  }

  function stop() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    process.stderr.write('\r\x1b[K');
  }

  return { start, update, succeed, fail, stop };
}
