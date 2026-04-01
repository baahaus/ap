# AP

Team CLI agent from [ap.haus](https://ap.haus). Terminal coding agent where multi-agent coordination is core architecture, not an extension.

**Philosophy:** Pi's minimalism + Claude Code's best ideas + team-native from day 1.

## Install

```bash
git clone https://github.com/baahaus/ap.git
cd ap
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
ap
```

## Setup

Run interactive setup:

```bash
ap init
```

Or set your API key manually:

```bash
# Environment variable
export ANTHROPIC_API_KEY=sk-ant-...

# Config file (~/.ap/config.json)
{ "anthropic_api_key": "sk-ant-..." }

# .env file in project root
ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

```bash
ap                                    # Interactive mode
ap -p "question"                      # Print mode (single response)
ap -p "question" --json               # JSON output
ap --rpc                              # RPC mode (JSONL stdin/stdout)
ap -m claude-opus-4-20250514          # Specific model
ap -m ollama:llama3.1                 # Ollama
ap -m http://localhost:8000/v1:qwen   # Custom endpoint
ap -r                                 # Resume last session
ap -t ocean                           # Color theme
```

### Subcommands

```bash
ap init                               # First-time setup
ap sessions                           # List sessions
ap install user/repo                  # Install package from GitHub
ap install npm:package-name           # Install from npm
ap list                               # List installed packages
ap remove <name>                      # Remove package
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
| `/copy [N]` | Copy Nth response to clipboard |
| `/model <name>` | Switch model mid-session |
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
@ap/ai     Multi-provider LLM + sidecar + compression
  |
@ap/core   Agent loop + 4 tools + extensions + skills + checkpoints
  |
@ap/tui    Terminal UI + overlays + themes
  |
@ap/cli    Binary + REPL + commands + RPC + SDK
  |
@ap/team   Peer agents + worktrees + mailbox + task queue
```

### 4 Core Tools

Pi.dev proved it: frontier models don't need 30 built-in tools.

| Tool | Purpose |
|------|---------|
| `read` | Read files with line numbers |
| `write` | Create/overwrite files |
| `edit` | Exact string replacement |
| `bash` | Shell execution with optional safety checks |

### Team-Native

Most agent frameworks bolt on multi-agent as an afterthought. AP builds it into the core:

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

7 built-in color themes: `default`, `mono`, `ocean`, `forest`, `sunset`, `rose`, `hacker`

```bash
ap -t hacker        # Set on start
/theme ocean        # Switch mid-session
```

## Operating Modes

| Mode | Flag | Use case |
|------|------|----------|
| Interactive | (default) | Full TUI REPL |
| Print | `-p "question"` | Single response, exit |
| JSON | `-p "q" --json` | Structured output for scripts |
| RPC | `--rpc` | JSONL stdin/stdout for editors/bots |
| SDK | `import from '@ap/cli/sdk'` | Programmatic embedding |

### SDK Usage

```typescript
import { createApSession } from '@ap/cli/sdk';

const session = await createApSession({
  model: 'claude-sonnet-4-20250514',
  cwd: '/path/to/project',
});

const response = await session.send('Read the package.json');
console.log(response.text);
```

## Context Files

AP reads instruction files hierarchically:

- `~/.ap/AGENTS.md` or `~/.ap/CLAUDE.md` -- global instructions
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

Install to `~/.ap/skills/` (global) or `.ap/skills/` (project).

## Extensions

TypeScript modules with full system access:

```typescript
export default function activate(ap) {
  ap.tools.register({ name: 'my-tool', ... });
  ap.commands.register('/my-cmd', async (args) => { ... });
  ap.events.on('tool:before', async (data) => { ... });
  ap.events.on('tool:after', async (data) => { ... });
  ap.context.append('Always consider accessibility...');
}
```

Install to `~/.ap/extensions/` (global) or `.ap/extensions/` (project).

## Packages

Install community extensions and skills:

```bash
ap install user/repo              # From GitHub
ap install npm:ap-extension-foo   # From npm
ap install git:https://...        # From any git URL
ap list                           # Show installed
ap remove <name>                  # Uninstall
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
