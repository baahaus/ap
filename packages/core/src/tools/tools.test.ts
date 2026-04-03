import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { glob } from './glob.js';
import { grep } from './grep.js';
import { todo } from './todo.js';
import { extractDuckDuckGoLiteResults, extractDuckDuckGoResults, htmlToText, looksLikeLocationOnlyQuery, looksLikeWeatherQuery, normalizeUrlForDedup } from './web-utils.js';
import { webFetch } from './web-fetch.js';
import { webSearch } from './web-search.js';

const createdDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'blush-core-tools-'));
  createdDirs.push(dir);
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(join(dir, 'src', 'index.ts'), 'export const alpha = 1;\nexport const beta = 2;\n');
  await writeFile(join(dir, 'src', 'feature.ts'), 'const AlphaFeature = true;\n');
  await writeFile(join(dir, 'docs', 'notes.md'), 'alpha note\n');
  return dir;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.unstubAllGlobals();
});

describe('glob', () => {
  it('finds files by glob pattern', async () => {
    const dir = await createWorkspace();
    const result = await glob({ pattern: '**/*.ts', path: dir });
    expect(result).toContain('src/index.ts');
    expect(result).toContain('src/feature.ts');
  });

  it('narrows the search root from literal path prefixes in the pattern', async () => {
    const dir = await createWorkspace();
    const result = await glob({ pattern: 'src/**/*.ts', path: dir });
    expect(result).toContain(join(dir, 'src', 'index.ts'));
    expect(result).toContain(join(dir, 'src', 'feature.ts'));
    expect(result).not.toContain(join(dir, 'docs', 'notes.md'));
  });
});

describe('grep', () => {
  it('finds matching lines with line numbers', async () => {
    const dir = await createWorkspace();
    const result = await grep({ pattern: 'alpha', path: dir, case_insensitive: true });
    expect(result).toContain('src/index.ts:1');
    expect(result).toContain('docs/notes.md:1');
  });

  it('returns a readable error for invalid regex', async () => {
    const dir = await createWorkspace();
    const result = await grep({ pattern: '(', path: dir });
    expect(result).toContain('Error: Invalid regex pattern');
  });
});

describe('todo', () => {
  it('stores and reads todos for the current workspace', async () => {
    const dir = await createWorkspace();
    const previous = process.cwd();
    process.chdir(dir);

    try {
      const written = await todo({
        operation: 'write',
        todos: [
          { content: 'Inspect auth flow', status: 'in_progress', activeForm: 'Inspecting auth flow' },
          { content: 'Add tests', status: 'pending' },
        ],
      });
      const read = await todo({ operation: 'read' });
      expect(written).toContain('[in_progress] Inspect auth flow');
      expect(read).toContain('[pending] Add tests');
    } finally {
      process.chdir(previous);
    }
  });

  it('rejects multiple in-progress todos', async () => {
    const result = await todo({
      operation: 'write',
      todos: [
        { content: 'One', status: 'in_progress' },
        { content: 'Two', status: 'in_progress' },
      ],
    });
    expect(result).toContain('Only one todo may be in_progress');
  });
});

describe('web helpers', () => {
  it('extracts readable text from html', () => {
    const text = htmlToText('<html><head><title>Test</title><style>.x{}</style></head><body><h1>Hello</h1><p>World &amp; more</p></body></html>');
    expect(text).toContain('Hello');
    expect(text).toContain('World & more');
  });

  it('extracts search results from duckduckgo html', () => {
    const results = extractDuckDuckGoResults(`
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fweather">Weather Example</a>
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fforecast">Forecast Example</a>
    `, 5);
    expect(results[0]?.url).toBe('https://example.com/weather');
    expect(results[1]?.title).toBe('Forecast Example');
  });

  it('extracts search results from duckduckgo lite html', () => {
    const results = extractDuckDuckGoLiteResults(`
      <a rel="nofollow" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a>
      <a rel="nofollow" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fguide">Example Guide</a>
    `, 5);
    expect(results[0]?.url).toBe('https://example.com/docs');
    expect(results[1]?.title).toBe('Example Guide');
  });

  it('normalizes urls for dedupe by removing hashes and tracking params', () => {
    expect(normalizeUrlForDedup('https://example.com/path/?utm_source=x#section')).toBe('https://example.com/path');
  });

  it('detects weather-style queries', () => {
    expect(looksLikeWeatherQuery('whats the weather like tomorrow in pittsburgh')).toBe(true);
    expect(looksLikeWeatherQuery('find the open pull requests')).toBe(false);
  });

  it('detects location-only follow-ups', () => {
    expect(looksLikeLocationOnlyQuery('Pittsburgh PA')).toBe(true);
    expect(looksLikeLocationOnlyQuery('Pittsburgh, PA')).toBe(true);
    expect(looksLikeLocationOnlyQuery('15213')).toBe(true);
    expect(looksLikeLocationOnlyQuery('openai api pricing')).toBe(false);
  });
});

describe('web_fetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<html><head><title>Example Page</title></head><body><main><h1>Headline</h1><p>Readable text here.</p></main></body></html>',
      {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      },
    )));
  });

  it('fetches and extracts readable page text', async () => {
    const result = await webFetch({ url: 'https://example.com' });
    expect(result).toContain('Fetched: https://example.com/');
    expect(result).toContain('Title: Example Page');
    expect(result).toContain('Readable text here.');
  });

  it('formats json responses readably', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ name: 'blush', tools: ['web_fetch', 'web_search'] }),
      {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    )));

    const result = await webFetch({ url: 'https://example.com/data.json' });
    expect(result).toContain('Content-Type: application/json; charset=utf-8');
    expect(result).toContain('"name": "blush"');
    expect(result).toContain('"tools": [');
  });

  it('omits binary content cleanly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('PNGDATA', {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })));

    const result = await webFetch({ url: 'https://example.com/image.png' });
    expect(result).toContain('Content-Type: image/png');
    expect(result).toContain('Binary or unsupported content omitted');
  });
});

describe('web_search', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes('wttr.in')) {
        return new Response(
          JSON.stringify({
            nearest_area: [{ areaName: [{ value: 'Pittsburgh' }], region: [{ value: 'Pennsylvania' }], country: [{ value: 'United States of America' }] }],
            weather: [
              { date: '2026-04-01', hourly: [] },
              {
                date: '2026-04-02',
                maxtempF: '80',
                mintempF: '52',
                avgtempF: '65',
                hourly: [
                  { time: '0', tempF: '56', chanceofrain: '100', weatherDesc: [{ value: 'Patchy light drizzle' }] },
                  { time: '300', tempF: '56', chanceofrain: '78', weatherDesc: [{ value: 'Mist' }] },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('html.duckduckgo.com')) {
        return new Response(
          `
            <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fweather.gov%2Fpgh">Pittsburgh Forecast</a>
            <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fother">Other Result</a>
          `,
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      return new Response('unexpected', { status: 500 });
    }));
  });

  it('returns filtered search results', async () => {
    const result = await webSearch({
      query: 'pittsburgh weather tomorrow',
    });
    expect(result).toContain('wttr.in weather lookup');
    expect(result).toContain('Pittsburgh, Pennsylvania, United States of America weather for 2026-04-02');
    expect(result).toContain('High 80F, low 52F');
  });

  it('treats location-only follow-ups as weather lookups', async () => {
    const result = await webSearch({
      query: 'Pittsburgh PA',
    });
    expect(result).toContain('wttr.in weather lookup');
    expect(result).toContain('Pittsburgh, Pennsylvania, United States of America weather for 2026-04-02');
  });
});
