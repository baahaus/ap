import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CURL_META_SENTINEL = '__BLUSH_CURL_META__';
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'spm',
]);

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

export function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ \f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlToText(html: string): string {
  const withoutNonContent = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, '');

  const withStructure = withoutNonContent
    .replace(/<(?:main|article)[^>]*>/gi, '\n')
    .replace(/<\/(?:main|article|section|div|header|aside|blockquote|table|tbody|thead|tfoot)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' ')
    .replace(/<th[^>]*>/gi, ' ')
    .replace(/<\/(p|section|h\d|ul|ol|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  const stripped = withStructure.replace(/<[^>]+>/g, ' ');
  return normalizeWhitespace(decodeHtmlEntities(stripped));
}

export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  return normalizeWhitespace(decodeHtmlEntities(match[1]));
}

export function extractMetaDescription(html: string): string | null {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return normalizeWhitespace(decodeHtmlEntities(match[1]));
    }
  }

  return null;
}

function decodeSearchHref(href: string): string | null {
  try {
    if (href.startsWith('//')) {
      return `https:${href}`;
    }

    if (href.startsWith('/l/?') || href.startsWith('https://duckduckgo.com/l/?')) {
      const url = new URL(href, 'https://duckduckgo.com');
      const uddg = url.searchParams.get('uddg');
      return uddg ? decodeURIComponent(uddg) : null;
    }

    if (href.startsWith('http://') || href.startsWith('https://')) {
      return href;
    }
  } catch {
    return null;
  }

  return null;
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet?: string;
}

export function extractDuckDuckGoResults(html: string, limit = 8): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  const pattern = /<a[^>]+class="[^"]*(?:result__a|result-link)[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const url = decodeSearchHref(match[1]);
    if (!url || seen.has(url)) continue;

    const title = normalizeWhitespace(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ')));
    if (!title || title.length < 3 || title.toLowerCase().includes('duckduckgo')) continue;

    seen.add(url);
    results.push({ title, url });
    if (results.length >= limit) break;
  }

  return results;
}

export function extractDuckDuckGoLiteResults(html: string, limit = 8): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const url = decodeSearchHref(match[1]);
    if (!url || seen.has(url)) continue;

    const title = normalizeWhitespace(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ')));
    if (!title || title.length < 3 || /duckduckgo|next page|feedback/i.test(title)) continue;

    seen.add(url);
    results.push({ title, url });
    if (results.length >= limit) break;
  }

  return results;
}

export function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeDomainFilter(domain: string): string {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) return '';

  try {
    const url = trimmed.includes('://') ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return trimmed.replace(/^www\./, '').replace(/\/.*$/, '');
  }
}

function hostMatchesFilter(hostname: string, filter: string): boolean {
  return hostname === filter || hostname.endsWith(`.${filter}`);
}

export function domainMatches(
  urlString: string,
  allowedDomains?: string[],
  blockedDomains?: string[],
): boolean {
  try {
    const hostname = new URL(urlString).hostname.toLowerCase().replace(/^www\./, '');
    const blocked = (blockedDomains || []).map(normalizeDomainFilter).filter(Boolean);
    const allowed = (allowedDomains || []).map(normalizeDomainFilter).filter(Boolean);

    if (blocked.some((domain) => hostMatchesFilter(hostname, domain))) {
      return false;
    }

    if (allowed.length > 0) {
      return allowed.some((domain) => hostMatchesFilter(hostname, domain));
    }

    return true;
  } catch {
    return false;
  }
}

export function normalizeUrlForDedup(urlString: string): string {
  try {
    const url = new URL(urlString);
    url.hash = '';

    const retained = new URLSearchParams();
    for (const [key, value] of url.searchParams.entries()) {
      const lowered = key.toLowerCase();
      if (lowered.startsWith('utm_') || TRACKING_PARAMS.has(lowered)) continue;
      retained.append(key, value);
    }

    url.search = retained.toString();

    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return urlString.trim();
  }
}

export function dedupeSearchResults(results: SearchResultItem[]): SearchResultItem[] {
  const deduped: SearchResultItem[] = [];
  const seen = new Set<string>();

  for (const item of results) {
    const normalizedUrl = normalizeUrlForDedup(item.url);
    if (!normalizedUrl || seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    deduped.push({
      ...item,
      url: normalizedUrl,
      snippet: normalizeSearchSnippet(item.snippet),
    });
  }

  return deduped;
}

export function normalizeSearchSnippet(snippet?: string, maxChars = 240): string | undefined {
  if (!snippet) return undefined;
  const normalized = normalizeWhitespace(decodeHtmlEntities(snippet.replace(/<[^>]+>/g, ' ')));
  if (!normalized) return undefined;
  return truncateText(normalized, maxChars);
}

export function looksLikeWeatherQuery(query: string): boolean {
  const lowered = query.toLowerCase();
  return /\b(weather|forecast|temperature|rain|snow|wind|humidity|tomorrow|tonight|hourly)\b/.test(lowered);
}

export function looksLikeLocationOnlyQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;

  if (/^\d{5}(?:-\d{4})?$/.test(trimmed)) {
    return true;
  }

  if (/^[a-zA-Z .'-]+,\s*[A-Z]{2}$/.test(trimmed) || /^[a-zA-Z .'-]+\s+[A-Z]{2}$/.test(trimmed)) {
    return true;
  }

  if (/^[a-zA-Z .'-]+,\s*[A-Za-z ]+$/.test(trimmed)) {
    return true;
  }

  return false;
}

export interface FetchTextResponse {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  text: string;
  headers: Record<string, string>;
  via: 'fetch' | 'curl';
}

function parseHeaderLines(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[key] = value;
  }

  return headers;
}

function splitCurlHeadersAndBody(stdout: string): { headerLines: string[]; body: string } {
  const normalized = stdout.replace(/\r\n/g, '\n');
  const separator = normalized.lastIndexOf('\n\n');

  if (separator < 0) {
    return { headerLines: [], body: normalized };
  }

  const rawHeaders = normalized.slice(0, separator);
  const body = normalized.slice(separator + 2);
  const headerBlocks = rawHeaders.split('\n\n');
  const headerLines = (headerBlocks.pop() || '').split('\n').filter(Boolean);

  return { headerLines, body };
}

async function fetchWithCurl(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<FetchTextResponse> {
  const args = [
    '-L',
    '-sS',
    '--compressed',
    '--max-time',
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    ...Object.entries(headers).flatMap(([key, value]) => ['-H', `${key}: ${value}`]),
    '-D',
    '-',
    '-w',
    `\n${CURL_META_SENTINEL} {"http_code":"%{http_code}","content_type":"%{content_type}","url_effective":"%{url_effective}"}`,
    url,
  ];

  const { stdout } = await execFileAsync('curl', args, {
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
  });

  const sentinelIndex = stdout.lastIndexOf(CURL_META_SENTINEL);
  const stdoutWithoutMeta = sentinelIndex >= 0 ? stdout.slice(0, sentinelIndex).trimEnd() : stdout;
  const metaRaw = sentinelIndex >= 0
    ? stdout.slice(sentinelIndex + CURL_META_SENTINEL.length).trim()
    : '{}';
  const meta = JSON.parse(metaRaw) as {
    http_code?: string;
    content_type?: string;
    url_effective?: string;
  };

  const { headerLines, body } = splitCurlHeadersAndBody(stdoutWithoutMeta);
  const headersMap = parseHeaderLines(headerLines);
  const status = Number(meta.http_code || headerLines[0]?.match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/)?.[1] || 0);
  const contentType = meta.content_type || headersMap['content-type'] || 'application/octet-stream';
  const finalUrl = meta.url_effective || url;

  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    contentType,
    text: body,
    headers: headersMap,
    via: 'curl',
  };
}

export async function fetchTextWithFallback(
  url: string,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    retryWithCurlOnHttpError?: boolean;
  },
): Promise<FetchTextResponse> {
  const headers = options?.headers || {};
  const timeoutMs = options?.timeoutMs || 15000;
  const retryWithCurlOnHttpError = options?.retryWithCurlOnHttpError ?? false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Cap response body to 5MB to prevent memory exhaustion from huge responses
  const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

  try {
    const response = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });

    // Check Content-Length header before reading body
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      return {
        ok: false,
        status: response.status,
        url: response.url || url,
        contentType: response.headers.get('content-type') || 'application/octet-stream',
        text: `Error: Response too large (${contentLength} bytes, max ${MAX_RESPONSE_BYTES})`,
        headers: Object.fromEntries(response.headers.entries()),
        via: 'fetch',
      };
    }

    const text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
    const result: FetchTextResponse = {
      ok: response.ok,
      status: response.status,
      url: response.url || url,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      text,
      headers: Object.fromEntries(response.headers.entries()),
      via: 'fetch',
    };

    if (!result.ok && retryWithCurlOnHttpError) {
      return await fetchWithCurl(url, headers, timeoutMs);
    }

    return result;
  } catch {
    return await fetchWithCurl(url, headers, timeoutMs);
  } finally {
    clearTimeout(timeout);
  }
}

export function isProbablyHtml(contentType: string, body: string): boolean {
  return contentType.includes('text/html') || /<html[\s>]|<body[\s>]|<main[\s>]/i.test(body);
}

export function isProbablyJson(contentType: string, body: string): boolean {
  if (contentType.includes('application/json') || contentType.endsWith('+json')) {
    return true;
  }

  const trimmed = body.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

export function isTextLikeContentType(contentType: string): boolean {
  return (
    contentType.startsWith('text/')
    || contentType.includes('json')
    || contentType.includes('xml')
    || contentType.includes('javascript')
    || contentType.includes('xhtml')
  );
}

export function formatJsonText(input: string, maxChars: number): string {
  try {
    const parsed = JSON.parse(input);
    return truncateText(JSON.stringify(parsed, null, 2), maxChars);
  } catch {
    return truncateText(normalizeWhitespace(input), maxChars);
  }
}
