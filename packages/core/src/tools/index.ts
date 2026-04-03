import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool } from './bash.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { todoTool } from './todo.js';
import { webFetchTool } from './web-fetch.js';
import { webSearchTool } from './web-search.js';
import type { ToolDefinition } from '@blushagent/ai';

export { readTool, writeTool, editTool, bashTool, globTool, grepTool, todoTool, webFetchTool, webSearchTool };
export { read, type ReadParams } from './read.js';
export { write, type WriteParams } from './write.js';
export { edit, type EditParams } from './edit.js';
export { bash, type BashParams } from './bash.js';
export { glob, type GlobParams } from './glob.js';
export { grep, type GrepParams } from './grep.js';
export { todo, type TodoParams, type TodoEntry } from './todo.js';
export { webFetch, type WebFetchParams } from './web-fetch.js';
export { webSearch, type WebSearchParams } from './web-search.js';

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
  globTool as unknown as CoreTool,
  grepTool as unknown as CoreTool,
  todoTool as unknown as CoreTool,
  webFetchTool as unknown as CoreTool,
  webSearchTool as unknown as CoreTool,
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
