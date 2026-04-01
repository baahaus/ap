import chalk from 'chalk';
import { resolveProvider, type StreamEvent } from '@ap/ai';
import { createAgent, branchAt } from '@ap/core';
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
import { btw, compact, showContext } from './commands/index.js';

const VERSION = '0.1.0';

interface CliOptions {
  model: string;
  color?: string;
  print?: string; // Non-interactive: print mode
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
    } else if (arg === '--version' || arg === '-v') {
      console.log(`ap ${VERSION}`);
      process.exit(0);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      // Treat as print mode input
      opts.print = arg;
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
${chalk.bold('ap')} -- Team CLI Agent from ap.haus

${chalk.bold('Usage:')}
  ap                        Interactive mode
  ap -p "question"          Print mode (single response)
  ap -m <model>             Set model
  ap --color <hex>          Set prompt color

${chalk.bold('Commands:')}
  /btw <question>           Ephemeral question (no history)
  /compact [focus]          Compress conversation
  /branch                   Fork conversation at current point
  /context                  Show context window usage
  /model <name>             Switch model
  /effort <level>           Set effort (low/medium/high/max)
  /team <subcommand>        Team management
  /help                     Show this help

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
          // Suppress thinking in output for now
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
    const text = typeof response.content === 'string'
      ? response.content
      : response.content
          .filter((b) => b.type === 'text')
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('');
    renderLine('');
    process.exit(0);
  }

  // Interactive mode
  console.log(chalk.dim(`ap ${VERSION} | ${currentModel} | /help for commands`));

  const input = createInput();

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
        // Branch at the current point (effectively a no-op until we add selection)
        renderLine(chalk.dim('Conversation branched at current point.'));
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

      case 'help':
        printHelp();
        return true;

      case 'exit':
      case 'quit':
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
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') break;
      renderError((err as Error).message);
    }
  }
}
