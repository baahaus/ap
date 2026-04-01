import chalk from 'chalk';
import { resolveProvider, type StreamEvent } from '@ap/ai';
import { createAgent, saveSession, loadSession, listSessions, branchAt, SkillRegistry } from '@ap/core';
import {
  createInput,
  isCommand,
  parseCommand,
  renderText,
  renderLine,
  renderMarkdown,
  renderToolStart,
  renderToolEnd,
  renderError,
  renderPrompt,
  setTheme,
  getTheme,
  listThemes,
} from '@ap/tui';
import { btw, compact, copy, showContext, showDiff, showSuggestions, handleTeamCommand, showSkills } from './commands/index.js';

const VERSION = '0.1.0';

interface CliOptions {
  model: string;
  color?: string;
  theme?: string;
  print?: string;
  rpc?: boolean;
  json?: boolean;
  resume?: boolean;
  sessionId?: string;
  newSession?: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    model: process.env.AP_MODEL || 'claude-sonnet-4-20250514',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--model' || arg === '-m') {
      opts.model = args[++i];
    } else if (arg === '--color') {
      opts.color = args[++i];
    } else if (arg === '--print' || arg === '-p') {
      opts.print = args[++i];
    } else if (arg === '--resume' || arg === '-r') {
      opts.resume = true;
    } else if (arg === '--session' || arg === '-s') {
      opts.sessionId = args[++i];
    } else if (arg === '--new' || arg === '-n') {
      opts.newSession = true;
    } else if (arg === '--theme' || arg === '-t') {
      opts.theme = args[++i];
    } else if (arg === '--rpc') {
      opts.rpc = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--version' || arg === '-v') {
      console.log(`ap ${VERSION}`);
      process.exit(0);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === 'sessions') {
      listSessionsCommand().then(() => process.exit(0));
      return opts;
    } else if (arg === 'init') {
      import('./commands/init.js').then((m) => m.init()).then(() => process.exit(0));
      return opts;
    } else if (arg === 'install') {
      const source = args[++i] || '';
      import('./commands/packages.js').then((m) => m.installPackage(source)).then(() => process.exit(0));
      return opts;
    } else if (arg === 'list' || arg === 'packages') {
      import('./commands/packages.js').then((m) => m.listPackages()).then(() => process.exit(0));
      return opts;
    } else if (arg === 'remove' || arg === 'uninstall') {
      const pkg = args[++i] || '';
      import('./commands/packages.js').then((m) => m.removePackage(pkg)).then(() => process.exit(0));
      return opts;
    } else if (!arg.startsWith('-')) {
      opts.print = arg;
    }
  }

  return opts;
}

async function listSessionsCommand(): Promise<void> {
  const cwd = process.cwd();
  const sessions = await listSessions(cwd);
  if (sessions.length === 0) {
    console.log(chalk.dim('No sessions found for this directory.'));
    return;
  }
  console.log(chalk.bold('Sessions:'));
  for (const id of sessions) {
    console.log(`  ${id}`);
  }
}

function printHelp(): void {
  console.log(`
${chalk.bold('ap')} -- Team CLI Agent from ap.haus

${chalk.bold('Usage:')}
  ap                        Interactive mode (new session)
  ap -p "question"          Print mode (single response)
  ap -p "q" --json          Print mode with JSON output
  ap --rpc                  RPC mode (JSONL over stdin/stdout)
  ap -r, --resume           Resume last session
  ap -s, --session <id>     Resume specific session
  ap -n, --new              Force new session
  ap -m <model>             Set model (anthropic/openai/ollama/url)
  ap -t, --theme <name>     Set color theme
  ap --color <hex>          Set prompt color

${chalk.bold('Subcommands:')}
  ap init                   First-time setup (create ~/.ap, config)
  ap sessions               List sessions for current directory
  ap install <source>       Install package (npm:pkg, user/repo, git:url)
  ap list                   List installed packages
  ap remove <name>          Remove a package

${chalk.bold('Commands:')}
  /btw <question>           Ephemeral question (no history)
  /compact [focus]          Compress conversation
  /branch                   Fork conversation at current point
  /context                  Show context window usage
  /diff                     Show uncommitted git changes
  /model <name>             Switch model
  /team <subcommand>        Team management
  /skills                   List installed skills
  /theme [name]             Set or show color theme
  /save                     Save session now
  /sessions                 List sessions
  /copy [N]                 Copy Nth response to clipboard
  /help                     Show this help
  /exit                     Exit

${chalk.bold('Keys:')}
  Enter                     Send message
  !command                  Run shell command directly
  Ctrl+C                    Exit
  `);
}

export async function run(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // RPC mode: JSONL over stdin/stdout, no TUI
  if (opts.rpc) {
    const { runRpc } = await import('./rpc.js');
    await runRpc(opts.model);
    return;
  }

  const { provider, model: resolvedModel } = resolveProvider(opts.model);
  let currentModel = resolvedModel;

  const cwd = process.cwd();

  // Apply theme
  if (opts.theme) {
    if (!setTheme(opts.theme)) {
      console.error(`Unknown theme: ${opts.theme}. Available: ${listThemes().join(', ')}`);
    }
  }

  // Load skills
  const skills = new SkillRegistry();
  const skillCount = await skills.loadAll(cwd);
  if (skillCount > 0) {
    console.log(chalk.dim(`Loaded ${skillCount} skill(s)`));
  }

  // Handle session resume -- load before creating agent
  let existingSession = undefined;
  if (opts.resume || opts.sessionId) {
    const sessions = await listSessions(cwd);
    const targetId = opts.sessionId || sessions[sessions.length - 1];
    if (targetId) {
      const loaded = await loadSession(cwd, targetId);
      if (loaded) {
        existingSession = loaded;
        console.log(chalk.dim(`Resumed session: ${targetId} (${loaded.entries.length} messages)`));
      } else {
        console.log(chalk.dim(`Session not found: ${targetId}, starting new`));
      }
    }
  }

  const agent = await createAgent({
    provider,
    model: currentModel,
    cwd,
    session: existingSession,
    onStream: (event: StreamEvent) => {
      switch (event.type) {
        case 'text':
          renderText(event.text || '');
          break;
        case 'thinking':
          renderText(chalk.dim(event.text || ''));
          break;
        case 'error':
          renderError(event.error || 'Unknown error');
          break;
      }
    },
    onToolStart: (name) => {
      renderText('\n');
      renderToolStart(name);
    },
    onToolEnd: (name, result) => {
      renderToolEnd(name, result);
    },
  });

  // Print mode: single question, single response, exit
  if (opts.print) {
    const response = await agent.send(opts.print);
    if (opts.json) {
      // JSON output mode
      const text = typeof response.content === 'string'
        ? response.content
        : response.content
            .filter((b) => b.type === 'text')
            .map((b) => (b.type === 'text' ? b.text : ''))
            .join('');
      console.log(JSON.stringify({
        content: text,
        usage: agent.usage.total,
        session: agent.session.id,
      }));
    } else {
      renderText('\n');
    }
    process.exit(0);
  }

  // Interactive mode
  console.log(chalk.dim(`ap ${VERSION} | ${currentModel} | /help for commands`));
  console.log(chalk.dim(`session: ${agent.session.id}`));

  const input = createInput();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    renderText('\n');
    await saveSession(agent.session);
    console.log(chalk.dim(`Session saved: ${agent.session.id}`));
    input.close();
    process.exit(0);
  });

  const handleCommand = async (name: string, args: string): Promise<boolean> => {
    switch (name) {
      case 'btw':
        if (!args) {
          renderError('/btw requires a question');
          return true;
        }
        await btw(args, agent.getMessages(), provider, currentModel);
        return true;

      case 'compact':
        await compact(agent.session, provider, currentModel, args || undefined);
        return true;

      case 'context':
        showContext(agent.getMessages(), currentModel);
        return true;

      case 'branch':
        renderLine(chalk.dim(`Conversation branched at: ${agent.session.currentBranch}`));
        return true;

      case 'copy':
        copy(args, agent.getMessages());
        return true;

      case 'diff':
        showDiff();
        return true;

      case 'model':
        if (!args) {
          renderLine(chalk.dim(`Current model: ${currentModel}`));
          return true;
        }
        try {
          const resolved = resolveProvider(args);
          currentModel = resolved.model;
          renderLine(chalk.dim(`Switched to: ${currentModel}`));
        } catch (err) {
          renderError((err as Error).message);
        }
        return true;

      case 'save':
        await saveSession(agent.session);
        renderLine(chalk.dim(`Session saved: ${agent.session.id}`));
        return true;

      case 'sessions': {
        const sessions = await listSessions(cwd);
        if (sessions.length === 0) {
          renderLine(chalk.dim('No sessions.'));
        } else {
          for (const id of sessions) {
            const marker = id === agent.session.id ? chalk.green(' (current)') : '';
            renderLine(`  ${id}${marker}`);
          }
        }
        return true;
      }

      case 'team':
        await handleTeamCommand(args, cwd, provider, currentModel);
        return true;

      case 'skills':
        showSkills(skills);
        return true;

      case 'theme': {
        if (!args) {
          const current = getTheme();
          const available = listThemes();
          renderLine(chalk.dim(`Current: ${current.name}`));
          renderLine(chalk.dim(`Available: ${available.join(', ')}`));
          return true;
        }
        if (setTheme(args.trim())) {
          const t = getTheme();
          renderLine(chalk.hex(t.prompt)(`Theme set: ${t.name}`));
        } else {
          renderError(`Unknown theme: ${args}. Available: ${listThemes().join(', ')}`);
        }
        return true;
      }

      case 'help':
        printHelp();
        return true;

      case 'exit':
      case 'quit':
        await saveSession(agent.session);
        console.log(chalk.dim(`Session saved: ${agent.session.id}`));
        input.close();
        process.exit(0);

      default: {
        // Check extension commands
        const extCmd = agent.extensions.getCommand(name);
        if (extCmd) {
          await extCmd(args);
          return true;
        }

        // Check skill triggers
        const skill = skills.findByTrigger(`/${name}`);
        if (skill) {
          const content = skills.activate(skill.name);
          if (content) {
            renderLine(chalk.dim(`Activated skill: ${skill.name}`));
            // Send skill content + any args as a message to the agent
            const prompt = args
              ? `${content}\n\nUser request: ${args}`
              : content;
            await agent.send(prompt);
            renderText('\n');
          } else {
            renderLine(chalk.dim(`Skill ${skill.name} already active.`));
            if (args) {
              await agent.send(args);
              renderText('\n');
            }
          }
          return true;
        }

        renderError(`Unknown command: /${name}`);
        return true;
      }
    }
  };

  // REPL loop
  while (true) {
    renderPrompt(opts.color);

    try {
      const line = await input.getLine('');
      const trimmed = line.trim();

      if (!trimmed) continue;

      // ! prefix: run bash command directly, add output to context
      if (trimmed.startsWith('!')) {
        const cmd = trimmed.slice(1).trim();
        if (cmd) {
          try {
            const { execSync } = await import('node:child_process');
            const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30000 });
            if (output.trim()) {
              renderLine(chalk.dim(output.trimEnd()));
            }
            // Add to conversation so the agent can see it
            const { addEntry } = await import('@ap/core');
            addEntry(agent.session, {
              role: 'user',
              content: `[Shell command: ${cmd}]\n${output}`,
            });
          } catch (err) {
            const e = err as { stderr?: string; message?: string };
            renderError(e.stderr || e.message || 'Command failed');
          }
        }
        continue;
      }

      if (isCommand(trimmed)) {
        const { name, args } = parseCommand(trimmed);
        await handleCommand(name, args);
        continue;
      }

      // Send to agent
      await agent.send(trimmed);
      renderText('\n');

      // Show prompt suggestions (non-blocking, uses sidecar)
      showSuggestions(agent.getMessages(), provider, currentModel).catch(() => {});

      // Auto-save after each exchange
      await saveSession(agent.session);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') break;
      renderError((err as Error).message);
    }
  }
}
