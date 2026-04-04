import { Type, type Static } from '@sinclair/typebox';
import {
  dedupeSearchResults,
  domainMatches,
  extractDuckDuckGoLiteResults,
  extractDuckDuckGoResults,
  fetchTextWithFallback,
  looksLikeLocationOnlyQuery,
  looksLikeWeatherQuery,
  normalizeSearchSnippet,
  truncateText,
  type SearchResultItem,
} from './web-utils.js';

export const WebSearchParams = Type.Object({
  query: Type.String({ description: 'Search query' }),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of results to return', minimum: 1, maximum: 10, default: 5 })),
  allowed_domains: Type.Optional(Type.Array(Type.String({ description: 'Restrict results to these domains' }))),
  blocked_domains: Type.Optional(Type.Array(Type.String({ description: 'Exclude results from these domains' }))),
  timeout_ms: Type.Optional(Type.Number({ description: 'Request timeout in milliseconds', minimum: 1000, default: 15000 })),
});

export type WebSearchParams = Static<typeof WebSearchParams>;

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
}

interface SerpapiOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface SearchProvider {
  name: string;
  search: (query: string, limit: number, timeoutMs: number) => Promise<SearchResultItem[]>;
}

interface SearchCollection {
  results: SearchResultItem[];
  providers: string[];
  queries: string[];
}

async function searchWithBrave(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(limit));

    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'x-subscription-token': apiKey,
      },
      signal: controller.signal,
    });

    if (!response.ok) return [];

    const data = await response.json() as { web?: { results?: BraveResult[] } };
    return (data.web?.results || [])
      .filter((item): item is Required<Pick<BraveResult, 'title' | 'url'>> & BraveResult => Boolean(item.title && item.url))
      .map((item) => ({
        title: item.title!,
        url: item.url!,
        snippet: item.description,
      }))
      .slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWithSerpapi(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // NOTE: SerpAPI requires the API key as a query parameter (their API design).
    // This means the key appears in URL and may be logged by proxies/intermediaries.
    // Prefer Brave Search or Tavily which use headers/body for authentication.
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('num', String(limit));

    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];

    const data = await response.json() as { organic_results?: SerpapiOrganicResult[] };
    return (data.organic_results || [])
      .filter((item): item is Required<Pick<SerpapiOrganicResult, 'title' | 'link'>> & SerpapiOrganicResult => Boolean(item.title && item.link))
      .map((item) => ({
        title: item.title!,
        url: item.link!,
        snippet: item.snippet,
      }))
      .slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWithTavily(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: limit,
        search_depth: 'advanced',
        include_answer: false,
        include_raw_content: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return [];

    const data = await response.json() as { results?: TavilyResult[] };
    return (data.results || [])
      .filter((item): item is Required<Pick<TavilyResult, 'title' | 'url'>> & TavilyResult => Boolean(item.title && item.url))
      .map((item) => ({
        title: item.title!,
        url: item.url!,
        snippet: item.content,
      }))
      .slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWeather(
  query: string,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const cityMatch = query.match(/\b(?:in|for|at)\s+([a-zA-Z .'-]+?)(?:\s+(?:tomorrow|today|tonight|this weekend|next week)|$)/i);
  const location = (cityMatch?.[1] || query)
    .replace(/\b(weather|forecast|temperature|rain|snow|wind|humidity|tomorrow|today|tonight|hourly)\b/gi, '')
    .trim()
    .replace(/\s{2,}/g, ' ');

  const wttrUrl = `https://wttr.in/${encodeURIComponent(location || query)}?format=j1`;
  const response = await fetchTextWithFallback(wttrUrl, {
    headers: {
      'user-agent': 'blush/0.1.0 (+https://github.com/baahaus/blush)',
      accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
    },
    timeoutMs,
  });

  if (!response.ok) return [];

  const data = JSON.parse(response.text) as {
    nearest_area?: Array<{ areaName?: Array<{ value?: string }>; region?: Array<{ value?: string }>; country?: Array<{ value?: string }> }>;
    weather?: Array<{ date?: string; maxtempF?: string; mintempF?: string; avgtempF?: string; hourly?: Array<{ time?: string; tempF?: string; chanceofrain?: string; weatherDesc?: Array<{ value?: string }> }> }>;
  };

  const nextDay = data.weather?.[1];
  const area = data.nearest_area?.[0];
  if (!nextDay) return [];

  const place = [
    area?.areaName?.[0]?.value,
    area?.region?.[0]?.value,
    area?.country?.[0]?.value,
  ].filter(Boolean).join(', ');

  const hourly = (nextDay.hourly || []).slice(0, 4).map((hour) => {
    const label = `${String(Number(hour.time || '0') / 100 || 0).padStart(2, '0')}:00`;
    const desc = hour.weatherDesc?.[0]?.value || 'Unknown';
    const temp = hour.tempF ? `${hour.tempF}F` : '';
    const rain = hour.chanceofrain ? `${hour.chanceofrain}% rain` : '';
    return [label, desc, temp, rain].filter(Boolean).join(', ');
  }).join(' | ');

  return [{
    title: `${place || location || query} weather for ${nextDay.date}`,
    url: wttrUrl,
    snippet: `High ${nextDay.maxtempF}F, low ${nextDay.mintempF}F, average ${nextDay.avgtempF}F. ${hourly}`,
  }];
}

async function searchWithDuckDuckGoHtml(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);

  const response = await fetchTextWithFallback(url.toString(), {
    headers: {
      'user-agent': 'blush/0.1.0 (+https://github.com/baahaus/blush)',
      accept: 'text/html,application/xhtml+xml',
    },
    timeoutMs,
    retryWithCurlOnHttpError: true,
  });

  if (!response.ok) return [];
  return extractDuckDuckGoResults(response.text, limit);
}

async function searchWithDuckDuckGoLite(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const url = new URL('https://lite.duckduckgo.com/lite/');
  url.searchParams.set('q', query);

  const response = await fetchTextWithFallback(url.toString(), {
    headers: {
      'user-agent': 'blush/0.1.0 (+https://github.com/baahaus/blush)',
      accept: 'text/html,application/xhtml+xml',
    },
    timeoutMs,
    retryWithCurlOnHttpError: true,
  });

  if (!response.ok) return [];
  return extractDuckDuckGoLiteResults(response.text, limit);
}

async function searchWithBingRss(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('format', 'rss');
  url.searchParams.set('q', query);

  const response = await fetchTextWithFallback(url.toString(), {
    headers: {
      'user-agent': 'blush/0.1.0 (+https://github.com/baahaus/blush)',
      accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
    },
    timeoutMs,
    retryWithCurlOnHttpError: true,
  });

  if (!response.ok) return [];

  const items = [...response.text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit);
  return items
    .map((match) => {
      const item = match[1];
      const title = (item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const link = (item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '').trim();
      const description = (item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/&amp;/g, '&')
        .trim();
      return { title, url: link, snippet: description };
    })
    .filter((item) => item.title && item.url);
}

function buildQueryVariants(query: string, allowedDomains?: string[]): string[] {
  const variants = new Set<string>();
  const trimmed = query.trim();
  if (!trimmed) return [];

  const cleanedDomains = (allowedDomains || []).map((domain) => domain.trim()).filter(Boolean);
  const withoutSiteLiterals = trimmed.replace(/\bsite:[^\s]+/gi, '').replace(/\s{2,}/g, ' ').trim();
  const yearless = withoutSiteLiterals.replace(/\b20\d{2}\b/g, ' ').replace(/\s{2,}/g, ' ').trim();

  if (cleanedDomains.length > 0) {
    for (const domain of cleanedDomains) {
      variants.add(`site:${domain} ${withoutSiteLiterals || trimmed}`);
      variants.add(`${withoutSiteLiterals || trimmed} site:${domain}`);
    }
  }

  variants.add(trimmed);

  if (withoutSiteLiterals && withoutSiteLiterals !== trimmed) {
    variants.add(withoutSiteLiterals);
  }

  if (yearless && yearless !== trimmed && yearless !== withoutSiteLiterals) {
    variants.add(yearless);
    for (const domain of cleanedDomains) {
      variants.add(`site:${domain} ${yearless}`);
    }
  }

  return [...variants];
}

function filterSearchResults(
  results: SearchResultItem[],
  allowedDomains?: string[],
  blockedDomains?: string[],
): SearchResultItem[] {
  return dedupeSearchResults(results)
    .filter((item) => domainMatches(item.url, allowedDomains, blockedDomains))
    .map((item) => ({
      ...item,
      snippet: normalizeSearchSnippet(item.snippet),
    }));
}

async function collectSearchResults(
  query: string,
  limit: number,
  timeoutMs: number,
  allowedDomains?: string[],
  blockedDomains?: string[],
): Promise<SearchCollection> {
  const variants = buildQueryVariants(query, allowedDomains);
  const providers: SearchProvider[] = [
    { name: 'Brave Search API', search: searchWithBrave },
    { name: 'SerpAPI', search: searchWithSerpapi },
    { name: 'Tavily', search: searchWithTavily },
    { name: 'DuckDuckGo HTML', search: searchWithDuckDuckGoHtml },
    { name: 'DuckDuckGo Lite', search: searchWithDuckDuckGoLite },
    { name: 'Bing RSS', search: searchWithBingRss },
  ];

  const providerLimit = Math.min(Math.max(limit * 3, 8), 20);

  for (const provider of providers) {
    for (const variant of variants) {
      const raw = await provider.search(variant, providerLimit, timeoutMs);
      const filtered = filterSearchResults(raw, allowedDomains, blockedDomains);
      if (filtered.length === 0) continue;

      return {
        results: filtered.slice(0, limit),
        providers: [provider.name],
        queries: [variant],
      };
    }
  }

  return {
    results: [],
    providers: [],
    queries: [],
  };
}

function formatSearchOutput(
  query: string,
  providers: string[],
  queries: string[],
  results: SearchResultItem[],
): string {
  const lines = [
    `${providers.length === 1 ? 'Search provider' : 'Search providers'}: ${providers.join(', ')}`,
    `Query: ${query}`,
  ];

  const effectiveQueries = queries.filter((item) => item !== query);
  if (effectiveQueries.length === 1) {
    lines.push(`Effective query: ${effectiveQueries[0]}`);
  } else if (effectiveQueries.length > 1) {
    lines.push(`Effective queries: ${effectiveQueries.join(' | ')}`);
  }

  lines.push('');

  for (const [index, item] of results.entries()) {
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(`   URL: ${item.url}`);
    if (item.snippet) {
      lines.push(`   Snippet: ${truncateText(item.snippet, 240)}`);
    }
  }

  return lines.join('\n');
}

export async function webSearch(params: WebSearchParams): Promise<string> {
  const {
    query,
    limit = 5,
    allowed_domains,
    blocked_domains,
    timeout_ms = 15000,
  } = params;

  if (!query.trim()) {
    return 'Error searching the web: query cannot be empty.';
  }

  try {
    if (looksLikeWeatherQuery(query) || looksLikeLocationOnlyQuery(query)) {
      const weatherResults = await searchWeather(query, timeout_ms);
      if (weatherResults.length > 0) {
        return formatSearchOutput(query, ['wttr.in weather lookup'], [query], weatherResults.slice(0, limit));
      }
    }

    const collection = await collectSearchResults(
      query,
      limit,
      timeout_ms,
      allowed_domains,
      blocked_domains,
    );

    if (collection.results.length === 0) {
      return `No search results found for "${query}". Tried providers: Brave Search API, SerpAPI, Tavily, DuckDuckGo HTML, DuckDuckGo Lite, Bing RSS.`;
    }

    return formatSearchOutput(
      query,
      collection.providers,
      collection.queries,
      collection.results.slice(0, limit),
    );
  } catch (err) {
    return `Error searching the web for "${query}": ${(err as Error).message}`;
  }
}

export const webSearchTool = {
  name: 'web_search',
  description: 'Search the web for current information and return result links and snippets.',
  input_schema: WebSearchParams,
  execute: webSearch,
};
