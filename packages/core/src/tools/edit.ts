import { Type, type Static } from '@sinclair/typebox';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export const EditParams = Type.Object({
  file_path: Type.String({ description: 'Absolute path to the file to edit' }),
  old_string: Type.String({ description: 'The exact text to replace' }),
  new_string: Type.String({ description: 'The replacement text' }),
  replace_all: Type.Optional(Type.Boolean({ description: 'Replace all occurrences', default: false })),
});

export type EditParams = Static<typeof EditParams>;

export async function edit(params: EditParams): Promise<string> {
  const { file_path, old_string, new_string, replace_all = false } = params;

  if (!existsSync(file_path)) {
    return `Error: File not found: ${file_path}`;
  }

  if (old_string === new_string) {
    return 'Error: old_string and new_string are identical';
  }

  try {
    const content = await readFile(file_path, 'utf-8');

    if (!content.includes(old_string)) {
      return `Error: old_string not found in ${file_path}`;
    }

    if (!replace_all) {
      // Check uniqueness
      const firstIdx = content.indexOf(old_string);
      const secondIdx = content.indexOf(old_string, firstIdx + 1);
      if (secondIdx !== -1) {
        return `Error: old_string is not unique in ${file_path}. Found multiple occurrences. Use replace_all or provide more context.`;
      }
    }

    const updated = replace_all
      ? content.replaceAll(old_string, new_string)
      : content.replace(old_string, new_string);

    await writeFile(file_path, updated, 'utf-8');
    return `File edited: ${file_path}`;
  } catch (err) {
    return `Error editing ${file_path}: ${(err as Error).message}`;
  }
}

export const editTool = {
  name: 'edit',
  description: 'Replace exact text in a file. old_string must be unique unless replace_all is true.',
  input_schema: EditParams,
  execute: edit,
};
