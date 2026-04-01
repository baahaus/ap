import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const AP_DIR = join(homedir(), '.ap');
const CONTEXT_FILES = ['AGENTS.md', 'CLAUDE.md'];

interface ContextSource {
  path: string;
  content: string;
}

/**
 * Assemble system prompt from context files.
 *
 * Priority order:
 * 1. SYSTEM.md (full override if exists)
 * 2. Base system prompt
 * 3. Global context (~/.ap/AGENTS.md, ~/.ap/CLAUDE.md)
 * 4. Directory-walk context (cwd up to root)
 * 5. APPEND_SYSTEM.md additions
 */
export async function assembleContext(cwd: string): Promise<string> {
  // Check for full override
  const systemOverride = join(cwd, 'SYSTEM.md');
  if (existsSync(systemOverride)) {
    return await readFile(systemOverride, 'utf-8');
  }

  const parts: string[] = [BASE_SYSTEM_PROMPT];

  // Global context files
  for (const file of CONTEXT_FILES) {
    const globalPath = join(AP_DIR, file);
    if (existsSync(globalPath)) {
      parts.push(await readFile(globalPath, 'utf-8'));
    }
  }

  // Walk directories from cwd to root for context files
  const sources = await walkContextFiles(cwd);
  for (const source of sources) {
    parts.push(`# ${source.path}\n${source.content}`);
  }

  // Append system additions
  const appendPath = join(cwd, 'APPEND_SYSTEM.md');
  if (existsSync(appendPath)) {
    parts.push(await readFile(appendPath, 'utf-8'));
  }

  return parts.join('\n\n');
}

async function walkContextFiles(cwd: string): Promise<ContextSource[]> {
  const sources: ContextSource[] = [];
  let dir = resolve(cwd);
  const root = resolve('/');
  const seen = new Set<string>();

  while (dir !== root) {
    for (const file of CONTEXT_FILES) {
      const path = join(dir, file);
      if (existsSync(path) && !seen.has(path)) {
        seen.add(path);
        const content = await readFile(path, 'utf-8');
        sources.push({ path, content });
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  return sources.reverse(); // Root first, most specific last
}

const BASE_SYSTEM_PROMPT = `You are AP, a terminal coding agent from ap.haus.

You have 4 tools: read, write, edit, bash. Use them to help the user with software engineering tasks.

Be direct. Lead with the action, not the reasoning. Skip preamble.

When editing files, read them first. Prefer editing over creating new files.

Do not add features, refactor code, or make improvements beyond what was asked.`;
