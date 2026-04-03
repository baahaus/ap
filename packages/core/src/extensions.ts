import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { ToolDefinition } from '@blushagent/ai';

const GLOBAL_EXT_DIR = join(homedir(), '.blush', 'extensions');

export type CommandHandler = (args: string) => Promise<void>;
export type EventHandler = (data: unknown) => Promise<void>;

export interface ExtensionTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<string>;
}

export interface BlushContext {
  tools: {
    register: (tool: ExtensionTool) => void;
    list: () => ExtensionTool[];
  };
  commands: {
    register: (name: string, handler: CommandHandler) => void;
    list: () => Map<string, CommandHandler>;
  };
  events: {
    on: (event: string, handler: EventHandler) => void;
    emit: (event: string, data: unknown) => Promise<void>;
  };
  context: {
    append: (text: string) => void;
    getAppended: () => string[];
  };
}

export interface ExtensionModule {
  default: (blush: BlushContext) => void | Promise<void>;
}

export class ExtensionManager {
  private tools: ExtensionTool[] = [];
  private commands = new Map<string, CommandHandler>();
  private eventHandlers = new Map<string, EventHandler[]>();
  private appendedContext: string[] = [];

  createContext(): BlushContext {
    return {
      tools: {
        register: (tool) => {
          this.tools.push(tool);
        },
        list: () => [...this.tools],
      },
      commands: {
        register: (name, handler) => {
          // Normalize: strip leading /
          const normalized = name.startsWith('/') ? name.slice(1) : name;
          this.commands.set(normalized, handler);
        },
        list: () => new Map(this.commands),
      },
      events: {
        on: (event, handler) => {
          const handlers = this.eventHandlers.get(event) || [];
          handlers.push(handler);
          this.eventHandlers.set(event, handlers);
        },
        emit: async (event, data) => {
          await this.emit(event, data);
        },
      },
      context: {
        append: (text) => {
          this.appendedContext.push(text);
        },
        getAppended: () => [...this.appendedContext],
      },
    };
  }

  async loadDirectory(dir: string): Promise<number> {
    if (!existsSync(dir)) return 0;

    let loaded = 0;
    const entries = await readdir(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);

      // Load .js and .mjs files
      if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
        try {
          const url = pathToFileURL(resolve(fullPath)).href;
          const mod = (await import(url)) as ExtensionModule;
          if (typeof mod.default === 'function') {
            await mod.default(this.createContext());
            loaded++;
          }
        } catch (err) {
          console.error(`Failed to load extension ${entry}: ${(err as Error).message}`);
        }
      }
    }

    return loaded;
  }

  async loadAll(cwd: string): Promise<number> {
    let total = 0;

    // Global extensions
    total += await this.loadDirectory(GLOBAL_EXT_DIR);

    // Project extensions
    total += await this.loadDirectory(join(cwd, '.blush', 'extensions'));

    return total;
  }

  getTools(): ExtensionTool[] {
    return [...this.tools];
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  getCommand(name: string): CommandHandler | undefined {
    return this.commands.get(name);
  }

  getAllCommands(): Map<string, CommandHandler> {
    return new Map(this.commands);
  }

  async emit(event: string, data: unknown): Promise<void> {
    const handlers = this.eventHandlers.get(event) || [];
    for (const handler of handlers) {
      await handler(data);
    }
  }

  getAppendedContext(): string[] {
    return [...this.appendedContext];
  }
}
