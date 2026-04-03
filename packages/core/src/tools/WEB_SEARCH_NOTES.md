# Web Search Notes

## Problem
The original `web_search` path was too brittle for current-info tasks:
- Brave only worked when `BRAVE_SEARCH_API_KEY` existed.
- Bing RSS often returned empty or low-quality results for date-sensitive sports/news queries.
- DuckDuckGo HTML was only attempted after Bing and did not retry with better query variants.
- Domain-restricted searches could easily return nothing even when relevant pages existed.

## What changed
`packages/core/src/tools/web-search.ts` now:
1. Tries multiple providers in a stronger order:
   - Brave Search API
   - SerpAPI (`SERPAPI_API_KEY`)
   - Tavily (`TAVILY_API_KEY`)
   - DuckDuckGo HTML
   - Bing RSS
2. Generates query variants automatically:
   - original query
   - `site:domain query` for allowed domains
   - `query site:domain`
   - year-stripped variants for brittle date searches
3. Deduplicates results before filtering.
4. Reports the `Effective query` when a fallback variant produced the results.

## Recommended env vars
Use any of these to improve reliability:
- `BRAVE_SEARCH_API_KEY`
- `SERPAPI_API_KEY`
- `TAVILY_API_KEY`

SerpAPI is the cleanest upgrade for current-event sports/news lookups.

## Integration guidance
No CLI/API changes required. Existing `web_search` calls keep working.
The tool simply gets better fallback behavior and provider coverage.
