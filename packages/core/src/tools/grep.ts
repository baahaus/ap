import { Type, type Static } from '@sinclair/typebox';
import { existsSync } from 'node:fs';
import {
  globToRegex,
  readTextIfPossible,
  resolveSearchRoot,
  toPosixRelative,
  walkFiles,
} from './search-utils.js';

export const GrepParams = Type.Object({
  pattern: Type.String({ description: 'Regular expression pattern to search for' }),
  path: Type.Optional(Type.String({ description: 'Directory to search from. Defaults to cwd.' })),
  glob: Type.Optional(Type.String({ description: 'Optional glob filter for file paths, e.g. **/*.ts' })),
  case_insensitive: Type.Optional(Type.Boolean({ description: 'Match without case sensitivity', default: false })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of matching lines to return', minimum: 1, default: 100 })),
});

export type GrepParams = Static<typeof GrepParams>;

export async function grep(params: GrepParams): Promise<string> {
  const {
    pattern,
    path,
    glob: fileGlob,
    case_insensitive = false,
    limit = 100,
  } = params;
  const root = resolveSearchRoot(path);

  if (!existsSync(root)) {
    return `Error: Search path not found: ${root}`;
  }

  let matcher: RegExp;
  try {
    matcher = new RegExp(pattern, case_insensitive ? 'i' : '');
  } catch (err) {
    return `Error: Invalid regex pattern "${pattern}": ${(err as Error).message}`;
  }

  const fileMatcher = fileGlob ? globToRegex(fileGlob) : null;
  const files = await walkFiles(root);
  const matches: string[] = [];

  for (const file of files) {
    const rel = toPosixRelative(root, file);
    if (fileMatcher && !fileMatcher.test(rel) && !fileMatcher.test(rel.split('/').pop() || '')) {
      continue;
    }

    const content = await readTextIfPossible(file);
    if (!content) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!matcher.test(lines[i])) continue;
      const line = lines[i].length > 500 ? lines[i].slice(0, 500) + '...' : lines[i];
      matches.push(`${file}:${i + 1}\t${line}`);
      if (matches.length >= limit) {
        return [
          `Matched ${matches.length}+ line${matches.length === 1 ? '' : 's'} for /${pattern}/ under ${root}:`,
          ...matches,
        ].join('\n');
      }
    }
  }

  if (matches.length === 0) {
    return `No matches for /${pattern}/ under ${root}`;
  }

  return [
    `Matched ${matches.length} line${matches.length === 1 ? '' : 's'} for /${pattern}/ under ${root}:`,
    ...matches,
  ].join('\n');
}

export const grepTool = {
  name: 'grep',
  description: 'Search file contents with a regular expression and return matching lines.',
  input_schema: GrepParams,
  execute: grep,
};
