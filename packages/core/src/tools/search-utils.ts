import { readdir, readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.turbo',
]);

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function globToRegex(pattern: string): RegExp {
  let regex = '^';

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const next = pattern[i + 1];
    const nextNext = pattern[i + 2];

    if (char === '*') {
      if (next === '*' && nextNext === '/') {
        regex += '(?:.*/)?';
        i += 2;
      } else if (next === '*') {
        regex += '.*';
        i++;
      } else {
        regex += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      regex += '[^/]';
      continue;
    }

    regex += escapeRegex(char);
  }

  return new RegExp(regex + '$');
}

export function resolveSearchRoot(path?: string): string {
  return resolve(path || process.cwd());
}

function hasGlobMagic(segment: string): boolean {
  return /[*?[]/.test(segment);
}

export function inferGlobSearchScope(pattern: string, path?: string): { root: string; pattern: string } {
  const baseRoot = resolveSearchRoot(path);
  const normalized = pattern.split(sep).join('/');
  const segments = normalized.split('/').filter(Boolean);

  if (!hasGlobMagic(normalized)) {
    const dir = dirname(normalized);
    return {
      root: resolve(baseRoot, dir === '.' ? '' : dir),
      pattern: basename(normalized),
    };
  }

  const literalSegments: string[] = [];
  let globStart = segments.length;
  for (const [index, segment] of segments.entries()) {
    if (hasGlobMagic(segment)) {
      globStart = index;
      break;
    }
    literalSegments.push(segment);
  }

  const root = literalSegments.length > 0
    ? resolve(baseRoot, literalSegments.join('/'))
    : baseRoot;
  const remainingSegments = segments.slice(globStart);

  return {
    root,
    pattern: remainingSegments.length > 0 ? remainingSegments.join('/') : '**',
  };
}

export function toPosixRelative(root: string, fullPath: string): string {
  return relative(root, fullPath).split(sep).join('/');
}

export async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries;

    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.gitignore') {
        if (entry.isDirectory() && !DEFAULT_IGNORED_DIRS.has(entry.name)) {
          queue.push(join(current, entry.name));
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORED_DIRS.has(entry.name)) {
          queue.push(join(current, entry.name));
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(join(current, entry.name));
      }
    }
  }

  return files;
}

export function isProbablyTextFile(filePath: string): boolean {
  try {
    return statSync(filePath).size <= 1024 * 1024;
  } catch {
    return false;
  }
}

export async function readTextIfPossible(filePath: string): Promise<string | null> {
  if (!isProbablyTextFile(filePath)) return null;

  try {
    const content = await readFile(filePath, 'utf-8');
    if (content.includes('\u0000')) return null;
    return content;
  } catch {
    return null;
  }
}
