/**
 * Blush themes -- each one is a mood, not just a color scheme.
 *
 * Design principles:
 * - Never pure black or pure white. Always tinted.
 * - Warm neutrals by default. Even cool themes have warmth.
 * - The prompt color IS the personality.
 * - Dim text is a shade of the background, not gray.
 */
export interface Theme {
  name: string;
  label: string;        // human-friendly name for display
  prompt: string;       // hex -- prompt character, the loudest color
  accent: string;       // hex -- tool names, commands, highlights
  text: string;         // hex -- primary body text
  dim: string;          // hex -- timestamps, secondary info, leaders
  muted: string;        // hex -- very subtle, borders, rules
  error: string;        // hex -- errors, failures
  success: string;      // hex -- success, applied, done
  warning: string;      // hex -- caution, in-progress
  border: string;       // hex -- box drawing, dividers
  highlight: string;    // hex -- selected items, search matches
}

export const themes: Record<string, Theme> = {
  blush: {
    name: 'blush',
    label: 'Blush',
    prompt: '#E8786F',     // warm coral -- THE blush color
    accent: '#D4A574',     // warm gold
    text: '#E8DDD3',       // cream
    dim: '#8A7E74',        // warm taupe
    muted: '#5A524B',      // dark taupe
    error: '#D9534F',      // warm red
    success: '#7DB88F',    // sage green
    warning: '#D4A574',    // amber (shared with accent intentionally)
    border: '#6B6059',     // warm brown
    highlight: '#E8786F',  // same as prompt for cohesion
  },

  mono: {
    name: 'mono',
    label: 'Monochrome',
    prompt: '#C8BEB4',     // warm off-white
    accent: '#E8DDD3',     // cream highlight
    text: '#B0A89E',       // warm gray
    dim: '#6B6460',        // dark warm gray
    muted: '#4A4542',      // darker
    error: '#C87070',      // muted red
    success: '#8AAA8A',    // muted green
    warning: '#B8A070',    // muted gold
    border: '#5A5450',     // border gray
    highlight: '#D8CEC4',  // bright cream
  },

  ocean: {
    name: 'ocean',
    label: 'Deep Ocean',
    prompt: '#5CB8B2',     // warm teal
    accent: '#7AD4CA',     // seafoam
    text: '#D4E8E4',       // cool cream
    dim: '#6A8A86',        // teal-gray
    muted: '#3E5A58',      // deep teal
    error: '#D47070',      // warm coral-red
    success: '#7AD4A0',    // mint
    warning: '#D4B870',    // sand
    border: '#4A706C',     // ocean border
    highlight: '#5CB8B2',  // teal
  },

  forest: {
    name: 'forest',
    label: 'Old Growth',
    prompt: '#6AAF6A',     // rich green
    accent: '#C4A862',     // amber-gold
    text: '#D4DCD0',       // pale sage
    dim: '#7A8A70',        // green-gray
    muted: '#4A5A44',      // dark green
    error: '#C87060',      // autumn red
    success: '#6AAF6A',    // green (same as prompt)
    warning: '#C4A862',    // gold
    border: '#5A6A52',     // forest border
    highlight: '#8ACF8A',  // bright green
  },

  sunset: {
    name: 'sunset',
    label: 'Golden Hour',
    prompt: '#E89050',     // warm amber
    accent: '#E8786F',     // coral
    text: '#F0E4D8',       // warm cream
    dim: '#9A8474',        // dusty brown
    muted: '#6A5A4E',      // dark brown
    error: '#D05050',      // deep red
    success: '#8AB880',    // olive green
    warning: '#E8B050',    // gold
    border: '#7A6A5E',     // brown border
    highlight: '#E89050',  // amber
  },

  rose: {
    name: 'rose',
    label: 'Rose Garden',
    prompt: '#D87090',     // dusty rose
    accent: '#E8A0B0',     // light pink
    text: '#EAE0E2',       // blush cream
    dim: '#8A7078',        // mauve-gray
    muted: '#5A4A50',      // dark mauve
    error: '#C05060',      // deep rose
    success: '#80B890',    // sage
    warning: '#D8A870',    // peach
    border: '#6A5A60',     // mauve border
    highlight: '#E8809A',  // bright rose
  },

  hacker: {
    name: 'hacker',
    label: 'Phosphor',
    prompt: '#50D050',     // phosphor green
    accent: '#40B040',     // darker green
    text: '#A0D8A0',       // light green
    dim: '#407040',        // forest
    muted: '#2A4A2A',      // deep green
    error: '#D06040',      // amber-red
    success: '#50D050',    // bright green
    warning: '#C0C040',    // yellow-green
    border: '#306030',     // green border
    highlight: '#60E860',  // neon green
  },
};

let activeTheme: Theme = themes.blush;

export function setTheme(name: string): boolean {
  const theme = themes[name];
  if (!theme) return false;
  activeTheme = theme;
  return true;
}

export function getTheme(): Theme {
  return activeTheme;
}

export function listThemes(): string[] {
  return Object.keys(themes);
}
