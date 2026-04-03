import chalk from 'chalk';
import { getTheme } from './themes.js';
import { sym } from './symbols.js';
import { isLayoutActive, setFooterLines, clearFooterLines } from './layout.js';

export interface Spinner {
  start: (label: string) => void;
  update: (label: string) => void;
  impulse: () => void;
  succeed: (label: string) => void;
  fail: (label: string) => void;
  stop: () => void;
}

/**
 * Thinking phrases that rotate during long operations.
 */
const thinkingPhrases = [
  'thinking',
  'reasoning',
  'considering',
  'working through it',
  'forming a plan',
  'reading the code',
  'putting it together',
];

// ── Spring physics ──────────────────────

interface SpringState {
  position: number;
  velocity: number;
}

const SPRING_TENSION = 160;
const SPRING_FRICTION = 11;

function springStep(state: SpringState, dt: number): SpringState {
  const force = -SPRING_TENSION * state.position - SPRING_FRICTION * state.velocity;
  return {
    position: state.position + state.velocity * dt,
    velocity: state.velocity + force * dt,
  };
}

function lerpHex(a: string, b: string, t: number): string {
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

// ── Spinner ─────────────────────────────

/**
 * Spring-physics spinner with organic breathing.
 *
 * The braille glyph cycles as before, but its color now follows
 * a damped spring. On start, the spring fires with a bright impulse
 * that decays naturally. Tool events can re-impulse the spring.
 * Every ~8s of idle, a tiny self-impulse creates a subtle breathing
 * rhythm so the spinner never looks frozen.
 */
export function createSpinner(): Spinner {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let frame = 0;
  let currentLabel = '';
  let baseLabel = '';
  let phraseIndex = 0;
  let running = false;
  let startedAt = 0;
  let lastPhraseAt = 0;
  let lastBreathAt = 0;
  let spring: SpringState = { position: 0, velocity: 0 };

  function nextDelay(): number {
    return 55 + Math.random() * 40;
  }

  function render() {
    if (!running) return;
    const theme = getTheme();
    const glyph = sym.spinner[frame % sym.spinner.length];

    // Step the spring (~60fps equivalent timestep)
    spring = springStep(spring, 1 / 16);

    // Breathing: tiny self-impulse every ~8s when idle
    const now = Date.now();
    if (now - lastBreathAt > 8000) {
      spring.velocity += 3;
      lastBreathAt = now;
    }

    // Map spring position to color interpolation
    const intensity = Math.min(1, Math.abs(spring.position));
    const color = lerpHex(theme.muted, theme.accent, intensity);

    // Rotate thinking phrases every ~4s
    const elapsed = now - startedAt;
    if (elapsed > 3000 && now - lastPhraseAt > 4000 && baseLabel === currentLabel) {
      phraseIndex = (phraseIndex + 1) % thinkingPhrases.length;
      currentLabel = thinkingPhrases[phraseIndex];
      lastPhraseAt = now;
    }

    const line = `  ${chalk.hex(color)(glyph)} ${chalk.hex(theme.muted)(currentLabel)}`;
    if (isLayoutActive()) {
      // Render through layout footer -- gradient timer paints it
      setFooterLines([line]);
    } else {
      process.stderr.write(`\r\x1b[K${line}`);
    }
    frame++;
    timeout = setTimeout(render, nextDelay());
  }

  function start(label: string) {
    stop();
    currentLabel = label;
    baseLabel = label;
    phraseIndex = 0;
    frame = 0;
    running = true;
    startedAt = Date.now();
    lastPhraseAt = Date.now();
    lastBreathAt = Date.now();
    // Initial impulse -- spring fires bright
    spring = { position: 1.0, velocity: 0 };
    render();
  }

  function update(label: string) {
    currentLabel = label;
    baseLabel = label;
    lastPhraseAt = Date.now();
  }

  function impulse() {
    // External trigger (tool start/end) -- add energy to the spring
    spring.velocity += 6;
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
    running = false;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    if (isLayoutActive()) {
      clearFooterLines();
    } else {
      process.stderr.write('\r\x1b[K');
    }
  }

  return { start, update, impulse, succeed, fail, stop };
}
