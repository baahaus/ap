import { execSync } from 'node:child_process';

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  subscriptionType?: string;
}

let cachedOAuth: OAuthCredentials | null = null;

/**
 * Read OAuth token from the macOS keychain (stored by Claude Code).
 * Blush piggybacks off Claude Code's subscription credentials.
 */
export function getSubscriptionOAuth(): OAuthCredentials | null {
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

export type AuthMode = 'api_key' | 'oauth';

export interface AnthropicAuth {
  mode: AuthMode;
  headers: Record<string, string>;
  queryParams?: string;
}

/**
 * Get auth for the Anthropic API.
 *
 * Priority:
 * 1. API key
 * 2. OAuth from Claude Code subscription (auto-detected from keychain)
 */
export function getAnthropicAuth(apiKey?: string): AnthropicAuth {
  // Prefer API key when explicitly configured.
  if (apiKey) {
    return {
      mode: 'api_key',
      headers: { 'x-api-key': apiKey },
    };
  }

  // Fall back to env var OAuth token (for containers / CI where keychain is unavailable).
  const envToken = process.env.BLUSH_OAUTH_TOKEN;
  if (envToken) {
    return {
      mode: 'oauth',
      headers: {
        'Authorization': `Bearer ${envToken}`,
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05',
        'user-agent': 'claude-cli/2.1.90 (external, cli)',
        'x-app': 'cli',
      },
      queryParams: 'beta=true',
    };
  }

  // Fall back to subscription OAuth credentials when available.
  const oauth = getSubscriptionOAuth();
  if (oauth) {
    return {
      mode: 'oauth',
      headers: {
        'Authorization': `Bearer ${oauth.accessToken}`,
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05',
        'user-agent': 'claude-cli/2.1.90 (external, cli)',
        'x-app': 'cli',
      },
      queryParams: 'beta=true',
    };
  }

  throw new Error(
    'No Anthropic auth found. Options:\n' +
    '  1. ANTHROPIC_API_KEY env var or ~/.blush/config.json\n' +
    '  2. Claude subscription (auto-detected from keychain)\n' +
    '\n' +
    'Get an API key at: https://console.anthropic.com/settings/keys'
  );
}
