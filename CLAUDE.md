# AP -- Team CLI Agent

Read PLAN.md first. It is the source of truth for architecture, decisions, and implementation status.

## Project Structure

TypeScript monorepo with 5 packages:
- `@ap/ai` -- Multi-provider LLM abstraction (zero internal deps)
- `@ap/core` -- Agent loop, 4 core tools, state management
- `@ap/tui` -- Terminal UI primitives
- `@ap/cli` -- Main `ap` binary, commands, sessions
- `@ap/team` -- Multi-agent coordination (the differentiator)

## Build & Dev

```bash
pnpm install          # Install deps
pnpm build            # Build all packages
pnpm dev              # Watch mode
pnpm test             # Run tests
```

## Code Style

- ESM only, no CommonJS
- TypeBox for all schemas (runtime validation + static types)
- No classes unless genuinely needed -- prefer functions and plain objects
- No premature abstractions. Three similar lines > one clever helper
- Tests with Vitest
- tsup for bundling

## Key Design Principles

1. Minimal system prompt (under 1000 tokens)
2. 4 core tools only (read, write, edit, bash). Everything else is extensions
3. Team coordination is core, not bolted on
4. Multi-provider from day 1
5. JSONL sessions with branching
6. Extensions for everything non-core
