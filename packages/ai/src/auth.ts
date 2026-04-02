import { execSync } from 'node:child_process';

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  subscriptionType?: string;
}

let cachedOAuth: OAuthCredentials | null = null;

/**
 * Read Claude Code's OAuth token from the macOS keychain.
 * This lets blush use your Anthropic subscription (Pro/Max) without a separate API key.
 */
export function getClaudeCodeOAuth(): OAuthCredentials | null {
  if (cachedOAuth) {
    if (cachedOAuth.expiresAt > Date.now()) {
      return cachedOAuth;
    }
    cachedOAuth = null;
  }

  try {
    const output = execSync(
      'security find-generic-password -s "Claude Code-credentials" -g 2>&1',
      { encoding: 'utf-8', timeout: 5000 },
    );

    const match = output.match(/password: "(.*?)"\n/s);
    if (!match) return null;

    let jsonStr = match[1];
    jsonStr = jsonStr.replace(/\\"/g, '"');

    const data = JSON.parse(jsonStr);
    const oauth = data.claudeAiOauth;

    if (!oauth?.accessToken) return null;

    cachedOAuth = {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt || 0,
      subscriptionType: oauth.subscriptionType,
    };

    return cachedOAuth;
  } catch {
    return null;
  }
}

/**
 * Get auth headers for the Anthropic API.
 * Prefers OAuth (subscription) over API key.
 *
 * OAuth requires specific headers:
 * - anthropic-beta must include oauth-2025-04-20 and claude-code-20250219
 * - user-agent must look like claude-cli
 * - x-app: cli
 */
export function getAnthropicAuthHeaders(apiKey?: string): {
  headers: Record<string, string>;
  queryParams?: string;
} {
  // Try OAuth first (Claude Pro/Max subscription)
  const oauth = getClaudeCodeOAuth();
  if (oauth) {
    return {
      headers: {
        'Authorization': `Bearer ${oauth.accessToken}`,
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05',
        'user-agent': 'claude-cli/2.1.90 (external, cli)',
        'x-app': 'cli',
      },
      queryParams: 'beta=true',
    };
  }

  // Fall back to API key
  if (apiKey) {
    return {
      headers: {
        'x-api-key': apiKey,
      },
    };
  }

  throw new Error(
    'No Anthropic auth found. Options:\n' +
    '  1. Log into Claude Code (uses your subscription automatically)\n' +
    '  2. ANTHROPIC_API_KEY environment variable\n' +
    '  3. ~/.blush/config.json: { "anthropic_api_key": "sk-..." }'
  );
}
