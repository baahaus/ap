/**
 * Centralized Unicode symbols for consistent visual identity.
 * Every glyph chosen for warmth and expressiveness.
 */
export const sym = {
  // Prompt & interaction
  prompt: '\u203a',         // › single right-pointing angle
  promptAlt: '\u25c6',      // ◆ diamond (active/focused)
  input: '\u25b8',          // ▸ right-pointing small triangle

  // Tool execution
  toolRun: '\u2726',        // ✦ four-pointed star
  toolDone: '\u2713',       // ✓ check mark
  toolFail: '\u2717',       // ✗ ballot x
  toolExpand: '\u25be',     // ▾ down-pointing triangle
  toolCollapse: '\u25b4',   // ▴ up-pointing triangle

  // Status & state
  dot: '\u00b7',            // · middle dot
  bullet: '\u2022',         // • bullet
  dash: '\u2013',           // – en dash
  ellipsis: '\u2026',       // … ellipsis
  arrow: '\u2192',          // → rightwards arrow
  sparkle: '\u2728',        // ✨ sparkles (for delight moments)

  // Box drawing (rounded corners = warmth)
  boxTL: '\u256d',          // ╭
  boxTR: '\u256e',          // ╮
  boxBL: '\u2570',          // ╰
  boxBR: '\u256f',          // ╯
  boxH: '\u2500',           // ─
  boxV: '\u2502',           // │
  boxVR: '\u251c',          // ├
  boxVL: '\u2524',          // ┤

  // Progress & loading
  spinner: ['\u2801', '\u2809', '\u2819', '\u2838', '\u2830', '\u2824', '\u2806', '\u2807'] as const,
  progressFull: '\u2588',   // █
  progressMid: '\u2593',    // ▓
  progressLight: '\u2591',  // ░
  progressEmpty: '\u2500',  // ─

  // Separators
  thinRule: '\u2508',       // ┈ thin dashed
  thickRule: '\u2500',      // ─ solid
  dotRule: '\u00b7',        // · repeated for dotted rule

  // Context & info
  branch: '\u2387',         // ⎇ alternative
  session: '\u25c9',        // ◉ fisheye
  team: '\u2261',           // ≡ identical to (hamburger)
} as const;

/** Build a dotted leader between label and value */
export function dotLeader(label: string, value: string, width: number): string {
  const padding = Math.max(2, width - label.length - value.length);
  return `${label} ${sym.dotRule.repeat(padding)} ${value}`;
}

/** Build a horizontal rule */
export function rule(width: number, char: string = sym.thickRule): string {
  return char.repeat(Math.min(width, process.stdout.columns || 80));
}

/** Build a rounded box around content */
export function box(lines: string[], width: number): string[] {
  const inner = width - 4;
  const result: string[] = [];

  result.push(`${sym.boxTL}${sym.boxH.repeat(inner + 2)}${sym.boxTR}`);
  for (const line of lines) {
    const padded = line.padEnd(inner);
    result.push(`${sym.boxV} ${padded} ${sym.boxV}`);
  }
  result.push(`${sym.boxBL}${sym.boxH.repeat(inner + 2)}${sym.boxBR}`);

  return result;
}
