import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool } from './bash.js';
import type { ToolDefinition } from '@ap/ai';

export { readTool, writeTool, editTool, bashTool };
export { read, type ReadParams } from './read.js';
export { write, type WriteParams } from './write.js';
export { edit, type EditParams } from './edit.js';
export { bash, type BashParams } from './bash.js';

export interface CoreTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<string>;
}

export const coreTools: CoreTool[] = [
  readTool as unknown as CoreTool,
  writeTool as unknown as CoreTool,
  editTool as unknown as CoreTool,
  bashTool as unknown as CoreTool,
];

export function getToolDefinitions(tools: CoreTool[]): ToolDefinition[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Record<string, unknown>,
  }));
}

export function findTool(name: string, tools: CoreTool[]): CoreTool | undefined {
  return tools.find((t) => t.name === name);
}
