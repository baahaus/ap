import { Type, type Static } from '@sinclair/typebox';
import { existsSync } from 'node:fs';
import { globToRegex, inferGlobSearchScope, toPosixRelative, walkFiles } from './search-utils.js';

export const GlobParams = Type.Object({
  pattern: Type.String({ description: 'Glob pattern to match, e.g. **/*.ts or package.json' }),
  path: Type.Optional(Type.String({ description: 'Directory to search from. Defaults to cwd.' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of results to return', minimum: 1, default: 200 })),
});

export type GlobParams = Static<typeof GlobParams>;

export async function glob(params: GlobParams): Promise<string> {
  const { pattern, path, limit = 200 } = params;
  const scope = inferGlobSearchScope(pattern, path);
  const root = scope.root;

  if (!existsSync(root)) {
    return `Error: Search path not found: ${root}`;
  }

  const matcher = globToRegex(scope.pattern);
  const files = await walkFiles(root);
  const matches = files
    .map((file) => ({ file, rel: toPosixRelative(root, file) }))
    .filter(({ rel }) => matcher.test(rel) || matcher.test(rel.split('/').pop() || ''))
    .slice(0, limit);

  if (matches.length === 0) {
    return `No files matched "${pattern}" under ${root}`;
  }

  const lines = [
    `Matched ${matches.length} file${matches.length === 1 ? '' : 's'} for "${pattern}" under ${root}:`,
    ...matches.map(({ file }) => file),
  ];

  return lines.join('\n');
}

export const globTool = {
  name: 'glob',
  description: 'Find files by glob pattern under a directory.',
  input_schema: GlobParams,
  execute: glob,
};
