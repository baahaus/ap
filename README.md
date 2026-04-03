# Blush

Team CLI agent from [ap.haus](https://ap.haus). Terminal coding agent where multi-agent coordination is core architecture, not an extension.

**Philosophy:** Pi's minimalism + Claude Code's best ideas + team-native from day 1.

## Install

```bash
git clone https://github.com/baahaus/blush.git
cd blush
pnpm install
pnpm build
```

Run directly:

```bash
./packages/cli/dist/bin.js
```

Or link globally:

```bash
pnpm link --global packages/cli
blush
```

## Setup

Run interactive setup:

```bash
blush init
```

Or set your API key manually:

```bash
# Environment variable
export ANTHROPIC_API_KEY=sk-ant-...

# Config file (~/.blush/config.json)
{ "anthropic_api_key": "sk-ant-..." }

# .env file in project root
ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

```bash
blush                                   # Interactive mode
blush -p "question"                      # Print mode (single response)
blush -p "question" --json               # JSON output
blush --rpc                              # RPC mode (JSONL stdin/stdout)
blush -m claude-opus-4-20250514          # Specific model
blush -m ollama:llama3.1                 # Ollama
blush -m http://localhost:8000/v1:qwen   # Custom endpoint
blush -r                                 # Resume last session
blush -t ocean                           # Color theme
```

### Subcommands

```bash
blush init                               # First-time setup
blush sessions                           # List sessions
blush install user/repo                  # Install package from GitHub
blush install npm:package-name           # Install from npm
blush list                               # List installed packages
blush remove <name>                      # Remove package
```

### Model Formats

```bash
claude-sonnet-4-20250514              # Auto-detect Anthropic
gpt-4o                                # Auto-detect OpenAI
anthropic:claude-opus-4-20250514      # Explicit provider
ollama:llama3.1                       # Ollama (localhost:11434)
local:qwen-2.5-coder                 # Local vLLM (localhost:8000)
http://host:port/v1:model-name        # Any OpenAI-compatible endpoint
```

## Commands

| Command | Description |
|---------|-------------|
| `/btw <question>` | Ephemeral question -- full context, no tools, no history |
| `/compact [focus]` | Compress conversation with optional focus |
| `/branch` | Fork conversation at current point |
| `/context` | Visualize context window usage |
| `/diff` | Show uncommitted git changes with color |
| `/effort [on|off]` | Toggle extended thinking |
| `/mcp` | Show connected MCP servers and tools |
| `/copy [N]` | Copy Nth response to clipboard |
| `/model <name>` | Switch model mid-session |
| `/new` | Start a new session |
| `/theme [name]` | Set or show color theme |
| `/team spawn <name>` | Create a peer agent with its own worktree |
| `/team msg <name> <msg>` | Send message to an agent |
| `/team status` | Show all agents and tasks |
| `/team synthesize` | Combine all agent outputs |
| `/team merge <name>` | Merge agent's changes back |
| `/skills` | List installed skills |
| `/save` | Save session |
| `/help` | Show all commands |

### Shell Passthrough

Type `!` before any command to run it directly without the agent:

```
> !git status
> !npm test
```

Output is added to the conversation context so the agent can see it.

## Architecture

5-package TypeScript monorepo:

```
@blush/ai     Multi-provider LLM + sidecar + compression
  |
@blush/core   Agent loop + core tools + extensions + skills + checkpoints
  |
@blush/tui    Terminal UI + overlays + themes
  |
@blush/cli    Binary + REPL + commands + RPC + SDK
  |
@blush/team   Peer agents + worktrees + mailbox + task queue
```

### Core Tools

Pi.dev proved it: frontier models don't need 30 built-in tools.

| Tool | Purpose |
|------|---------|
| `read` | Read files with line numbers |
| `write` | Create/overwrite files |
| `edit` | Exact string replacement |
| `bash` | Shell execution with optional safety checks |
| `glob` | Find files by pattern |
| `grep` | Search file contents with regex |
| `todo` | Read/update the agent's task list |
| `web_fetch` | Fetch a web page and extract readable text |
| `web_search` | Search the web for current information |

### Team-Native

Most agent frameworks bolt on multi-agent as an afterthought. Blush builds it into the core:

- **Peer agents** -- equals, not parent-child
- **Git worktree isolation** -- each agent gets a full repo copy
- **File-based mailboxes** -- structured message passing
- **Shared task queue** -- create, claim, complete with dependencies
- **Consensus patterns** -- synthesis, vote, review, pipeline

### Sidecar

A cheap, fast model (Haiku or gpt-4o-mini) handles:
- Bash command safety classification
- Conversation summarization for /compact
- Session title generation
- Prompt suggestions after responses

### Compression

Optional [Wren](https://github.com/Divagation/wren) integration compresses tool output before it enters the context window. Auto-detected when `~/wren/bin/wren` exists.

### Themes

7 built-in color themes: `blush`, `mono`, `ocean`, `forest`, `sunset`, `rose`, `hacker`

```bash
blush -t hacker        # Set on start
/theme ocean        # Switch mid-session
```

## Operating Modes

| Mode | Flag | Use case |
|------|------|----------|
| Interactive | (default) | Full TUI REPL |
| Print | `-p "question"` | Single response, exit |
| JSON | `-p "q" --json` | Structured output for scripts |
| RPC | `--rpc` | JSONL stdin/stdout for editors/bots |
| SDK | `import from '@blush/cli/sdk'` | Programmatic embedding |

### SDK Usage

```typescript
import { createBlushSession } from '@blush/cli/sdk';

const session = await createBlushSession({
  model: 'claude-sonnet-4-20250514',
  cwd: '/path/to/project',
});

const response = await session.send('Read the package.json');
console.log(response.text);
```

## Context Files

Blush reads instruction files hierarchically:

- `~/.blush/AGENTS.md` or `~/.blush/CLAUDE.md` -- global instructions
- `./AGENTS.md` or `./CLAUDE.md` -- per-project instructions
- `./SYSTEM.md` -- full system prompt override
- `./APPEND_SYSTEM.md` -- append to system prompt

## Skills

Markdown files with frontmatter. Zero context cost until activated.

```markdown
---
name: security-review
trigger: /security-review
description: Analyze changes for vulnerabilities
tools: [read, bash]
---

Analyze pending changes on the current branch...
```

**Built-in skills:** `/security-review`, `/commit`, `/simplify`

Install to `~/.blush/skills/` (global) or `.blush/skills/` (project).

## Extensions

TypeScript modules with full system access:

```typescript
export default function activate(blush) {
  blush.tools.register({ name: 'my-tool', ... });
  blush.commands.register('/my-cmd', async (args) => { ... });
  blush.events.on('tool:before', async (data) => { ... });
  blush.events.on('tool:after', async (data) => { ... });
  blush.context.append('Always consider accessibility...');
}
```

Install to `~/.blush/extensions/` (global) or `.blush/extensions/` (project).

## Packages

Install community extensions and skills:

```bash
blush install user/repo              # From GitHub
blush install npm:blush-extension-foo   # From npm
blush install git:https://...        # From any git URL
blush list                           # Show installed
blush remove <name>                  # Uninstall
```

## What We Stole

From **pi.dev**: 4-tool core, layered packages, JSONL sessions, sub-1000-token system prompt, extension system.

From **Claude Code**: /btw, /compact, /branch, /context, /diff, /copy, agent teams with worktree isolation, prompt cache preservation, haiku sidecar, `!` shell passthrough.

## License

MIT

## Links

- [ap.haus](https://ap.haus) -- Research org
- [PLAN.md](PLAN.md) -- Full architecture plan
- [baa.haus](https://baa.haus) -- Creator
