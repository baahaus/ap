import chalk from 'chalk';
import { resolveProvider, type StreamEvent } from '@ap/ai';
import { createAgent, saveSession, loadSession, listSessions, branchAt } from '@ap/core';
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
} from '@ap/tui';
import { btw, compact, showContext, handleTeamCommand } from './commands/index.js';

const VERSION = '0.1.0';

interface CliOptions {
  model: string;
  color?: string;
  print?: string;
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
    } else if (arg === '--version' || arg === '-v') {
      console.log(`ap ${VERSION}`);
      process.exit(0);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === 'sessions') {
      listSessionsCommand().then(() => process.exit(0));
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
  ap -r, --resume           Resume last session
  ap -s, --session <id>     Resume specific session
  ap -n, --new              Force new session
  ap -m <model>             Set model
  ap --color <hex>          Set prompt color
  ap sessions               List sessions for current directory

${chalk.bold('Commands:')}
  /btw <question>           Ephemeral question (no history)
  /compact [focus]          Compress conversation
  /branch                   Fork conversation at current point
  /context                  Show context window usage
  /model <name>             Switch model
  /team <subcommand>        Team management
  /save                     Save session now
  /sessions                 List sessions
  /help                     Show this help
  /exit                     Exit

${chalk.bold('Keys:')}
  Enter                     Send message
  Ctrl+C                    Exit
  `);
}

export async function run(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const { provider, model: resolvedModel } = resolveProvider(opts.model);
  let currentModel = resolvedModel;

  const cwd = process.cwd();

  const agent = await createAgent({
    provider,
    model: currentModel,
    cwd,
    onStream: (event: StreamEvent) => {
      switch (event.type) {
        case 'text':
          renderText(event.text || '');
          break;
        case 'thinking':
          // Dim thinking output
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

  // Handle session resume
  if (opts.resume || opts.sessionId) {
    const sessions = await listSessions(cwd);
    const targetId = opts.sessionId || sessions[sessions.length - 1];
    if (targetId) {
      const loaded = await loadSession(cwd, targetId);
      if (loaded) {
        agent.session.id = loaded.id;
        agent.session.entries = loaded.entries;
        agent.session.currentBranch = loaded.currentBranch;
        console.log(chalk.dim(`Resumed session: ${targetId} (${loaded.entries.length} messages)`));
      } else {
        console.log(chalk.dim(`Session not found: ${targetId}, starting new`));
      }
    }
  }

  // Print mode: single question, single response, exit
  if (opts.print) {
    await agent.send(opts.print);
    renderText('\n');
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

      case 'help':
        printHelp();
        return true;

      case 'exit':
      case 'quit':
        await saveSession(agent.session);
        console.log(chalk.dim(`Session saved: ${agent.session.id}`));
        input.close();
        process.exit(0);

      default:
        renderError(`Unknown command: /${name}`);
        return true;
    }
  };

  // REPL loop
  while (true) {
    renderPrompt(opts.color);

    try {
      const line = await input.getLine('');
      const trimmed = line.trim();

      if (!trimmed) continue;

      if (isCommand(trimmed)) {
        const { name, args } = parseCommand(trimmed);
        await handleCommand(name, args);
        continue;
      }

      // Send to agent
      await agent.send(trimmed);
      renderText('\n');

      // Auto-save after each exchange
      await saveSession(agent.session);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') break;
      renderError((err as Error).message);
    }
  }
}
