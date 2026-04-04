import { readFileSync, existsSync, chmodSync } from 'node:fs';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
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
  favorite_models?: string[];
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
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
      // Skip lines without = (not key-value pairs)
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let val = trimmed.slice(eqIndex + 1).trim();
      // Strip matching surrounding quotes (single or double)
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key === 'ANTHROPIC_API_KEY') config.anthropic_api_key = val;
      if (key === 'OPENAI_API_KEY') config.openai_api_key = val;
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
  const dir = join(homedir(), '.blush');
  await mkdir(dir, { recursive: true });
  // Restrict directory to owner-only (contains API keys)
  await chmod(dir, 0o700);
  await writeFile(BLUSH_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
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
