export function prefixStreamChunk(
  text: string,
  prefix: string | { first: string; continuation?: string },
  lineStart = true,
): { output: string; lineStart: boolean } {
  let output = '';
  let atLineStart = lineStart;
  let usedChunkPrefix = false;
  const parts = text.split('\n');
  const firstPrefix = typeof prefix === 'string' ? prefix : prefix.first;
  const continuationPrefix = typeof prefix === 'string' ? prefix : (prefix.continuation || prefix.first);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.length > 0) {
      if (atLineStart) {
        output += !usedChunkPrefix ? firstPrefix : continuationPrefix;
        usedChunkPrefix = true;
        atLineStart = false;
      }
      output += part;
    }

    if (i < parts.length - 1) {
      output += '\n';
      atLineStart = true;
    }
  }

  return { output, lineStart: atLineStart };
}

export function assistantPrefix(prefixLabel: string, continuationPrefix: string): {
  first: string;
  continuation: string;
} {
  return {
    first: prefixLabel,
    continuation: continuationPrefix,
  };
}

function truncateSingleLine(text: string, maxLength = 56): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength - 1).trimEnd() + '\u2026';
}

export function summarizeToolInput(name: string, input: Record<string, unknown>): string | undefined {
  if (name === 'bash' && typeof input.command === 'string' && input.command.trim()) {
    return truncateSingleLine(input.command);
  }

  if ((name === 'read' || name === 'write' || name === 'edit') && typeof input.file === 'string') {
    return truncateSingleLine(input.file, 48);
  }

  if (name === 'grep' && typeof input.pattern === 'string') {
    const path = typeof input.path === 'string' ? ` in ${input.path}` : '';
    return truncateSingleLine(`${input.pattern}${path}`);
  }

  if (name === 'glob' && typeof input.pattern === 'string') {
    return truncateSingleLine(input.pattern);
  }

  if (name === 'web_search' && typeof input.query === 'string') {
    return truncateSingleLine(input.query);
  }

  if (name === 'web_fetch' && typeof input.url === 'string') {
    return truncateSingleLine(input.url);
  }

  if (name === 'todo' && typeof input.action === 'string') {
    return truncateSingleLine(input.action);
  }

  return undefined;
}
