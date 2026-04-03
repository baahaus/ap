import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GLOBAL_SKILLS_DIR = join(homedir(), '.blush', 'skills');
const BUILTIN_SKILLS_DIR = join(__dirname, '..', '..', '..', 'skills');

export interface Skill {
  name: string;
  trigger: string; // e.g., '/security-review'
  description?: string;
  tools?: string[]; // tool names this skill needs
  content: string; // the instruction content
  source: string; // file path
}

/**
 * Parse skill frontmatter from markdown.
 *
 * Format:
 * ```
 * ---
 * name: security-review
 * trigger: /security-review
 * description: Analyze changes for security vulnerabilities
 * tools: [read, grep, bash]
 * ---
 *
 * Analyze pending changes on the current branch...
 * ```
 */
function parseSkill(content: string, source: string): Skill | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2].trim();

  const meta: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      meta[key.trim()] = rest.join(':').trim();
    }
  }

  if (!meta.name || !meta.trigger) return null;

  let tools: string[] | undefined;
  if (meta.tools) {
    // Parse [read, grep, bash] format
    tools = meta.tools
      .replace(/[\[\]]/g, '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  return {
    name: meta.name,
    trigger: meta.trigger,
    description: meta.description,
    tools,
    content: body,
    source,
  };
}

export class SkillRegistry {
  private skills = new Map<string, Skill>();
  private activatedSkills = new Set<string>();

  async loadDirectory(dir: string): Promise<number> {
    if (!existsSync(dir)) return 0;

    let loaded = 0;
    const entries = await readdir(dir);

    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const fullPath = join(dir, entry);
      const content = await readFile(fullPath, 'utf-8');
      const skill = parseSkill(content, fullPath);
      if (skill) {
        this.skills.set(skill.name, skill);
        loaded++;
      }
    }

    return loaded;
  }

  async loadAll(cwd: string): Promise<number> {
    const initialCount = this.skills.size;
    const directories = [
      BUILTIN_SKILLS_DIR,
      GLOBAL_SKILLS_DIR,
      join(cwd, '.blush', 'skills'),
    ];
    const seenDirectories = new Set<string>();

    for (const directory of directories) {
      const normalizedDirectory = resolve(directory);
      if (seenDirectories.has(normalizedDirectory)) continue;
      seenDirectories.add(normalizedDirectory);
      await this.loadDirectory(directory);
    }

    return this.skills.size - initialCount;
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Find a skill by its trigger (e.g., '/security-review').
   */
  findByTrigger(trigger: string): Skill | undefined {
    for (const skill of this.skills.values()) {
      if (skill.trigger === trigger) return skill;
    }
    return undefined;
  }

  /**
   * Activate a skill -- returns its content for injection into context.
   * Skills are only activated once per session (progressive disclosure).
   */
  activate(name: string): string | null {
    const skill = this.skills.get(name);
    if (!skill) return null;
    if (this.activatedSkills.has(name)) return null; // Already active

    this.activatedSkills.add(name);
    return skill.content;
  }

  isActive(name: string): boolean {
    return this.activatedSkills.has(name);
  }

  getActiveSkillNames(): string[] {
    return [...this.activatedSkills];
  }
}
