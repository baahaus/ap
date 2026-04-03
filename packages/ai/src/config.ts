import { readFileSync, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BLUSH_CONFIG_PATH = join(homedir(), '.blush', 'config.json');

export interface MCPServerEntry {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface BlushConfig {
  anthropic_api_key?: string;
  openai_api_key?: string;
  default_model?: string;
  default_theme?: string;
  default_provider?: string;
  mcpServers?: MCPServerEntry[];
}

// Backward-compatible alias for older imports.
export type ApConfig = BlushConfig;

let cached: BlushConfig | null = null;

export function loadConfig(): BlushConfig {
  if (cached) return cached;

  // Try ~/.blush/config.json
  if (existsSync(BLUSH_CONFIG_PATH)) {
    try {
      cached = JSON.parse(readFileSync(BLUSH_CONFIG_PATH, 'utf-8'));
      return cached!;
    } catch {
      console.error('Warning: ~/.blush/config.json is malformed, using defaults');
      return {};
    }
  }

  // Try .env file in cwd
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const env = readFileSync(envPath, 'utf-8');
    const config: BlushConfig = {};
    for (const line of env.split('\n')) {
      const [key, ...rest] = line.split('=');
      const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
      if (key?.trim() === 'ANTHROPIC_API_KEY') config.anthropic_api_key = val;
      if (key?.trim() === 'OPENAI_API_KEY') config.openai_api_key = val;
    }
    cached = config;
    return config;
  }

  cached = {};
  return {};
}

export function getApiKey(provider: 'anthropic' | 'openai'): string | undefined {
  const config = loadConfig();

  if (provider === 'anthropic') {
    return config.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  }
  if (provider === 'openai') {
    return config.openai_api_key || process.env.OPENAI_API_KEY;
  }

  return undefined;
}

export async function saveConfig(config: BlushConfig): Promise<void> {
  await mkdir(join(homedir(), '.blush'), { recursive: true });
  await writeFile(BLUSH_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  cached = config;
}

export async function updateConfig(patch: Partial<BlushConfig>): Promise<BlushConfig> {
  const nextConfig: BlushConfig = {
    ...loadConfig(),
    ...patch,
  };
  await saveConfig(nextConfig);
  return nextConfig;
}
