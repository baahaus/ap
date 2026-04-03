import { Type, type Static } from '@sinclair/typebox';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export const ReadParams = Type.Object({
  file_path: Type.String({ description: 'Absolute path to the file to read' }),
  offset: Type.Optional(Type.Number({ description: 'Line number to start reading from (0-based)', minimum: 0 })),
  limit: Type.Optional(Type.Number({ description: 'Number of lines to read', minimum: 1 })),
});

export type ReadParams = Static<typeof ReadParams>;

export async function read(params: ReadParams): Promise<string> {
  const { file_path, offset = 0, limit = 2000 } = params;

  if (!existsSync(file_path)) {
    return `Error: File not found: ${file_path}`;
  }

  try {
    const content = await readFile(file_path, 'utf-8');
    const lines = content.split('\n');
    const slice = lines.slice(offset, offset + limit);

    // Format with line numbers (1-based)
    let result = slice
      .map((line, i) => `${offset + i + 1}\t${line}`)
      .join('\n');

    // Hard cap: truncate to ~30k chars (~8k tokens) to protect context window
    const MAX_OUTPUT = 30_000;
    if (result.length > MAX_OUTPUT) {
      result = result.slice(0, MAX_OUTPUT) + `\n\n[truncated: output exceeded ${MAX_OUTPUT} chars. Use offset/limit to read specific sections.]`;
    }
    return result;
  } catch (err) {
    return `Error reading ${file_path}: ${(err as Error).message}`;
  }
}

export const readTool = {
  name: 'read',
  description: 'Read a file from the filesystem. Returns content with line numbers.',
  input_schema: ReadParams,
  execute: read,
};
