# AP -- Team CLI Agent

> ap.haus -- AI Research & Applied Intelligence

## Philosophy

Three pillars, stolen from the best and combined into something new:

1. **Pi's minimalism** -- 4 core tools, sub-1000-token system prompt, primitives over features
2. **Claude Code's best ideas** -- /btw, agent teams, /compact, /branch, conversation forking
3. **Team-native from day 1** -- multi-agent coordination is core architecture, not an extension

AP is a terminal coding agent where agents are peers. Not parent-child. Not orchestrator-worker. Peers that coordinate through mailboxes, share context through worktrees, and reach consensus through structured synthesis.

The name is the brand. `ap` is the CLI. `ap.haus` is the research org. The tool embodies the research.

---

## Architecture

TypeScript monorepo. 5 packages that layer cleanly:

```
ap/
├── packages/
│   ├── ai/           # @ap/ai    -- Multi-provider LLM abstraction
│   ├── core/         # @ap/core  -- Agent loop, tools, state
│   ├── tui/          # @ap/tui   -- Terminal UI primitives
│   ├── cli/          # @ap/cli   -- Main CLI binary + commands
│   └── team/         # @ap/team  -- Multi-agent coordination
├── extensions/       # Built-in extensions
├── skills/           # Built-in skills (/btw, /compact, etc.)
├── PLAN.md           # This file
├── CLAUDE.md         # Agent instructions for working on this repo
├── tsconfig.json     # Root TypeScript config
├── package.json      # Workspace root
└── turbo.json        # Build orchestration
```

### Dependency Graph

```
@ap/ai          (zero internal deps -- usable standalone)
    ↓
@ap/core        (depends on @ap/ai)
    ↓
@ap/tui         (zero internal deps -- pure terminal rendering)
    ↓
@ap/cli         (depends on @ap/core + @ap/tui)
    ↓
@ap/team        (depends on @ap/core -- can run headless or through CLI)
```

---

## Package Details

### @ap/ai -- LLM Layer

Unified interface across providers. Streaming-first. Tool calling via TypeBox schemas.

**Providers (phase 1):**
- Anthropic (Claude) -- primary
- OpenAI (GPT/o-series)
- Google (Gemini)
- Any OpenAI-compatible endpoint (Ollama, vLLM, etc.)

**Key features:**
- `stream()` -- streaming responses with tool calls
- `complete()` -- single-shot completion
- Token counting + cost tracking per call and per session
- Mid-session model switching with automatic context handoff
- Thinking/reasoning trace normalization across providers
- Provider-specific auth (API keys, OAuth, subscription)

**Design decisions:**
- No retry logic in the LLM layer. Callers handle retries.
- Token counting is provider-reported, not estimated.
- Tool schemas use TypeBox for runtime validation + static typing.
- Context handoff converts provider-specific formats (Anthropic thinking blocks become `<thinking>` tags for others).

### @ap/core -- Agent Loop

The brain. Runs the tool-calling loop, manages state, handles message flow.

**4 Core Tools:**
| Tool | Purpose |
|------|---------|
| `read` | Read files (text + images), 2000-line default, offset/limit support |
| `write` | Create or overwrite files |
| `edit` | Exact string replacement with uniqueness validation |
| `bash` | Shell execution, timeout support, background mode |

**Optional tools (auto-downloaded):**
- `grep` -- ripgrep-backed content search
- `glob` -- fd-backed file finding
- `ls` -- directory listing

**Agent loop:**
```
User message → System prompt assembly → LLM call → Tool execution → Loop until done
```

**State management:**
- JSONL session files with tree structure (id + parentId per entry)
- Branching within a single file -- navigate to any point and fork
- Compaction preserves full history, summarizes for context
- Sessions stored at `~/.ap/sessions/<encoded-cwd>/`

**Context assembly (priority order):**
1. System prompt (base, cached)
2. `AGENTS.md` / `CLAUDE.md` (global ~/.ap/ + per-directory, hierarchical)
3. `SYSTEM.md` override (full replacement)
4. `APPEND_SYSTEM.md` (append-only)
5. System reminders (injected mid-conversation, preserves cache)
6. Skills (loaded on-demand)

**Message queue:**
- Enter = steering message (interrupts after current tool call)
- Alt+Enter = follow-up (queued until full completion)
- Escape = abort with recovery
- Double-Escape = rewind to checkpoint

### @ap/tui -- Terminal UI

Retained-mode terminal rendering. Not React-based. Direct ANSI escape codes with differential updates.

**Components:**
- Streaming markdown renderer with syntax highlighting
- Input line with file/path completion
- Overlay system (for /btw responses)
- Status bar (model, tokens, cost, context %)
- Progress indicators
- Diff viewer (for /diff)
- Context grid (for /context)

**Rendering:**
- Synchronized output (no tearing)
- Differential updates (only redraw what changed)
- 256-color + truecolor support
- Responsive to terminal resize

### @ap/cli -- Main Binary

The `ap` command. Sessions, commands, modes.

**Commands (cherry-picked from Claude Code + pi):**

| Command | Source | Purpose |
|---------|--------|---------|
| `/btw <question>` | CC | Ephemeral question -- full context, no tools, no history. Rendered in dismissible overlay. |
| `/compact [focus]` | CC | Compress conversation with optional focus instructions |
| `/branch` | CC | Fork conversation at current point |
| `/context` | CC | Visualize context usage as colored grid |
| `/diff` | CC | Show uncommitted changes + per-turn diffs |
| `/team` | NEW | Team management: spawn, message, status, synthesize |
| `/model [name]` | Pi | Switch model mid-session |
| `/effort [level]` | CC | Set model effort (low/medium/high/max) |
| `/color [color]` | CC | Set prompt color per session |
| `/copy [N]` | CC | Copy Nth response, interactive block picker |

**Operating modes:**
1. **Interactive** -- full TUI with streaming
2. **Print** -- scripting output for pipelines (`ap -p "question"`)
3. **JSON** -- structured output (`ap --json "question"`)
4. **RPC** -- JSONL over stdin/stdout for embedding
5. **SDK** -- programmatic via `createSession()`

**Session management:**
- Resume last session by default
- `ap --new` for fresh session
- `ap --session <name>` for named sessions
- Session list with `ap sessions`

### @ap/team -- Multi-Agent Coordination

The differentiator. Agents are peers, not subagents.

**Architecture:**
```
┌─────────┐     ┌─────────┐     ┌─────────┐
│ Agent A  │────▶│ Mailbox │◀────│ Agent B  │
│ (worktree│     │ System  │     │ (worktree│
│  alpha)  │     │         │     │  beta)   │
└─────────┘     └─────────┘     └─────────┘
      │              │                │
      ▼              ▼                ▼
┌──────────────────────────────────────────┐
│            Task Queue (shared)            │
└──────────────────────────────────────────┘
```

**Isolation:**
- Each agent gets its own git worktree
- No shared filesystem state (agents can't step on each other)
- Communication only through mailboxes
- Worktree cleanup when agent completes (auto-merge if clean)

**Mailbox system:**
- File-based message passing (`~/.ap/team/<session>/mailbox/<agent-id>/`)
- Structured messages: `{ from, to, type, payload, timestamp }`
- Types: `request`, `response`, `broadcast`, `status`, `artifact`
- Agents poll their mailbox between tool calls

**Task queue:**
- Shared task board per team session
- States: `pending` -> `claimed` -> `in_progress` -> `done` / `blocked`
- Any agent can create, claim, or complete tasks
- Dependencies tracked (task A blocks task B)

**Consensus patterns:**
- **Synthesis** -- one agent collects outputs from others, produces unified result
- **Vote** -- agents independently assess, majority wins
- **Review** -- one agent's output is reviewed by another before merging
- **Pipeline** -- sequential handoff (agent A -> agent B -> agent C)

**Team commands:**
```
/team spawn <name> [--prompt "..."]   # Create new peer agent
/team msg <name> <message>            # Send message to agent
/team status                          # Show all agents + tasks
/team synthesize                      # Collect all outputs, produce unified result
/team merge <name>                    # Merge agent's worktree back
```

---

## Features Stolen from Claude Code

These are the non-obvious, high-leverage features worth taking:

### /btw -- Ephemeral Questions
The inverse of a subagent. Full conversation context, zero tools, zero history pollution. Answers appear in a dismissible overlay. Reuses prompt cache so cost is near-zero. Works while the main agent is processing.

**Implementation:** Separate LLM call with same message history but `tools: []`. Response rendered in TUI overlay, not appended to session JSONL.

### Agent Teams with Worktree Isolation
Git worktrees give each agent a full copy of the repo. No merge conflicts during work. Clean merge at the end. This is the right primitive for parallel agents.

### Prompt Cache Preservation
System prompt is static and cached. Dynamic context arrives as system reminders injected into user messages, preserving the cache hit. This is ~90% cost savings on the system prompt for every turn.

### Haiku Sidecar
Use a cheap, fast model for:
- Bash command safety classification
- Conversation summarization (for compact + session resume)
- Loading message generation
- Context usage analysis

### Double-Escape Rewind
Checkpoint after each tool call. Double-escape lets you rewind to any checkpoint. Both conversation state and filesystem state (via git) are restored.

---

## Extension System

TypeScript modules with full system access. Loaded from:
- `~/.ap/extensions/` (global)
- `.ap/extensions/` (per-project)
- npm packages (`ap install <package>`)

**Extension API:**
```typescript
export default function activate(ap: ApContext) {
  // Register tools
  ap.tools.register({
    name: 'my-tool',
    description: '...',
    schema: Type.Object({ ... }),
    execute: async (params) => { ... }
  });

  // Register commands
  ap.commands.register('/my-cmd', async (args) => { ... });

  // Register event handlers
  ap.events.on('message:before', async (msg) => { ... });
  ap.events.on('tool:after', async (result) => { ... });

  // Inject dynamic context
  ap.context.append('Always consider accessibility...');
}
```

**Skills (progressive disclosure):**
Loaded on-demand when invoked. Zero context cost until activated. Stored as markdown with frontmatter:

```markdown
---
name: security-review
trigger: /security-review
tools: [read, grep, bash]
---

Analyze pending changes for security vulnerabilities...
```

---

## Implementation Phases

### Phase 1 -- Foundation
- [x] PLAN.md
- [x] Monorepo scaffold (turborepo, tsconfig, package.json)
- [x] @ap/ai -- Anthropic + OpenAI providers with streaming + tool calling
- [x] @ap/core -- Agent loop with 4 core tools
- [x] @ap/tui -- Basic streaming output + input
- [x] @ap/cli -- `ap` binary that runs interactive sessions
- [x] First working REPL: `ap` launches, accepts input, calls Claude, executes tools

### Phase 2 -- Commands & Sessions
- [x] JSONL session storage with branching
- [x] /btw implementation with interactive keypress-dismiss overlay
- [x] /compact with focus instructions
- [x] /branch conversation forking
- [x] /context visualization (colored proportional bar)
- [x] /model mid-session switching
- [x] Session resume (--resume, --session, auto-save)
- [x] Config file auth (~/.ap/config.json, .env, env vars)
- [x] CLI bundles workspace deps for standalone execution

### Phase 3 -- Team
- [x] @ap/team package
- [x] Git worktree isolation (createWorktree, mergeWorktree)
- [x] Mailbox system (file-based, broadcast, structured types)
- [x] Task queue (create, claim, complete, dependencies, auto-unblock)
- [x] /team commands (spawn, msg, status, synthesize, merge)
- [x] Consensus patterns (synthesis via LLM)
- [ ] Review pattern (agent reviews another's output before merge)
- [ ] Pipeline pattern (sequential handoff)

### Phase 4 -- Ecosystem
- [x] Extension loading + API (register tools, commands, events, context)
- [x] Skills system (markdown+frontmatter, progressive disclosure, /skills command)
- [ ] Package registry (ap install <package>)
- [x] OpenAI + generic providers
- [x] OpenAI-compatible endpoint support (Ollama, vLLM, custom URLs)
- [x] Wren compression integration (CLI + HTTP modes, auto-detect, tool output compression)
- [x] /diff command (colorized git diff)
- [x] Built-in skills: /security-review, /commit, /simplify
- [x] Package registry (ap install, ap list, ap remove -- npm, git, GitHub)

### Phase 5 -- Polish
- [x] Haiku sidecar (bash safety classification, conversation summarization, session titles)
- [x] Checkpoint/rewind system (conversation + git state)
- [x] Prompt suggestions after responses (via sidecar)
- [x] 7 color themes (default, mono, ocean, forest, sunset, rose, hacker)
- [x] RPC mode (JSONL over stdin/stdout for embedding)
- [x] SDK mode (createApSession() export for programmatic use)
- [x] JSON output mode (--json flag for print mode)
- [x] `ap init` -- interactive first-time setup
- [x] `!` prefix bash passthrough (output added to context)
- [x] `/copy [N]` -- clipboard copy with code block detection
- [x] Session resume via config.session (proper load path, not mutation)

---

## Technical Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Language | TypeScript | Same as pi, good ecosystem, browser-compatible @ap/ai |
| Build | Turborepo | Fast monorepo builds with caching |
| Runtime | Node.js 20+ | Native fetch, stable ESM |
| Schema | TypeBox | Runtime validation + static types from one source |
| Session format | JSONL | Append-only, streamable, supports branching via parentId |
| Package manager | pnpm | Workspace support, fast, strict |
| Test framework | Vitest | Fast, ESM-native, good DX |
| Bundling | tsup | Simple, fast, ESM + CJS output |

---

## What AP Is NOT

- Not a hosted service or SaaS
- Not a VS Code extension (terminal-first)
- Not a wrapper around Claude Code (independent agent)
- Not opinionated about workflow (extensible primitives)
- Not locked to Anthropic (multi-provider from day 1)

---

## Prior Art & Attribution

- **pi.dev** (Mario Zechner) -- architecture inspiration, minimalism philosophy
- **Claude Code** (Anthropic) -- /btw, teams, compact, branch, context patterns
- **oh-my-pi** (can1357) -- hashline edits, LSP integration ideas
- **OpenClaw** -- multi-platform agent deployment pattern

---

## Progress Log

### 2026-04-01 -- Initial Build (Phases 1-3)

**Commits:**

1. `e434bb1` -- Initial commit: 5-package monorepo scaffold, all source code
   - @ap/ai: Anthropic + OpenAI providers, streaming, tool calling, token tracking, registry
   - @ap/core: Agent loop, 4 core tools (read/write/edit/bash), JSONL sessions, context assembly
   - @ap/tui: Streaming markdown, syntax highlighting, status bar, input handling
   - @ap/cli: `ap` binary with /btw, /compact, /context, /branch, /model, print mode
   - @ap/team: Worktree isolation, mailbox system, task queue, coordinator, synthesis

2. `3949604` -- Config file auth, session resume, interactive /btw overlay
   - Multi-source API key resolution (~/.ap/config.json, .env, env vars)
   - Session persistence: --resume, --session, auto-save, SIGINT save
   - Interactive /btw overlay with keypress dismiss
   - CLI bundles workspace deps for standalone node execution

3. `6f3aa71` -- Wire /team commands into CLI
   - /team spawn, msg, status, synthesize, merge wired to @ap/team
   - Team status shows agents, branches, tasks with color coding

4. `(current)` -- README.md, PLAN.md progress log
   - Public-facing README with install, usage, architecture
   - Updated all phase checklists
   - Added this progress log

5. `921b6ea` -- Extension system and skills with progressive disclosure
   - ExtensionManager: load .js/.mjs, register tools/commands/events/context
   - SkillRegistry: markdown+frontmatter, progressive disclosure, trigger matching
   - Extension tools merged into agent loop with pre/post events
   - Built-in skills: /security-review, /commit
   - /skills command to list installed skills

6. `371b7f7` -- OpenAI-compatible endpoints, /diff command
   - Support for Ollama, vLLM, custom URLs (http://host:port/v1:model)
   - Built-in `ollama` and `local` provider aliases
   - /diff with colorized staged/unstaged changes
   - Config file default_provider support

7. `f9474e5` -- /simplify skill

8. `(current)` -- Phase 5 polish: sidecar, themes, RPC, SDK, checkpoints
   - Haiku sidecar: bash safety classification, conversation summarization, session titles
   - 7 color themes: default, mono, ocean, forest, sunset, rose, hacker
   - /theme command + --theme flag
   - RPC mode: JSONL over stdin/stdout for embedding in editors/tools
   - SDK mode: createApSession() export for programmatic use
   - JSON output: --json flag for print mode
   - Checkpoint system: conversation + git state rewind after tool calls

**What works:**
- `ap --help`, `ap --version` -- binary runs standalone
- `ap -p "question"` -- print mode (needs API key)
- `ap -p "q" --json` -- JSON output mode
- `ap --rpc` -- RPC mode for embedding
- `ap` -- interactive REPL with 16 commands
- `ap -r` / `ap --session <id>` -- session resume
- `ap -t ocean` / `/theme ocean` -- 7 color themes
- `ap sessions` -- list sessions for cwd
- `./packages/cli/dist/bin.js` -- runs directly (shebang + chmod)
- `/diff`, `/context`, `/skills`, `/theme` -- work without API key
- All 5 packages build clean in ~3s (full turbo cache in 7ms)
- Extension system loads from ~/.ap/extensions/ and .ap/extensions/
- Skills loaded from ~/.ap/skills/ and .ap/skills/
- Provider auto-detection: claude*, gpt*, o1*, o3*
- Custom endpoint support: `ollama:model`, `local:model`, `http://url:port/v1:model`
- SDK: `import { createApSession } from '@ap/cli/sdk'`

**What needs API key to test end-to-end:**
- Full agent loop (send -> LLM -> tool calls -> loop)
- /btw ephemeral questions
- /compact conversation compression
- /team spawn + synthesize
- Skill activation (sends prompt to agent)
- Sidecar bash safety checks

9. `82a6297` -- Wren compression integration
   - Auto-detects ~/wren/bin/wren CLI or HTTP endpoint
   - Compresses tool output before adding to context window
   - Two modes: input (prompts) and output (tool results)
   - Silently skips when unavailable

10. `(current)` -- Complete feature set
    - `ap init`: interactive first-time setup (dirs, config, AGENTS.md)
    - `!command` bash passthrough (output added to conversation context)
    - `/copy [N]`: clipboard copy with code block detection (pbcopy/xclip)
    - Package registry: `ap install`, `ap list`, `ap remove` (npm, git, GitHub)
    - Prompt suggestions after responses via sidecar
    - Session resume uses proper config.session path (no mutation)
    - Updated help with all subcommands and key bindings
    - Comprehensive README with all features documented

**Remaining work:**
- End-to-end testing with real API key
- npm publish pipeline
- CI/CD (GitHub Actions)

---

*Last updated: 2026-04-01*
*Status: All 5 phases complete. Feature-complete CLI agent. Remaining: e2e testing, npm publish, CI/CD.*
