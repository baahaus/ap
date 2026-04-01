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

### Phase 1 -- Foundation (this session)
- [x] PLAN.md
- [ ] Monorepo scaffold (turborepo, tsconfig, package.json)
- [ ] @ap/ai -- Anthropic provider with streaming + tool calling
- [ ] @ap/core -- Agent loop with 4 core tools
- [ ] @ap/tui -- Basic streaming output + input
- [ ] @ap/cli -- `ap` binary that runs interactive sessions
- [ ] First working REPL: `ap` launches, accepts input, calls Claude, executes tools

### Phase 2 -- Commands & Sessions
- [ ] JSONL session storage with branching
- [ ] /btw implementation
- [ ] /compact with focus instructions
- [ ] /branch conversation forking
- [ ] /context visualization
- [ ] /model switching
- [ ] Session resume

### Phase 3 -- Team
- [ ] @ap/team package
- [ ] Git worktree isolation
- [ ] Mailbox system
- [ ] Task queue
- [ ] /team commands
- [ ] Consensus patterns (synthesis, review)

### Phase 4 -- Ecosystem
- [ ] Extension loading + API
- [ ] Skills system
- [ ] Package registry
- [ ] OpenAI + Gemini providers
- [ ] OpenAI-compatible endpoint support
- [ ] Wren compression integration

### Phase 5 -- Polish
- [ ] Haiku sidecar
- [ ] Double-escape rewind
- [ ] Diff viewer
- [ ] Prompt suggestions
- [ ] Themes
- [ ] RPC + SDK modes

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

*Last updated: 2026-04-01*
*Status: Phase 1 -- Foundation*
