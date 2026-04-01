import { Type, type Static } from '@sinclair/typebox';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const WriteParams = Type.Object({
  file_path: Type.String({ description: 'Absolute path to the file to write' }),
  content: Type.String({ description: 'The content to write to the file' }),
});

export type WriteParams = Static<typeof WriteParams>;

export async function write(params: WriteParams): Promise<string> {
  const { file_path, content } = params;

  try {
    await mkdir(dirname(file_path), { recursive: true });
    await writeFile(file_path, content, 'utf-8');
    return `File written: ${file_path}`;
  } catch (err) {
    return `Error writing ${file_path}: ${(err as Error).message}`;
  }
}

export const writeTool = {
  name: 'write',
  description: 'Write content to a file. Creates directories as needed. Overwrites if exists.',
  input_schema: WriteParams,
  execute: write,
};
