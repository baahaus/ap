import { afterEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

import { webFetch } from './web-fetch.js';
import { webSearch } from './web-search.js';

const originalBraveKey = process.env.BRAVE_SEARCH_API_KEY;

const originalSerpapiKey = process.env.SERPAPI_API_KEY;
const originalTavilyKey = process.env.TAVILY_API_KEY;

afterEach(() => {
  if (originalBraveKey === undefined) {
    delete process.env.BRAVE_SEARCH_API_KEY;
  } else {
    process.env.BRAVE_SEARCH_API_KEY = originalBraveKey;
  }

  if (originalSerpapiKey === undefined) {
    delete process.env.SERPAPI_API_KEY;
  } else {
    process.env.SERPAPI_API_KEY = originalSerpapiKey;
  }

  if (originalTavilyKey === undefined) {
    delete process.env.TAVILY_API_KEY;
  } else {
    process.env.TAVILY_API_KEY = originalTavilyKey;
  }

  vi.unstubAllGlobals();
  execFileMock.mockReset();
});

describe('web_fetch behavior', () => {
  it('falls back to curl and returns readable page text', async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network unavailable');
    }));

    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(null, {
        stdout: [
          'HTTP/1.1 200 OK',
          'content-type: text/html; charset=utf-8',
          '',
          '<html><head><title>Example Page</title></head><body><main><h1>Headline</h1><p>Readable text here.</p></main></body></html>',
        ].join('\r\n'),
      });
    });

    const result = await webFetch({ url: 'https://example.com/page', max_chars: 500 });

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(result).toContain('Fetched: https://example.com/page');
    expect(result).toContain('Status: 200');
    expect(result).toContain('Content-Type: text/html; charset=utf-8');
    expect(result).toContain('Transport: curl');
    expect(result).toContain('Title: Example Page');
    expect(result).toContain('Headline');
    expect(result).toContain('Readable text here.');
    expect(result).not.toContain('<html');
  });
});

describe('web_search behavior', () => {
  it('tries query variants and domain scoping before later providers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = input.toString();

      if (url.includes('html.duckduckgo.com')) {
        const parsed = new URL(url);
        const q = parsed.searchParams.get('q');

        if (q === 'current PGA Tour tournament this week 2025 schedule current event') {
          return new Response('<html><body>No good results</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        }

        if (q === 'site:pgatour.com current PGA Tour tournament this week 2025 schedule current event') {
          return new Response(
            '<a class="result__a" href="https://www.pgatour.com/">PGATOUR.COM - Official Home of Golf and the FedExCup - PGA TOUR</a>',
            { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
          );
        }
      }

      if (url.includes('bing.com/search')) {
        return new Response('<rss><channel></channel></rss>', {
          status: 200,
          headers: { 'content-type': 'application/rss+xml' },
        });
      }

      throw new Error(`unexpected url: ${url}`);
    }));

    const result = await webSearch({
      query: 'current PGA Tour tournament this week 2025 schedule current event',
      allowed_domains: ['pgatour.com'],
      limit: 3,
    });

    expect(result).toContain('Search provider: DuckDuckGo HTML');
    expect(result).toContain('Query: current PGA Tour tournament this week 2025 schedule current event');
    expect(result).toContain('Effective query: site:pgatour.com current PGA Tour tournament this week 2025 schedule current event');
    expect(result).toContain('1. PGATOUR.COM - Official Home of Golf and the FedExCup - PGA TOUR');
    expect(result).toContain('URL: https://www.pgatour.com/');
  });

  it('uses SerpAPI when configured', async () => {
    process.env.SERPAPI_API_KEY = 'test-serpapi-key';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = input.toString();

      if (url.includes('serpapi.com/search.json')) {
        return new Response(JSON.stringify({
          organic_results: [
            {
              title: 'Valero Texas Open Tee Times',
              link: 'https://www.pgatour.com/tournaments/2026/valero-texas-open/tee-times',
              snippet: 'Official round tee times for the Valero Texas Open.',
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`unexpected url: ${url}`);
    }));

    const result = await webSearch({
      query: 'Valero Texas Open round 2 tee times 2026',
      allowed_domains: ['pgatour.com'],
      limit: 3,
    });

    expect(result).toContain('Search provider: SerpAPI');
    expect(result).toContain('Valero Texas Open Tee Times');
    expect(result).toContain('https://www.pgatour.com/tournaments/2026/valero-texas-open/tee-times');
  });

  it('falls back to DuckDuckGo Lite when the HTML endpoint is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = input.toString();

      if (url.includes('html.duckduckgo.com')) {
        return new Response('<html><body>No good results</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }

      if (url.includes('lite.duckduckgo.com')) {
        return new Response(
          '<a rel="nofollow" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle">Example Lite Result</a>',
          {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        );
      }

      if (url.includes('bing.com/search')) {
        return new Response('<rss><channel></channel></rss>', {
          status: 200,
          headers: { 'content-type': 'application/rss+xml' },
        });
      }

      throw new Error(`unexpected url: ${url}`);
    }));

    const result = await webSearch({
      query: 'example lite fallback',
      limit: 3,
    });

    expect(result).toContain('Search provider: DuckDuckGo Lite');
    expect(result).toContain('Example Lite Result');
    expect(result).toContain('https://example.com/article');
  });
});
