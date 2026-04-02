import chalk from 'chalk';
import { basename } from 'node:path';
import { loadConfig, resolveProvider, updateConfig, type Message, type StreamEvent } from '@blush/ai';
import {
  createAgent,
  saveSession,
  loadSession,
  listSessionSummaries,
  getActiveMessages,
  SkillRegistry,
  type SessionSummary,
} from '@blush/core';
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
  renderDim,
  renderWelcome,
  renderGoodbye,
  renderStatus,
  renderDivider,
  renderHelp,
  setTheme,
  getTheme,
  listThemes,
  activateLayout,
  deactivateLayout,
  isLayoutActive,
  clearFooterLines,
  renderLayout,
  sym,
} from '@blush/tui';
import {
  btw,
  compact,
  copy,
  showContext,
  showDiff,
  showSuggestions,
  clearSuggestionsBelowCursor,
  handleTeamCommand,
  showSkills,
  listSelectableModels,
  resolveModelSelection,
  showModelSelector,
} from './commands/index.js';
import { assistantPrefix, prefixStreamChunk, summarizeToolInput } from './rendering.js';

const VERSION = '0.1.0';
const SLASH_COMMANDS = [
  '/btw',
  '/compact',
  '/branch',
  '/context',
  '/diff',
  '/model',
  '/resume',
  '/team',
  '/skills',
  '/theme',
  '/copy',
  '/save',
  '/help',
  '/exit',
];
const TEAM_SUBCOMMANDS = ['spawn', 'msg', 'status', 'synthesize', 'review', 'pipeline', 'merge'];

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

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return 'unknown';

  const diffMs = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return 'just now';
  if (diffMs < hour) return `${Math.round(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.round(diffMs / day)}d ago`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function truncateMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return text.slice(0, maxLength);
  return text.slice(0, maxLength - 1) + '…';
}

function matchingCompletions(line: string, candidates: string[]): string[] {
  const normalized = line.toLowerCase();
  return candidates.filter((candidate) => candidate.toLowerCase().startsWith(normalized));
}

function parseArgs(args: string[]): CliOptions {
  const config = loadConfig();
  const opts: CliOptions = {
    model: process.env.BLUSH_MODEL || config.default_model || 'claude-sonnet-4-20250514',
    theme: config.default_theme,
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
      console.log(`blush ${VERSION}`);
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
  const theme = getTheme();
  const cwd = process.cwd();
  const sessions = await listSessionSummaries(cwd);
  if (sessions.length === 0) {
    renderDim('  No sessions found for this directory.');
    return;
  }
  renderLine(chalk.hex(theme.text).bold('\n  Sessions\n'));
  for (const session of sessions) {
    const title = chalk.hex(theme.text)(truncateMiddle(session.title, 64));
    const meta = chalk.hex(theme.dim)(`${session.entryCount} msgs · ${formatRelativeTime(session.updatedAt)}`);
    renderLine(`  ${chalk.hex(theme.muted)(sym.bullet)} ${title}`);
    renderLine(`    ${chalk.hex(theme.text)(session.id)} · ${meta}`);
  }
  renderLine('');
}

async function showSessionSelector(currentSessionId?: string): Promise<SessionSummary[]> {
  const theme = getTheme();
  const cwd = process.cwd();
  const sessions = await listSessionSummaries(cwd);

  if (sessions.length === 0) {
    renderDim('  No sessions found for this directory.');
    return [];
  }

  renderLine('');
  renderLine(chalk.hex(theme.text).bold('  Sessions'));
  renderLine('');
  for (const [index, session] of sessions.entries()) {
    const isCurrent = session.id === currentSessionId;
    const marker = isCurrent
      ? chalk.hex(theme.prompt)(sym.prompt)
      : chalk.hex(theme.muted)(String(index + 1).padStart(2, ' '));
    const current = isCurrent ? chalk.hex(theme.prompt)(' current') : '';
    const title = truncateMiddle(session.title, 56);
    const meta = `${session.entryCount} msgs · ${formatRelativeTime(session.updatedAt)}`;
    renderLine(`  ${marker} ${chalk.hex(theme.text)(title)}${current}`);
    renderLine(`     ${chalk.hex(theme.text)(session.id)} · ${chalk.hex(theme.dim)(meta)}`);
  }
  renderLine('');

  return sessions;
}

function printHelp(): void {
  const theme = getTheme();

  renderLine('');
  renderLine(chalk.hex(theme.prompt).bold('  blush') + chalk.hex(theme.dim)(' -- team CLI agent from ap.haus'));
  renderLine('');

  renderDivider('usage');
  renderLine('');
  renderHelp([
    ['  blush', 'Interactive mode (new session)'],
    ['  blush -p "question"', 'Print mode (single response)'],
    ['  blush -p "q" --json', 'Print mode with JSON output'],
    ['  blush --rpc', 'RPC mode (JSONL over stdin/stdout)'],
    ['  blush -r, --resume', 'Resume last session'],
    ['  blush -s, --session <id>', 'Resume specific session'],
    ['  blush -m <model>', 'Set model'],
    ['  blush -t, --theme <name>', 'Set color theme'],
  ]);

  renderLine('');
  renderDivider('subcommands');
  renderLine('');
  renderHelp([
    ['  blush init', 'First-time setup'],
    ['  blush sessions', 'List sessions for current directory'],
    ['  blush install <source>', 'Install package'],
    ['  blush list', 'List installed packages'],
    ['  blush remove <name>', 'Remove a package'],
  ]);

  renderLine('');
  renderDivider('commands');
  renderLine('');
  renderHelp([
    ['  /btw <question>', 'Ephemeral question (no history)'],
    ['  /compact [focus]', 'Compress conversation'],
    ['  /branch', 'Fork conversation at current point'],
    ['  /context', 'Show context window usage'],
    ['  /diff', 'Show uncommitted git changes'],
    ['  /model [name|number]', 'Switch model or open selector'],
    ['  /resume [id|number]', 'Resume another saved session'],
    ['  /team <subcommand>', 'Team management'],
    ['  /skills', 'List installed skills'],
    ['  /theme [name]', 'Set or show color theme'],
    ['  /copy [N]', 'Copy Nth response to clipboard'],
    ['  /help', 'Show this help'],
    ['  /exit', 'Exit'],
  ]);

  renderLine('');
  renderDivider('keys');
  renderLine('');
  renderHelp([
    ['  Enter', 'Send message'],
    ['  Tab', 'Complete commands, models, sessions, and paths'],
    ['  Tab Tab', 'Show all matching completions'],
    ['  !command', 'Run shell command directly'],
    ['  Ctrl+C', 'Exit'],
  ]);
  renderLine('');
}

function getResumePreviewText(message: Message): { role: 'user' | 'assistant'; text: string } | null {
  if (typeof message.content === 'string') {
    return message.content.trim()
      ? { role: message.role, text: message.content.trim() }
      : null;
  }

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();

  if (text) {
    return { role: message.role, text };
  }

  if (message.role === 'assistant') {
    const toolUse = message.content.find((block) => block.type === 'tool_use');
    if (toolUse && toolUse.type === 'tool_use') {
      return { role: 'assistant', text: `[used ${toolUse.name}]` };
    }
  }

  return null;
}

function renderResumePreview(messages: Message[]): void {
  const theme = getTheme();
  const preview = messages
    .map(getResumePreviewText)
    .filter((message): message is { role: 'user' | 'assistant'; text: string } => Boolean(message));

  if (preview.length === 0) return;

  const shown = preview.slice(-8);
  renderDivider('resume');
  if (preview.length > shown.length) {
    renderDim(`  showing last ${shown.length} of ${preview.length} visible messages`);
  }

  for (const message of shown) {
    const prefix = message.role === 'user'
      ? `  ${chalk.hex(theme.prompt)(sym.prompt)} `
      : `  ${chalk.hex(theme.border)(sym.boxV)} `;
    const content = message.role === 'assistant'
      ? renderMarkdown(message.text)
      : message.text;
    const { output } = prefixStreamChunk(content, prefix, true);
    renderText(output + '\n');
    renderText('\n');
  }
}

export async function run(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // RPC mode: JSONL over stdin/stdout, no TUI
  if (opts.rpc) {
    const { runRpc } = await import('./rpc.js');
    await runRpc(opts.model);
    return;
  }

  let currentModel = opts.model;
  const cwd = process.cwd();

  // Apply theme
  if (opts.theme) {
    if (!setTheme(opts.theme)) {
      renderError(`Unknown theme: ${opts.theme}. Available: ${listThemes().join(', ')}`);
    }
  }

  // Load skills
  const skills = new SkillRegistry();
  const skillCount = await skills.loadAll(cwd);

  // Handle session resume
  let existingSession: Awaited<ReturnType<typeof loadSession>> | undefined = undefined;
  if (opts.resume || opts.sessionId) {
    const sessions = await listSessionSummaries(cwd);
    const targetId = opts.sessionId || sessions[0]?.id;
    if (targetId) {
      const loaded = await loadSession(cwd, targetId);
      if (loaded) {
        existingSession = loaded;
      } else {
        renderDim(`  Session not found: ${targetId}, starting new`);
      }
    }
  }
  let activeSession = existingSession;

  // Lazy agent creation
  let agent: Awaited<ReturnType<typeof createAgent>> | null = null;
  const quietStreamOutput = Boolean(opts.print && opts.json);
  let responseStarted = false;
  let assistantLineStart = true;

  function beginResponse(): void {
    if (quietStreamOutput) return;
    if (responseStarted) return;
    renderText('\n');
    responseStarted = true;
    assistantLineStart = true;
  }

  function renderAssistantChunk(text: string): void {
    const theme = getTheme();
    const { output, lineStart } = prefixStreamChunk(
      text,
      assistantPrefix(
        `  ${chalk.hex(theme.border)(sym.boxV)} `,
        `  ${chalk.hex(theme.border)(sym.boxV)} `,
      ),
      assistantLineStart,
    );
    assistantLineStart = lineStart;
    if (output) {
      renderText(output);
    }
  }

  async function sendAndRender(a: Awaited<ReturnType<typeof createAgent>>, content: string) {
    responseStarted = false;
    assistantLineStart = true;
    const response = await a.send(content);
    if (!quietStreamOutput) {
      renderText('\n');
    }
    return response;
  }

  async function getAgent() {
    if (agent) return agent;

    const { provider, model: resolvedModel } = resolveProvider(currentModel);
    currentModel = resolvedModel;

    agent = await createAgent({
      provider,
      model: currentModel,
      cwd,
      session: activeSession || undefined,
      onStream: (event: StreamEvent) => {
        if (quietStreamOutput && event.type !== 'error') {
          return;
        }

        switch (event.type) {
          case 'text': {
            beginResponse();
            renderAssistantChunk(event.text || '');
            break;
          }
          case 'thinking':
            beginResponse();
            renderAssistantChunk(chalk.hex(getTheme().dim)(event.text || ''));
            break;
          case 'error':
            beginResponse();
            renderError(event.error || 'Unknown error');
            break;
        }
      },
      onToolStart: (name, toolInput) => {
        if (quietStreamOutput) return;
        beginResponse();
        renderToolStart(name, summarizeToolInput(name, toolInput));
      },
      onToolEnd: (name, result) => {
        if (quietStreamOutput) return;
        renderToolEnd(name, result);
      },
    });
    activeSession = agent.session;

    return agent;
  }

  async function switchModel(nextModel: string): Promise<void> {
    const { model: resolvedModel } = resolveProvider(nextModel);
    if (resolvedModel === currentModel) {
      renderDim(`  Model unchanged: ${currentModel}`);
      return;
    }

    if (agent) {
      activeSession = agent.session;
      await saveSession(agent.session);
    }

    currentModel = resolvedModel;
    agent = null;
    await updateConfig({ default_model: currentModel });
    renderDim(`  Model set to: ${currentModel}`);
  }

  async function resumeSession(selection?: string): Promise<void> {
    const currentSessionId = agent?.session.id || activeSession?.id;
    let sessionId = selection?.trim() || '';

    if (!sessionId) {
      const sessions = await showSessionSelector(currentSessionId);
      if (sessions.length === 0) return;

      const selected = await input.getLine('  Select session number or id › ');
      if (!selected.trim()) {
        renderDim('  Resume cancelled');
        return;
      }

      if (/^\d+$/.test(selected.trim())) {
        sessionId = sessions[Number(selected.trim()) - 1]?.id || '';
      } else {
        sessionId = selected.trim();
      }
    }

    if (!sessionId) {
      renderError('Unknown session selection');
      return;
    }

    if (sessionId === currentSessionId) {
      renderDim(`  Already on session: ${sessionId}`);
      return;
    }

    if (agent) {
      activeSession = agent.session;
      await saveSession(agent.session);
    }

    const loaded = await loadSession(cwd, sessionId);
    if (!loaded) {
      renderError(`Session not found: ${sessionId}`);
      return;
    }

    existingSession = loaded;
    activeSession = loaded;
    agent = null;

    renderDim(`  Resumed session: ${sessionId} (${loaded.entries.length} messages)`);
    renderResumePreview(getActiveMessages(loaded));
  }

  // Print mode
  if (opts.print) {
    try {
      const a = await getAgent();
      const response = await a.send(opts.print);
      if (!opts.json) {
        renderText('\n');
      }
      if (opts.json) {
        const text = typeof response.content === 'string'
          ? response.content
          : response.content
              .filter((b) => b.type === 'text')
              .map((b) => (b.type === 'text' ? b.text : ''))
              .join('');
        console.log(JSON.stringify({
          content: text,
          usage: a.usage.total,
          session: a.session.id,
        }));
      }
    } catch (err) {
      renderError((err as Error).message);
    }
    process.exit(0);
  }

  // Interactive mode -- show welcome banner
  activateLayout();
  const projectLabel = basename(cwd) || cwd;
  const sessionLabel = existingSession
    ? `${existingSession.entries.length} msgs resumed`
    : 'new session';
  await renderWelcome(VERSION, currentModel, projectLabel, sessionLabel);
  if (existingSession) {
    renderResumePreview(getActiveMessages(existingSession));
  }

  if (skillCount > 0) {
    renderDim(`  ${sym.toolDone} ${skillCount} skill(s) loaded`);
  }

  const input = createInput({
    cwd,
    commands: SLASH_COMMANDS,
    complete: async (line) => {
      if (line.startsWith('/theme ')) {
        return matchingCompletions(
          line,
          listThemes().map((themeName) => `/theme ${themeName}`),
        );
      }

      if (line.startsWith('/model ')) {
        return matchingCompletions(
          line,
          listSelectableModels().map((model) => `/model ${model.name}`),
        );
      }

      if (line.startsWith('/resume ')) {
        const sessions = await listSessionSummaries(cwd);
        return matchingCompletions(
          line,
          sessions.map((session) => `/resume ${session.id}`),
        );
      }

      if (line === '/team' || line.startsWith('/team ')) {
        return matchingCompletions(
          line,
          TEAM_SUBCOMMANDS.map((subcommand) => `/team ${subcommand}`),
        );
      }

      return [];
    },
  });
  const theme = getTheme();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    renderText('\n');
    if (agent) {
      await saveSession(agent.session);
      renderGoodbye(agent.session.id);
    } else {
      renderGoodbye();
    }
    input.close();
    deactivateLayout();
    process.exit(0);
  });

  const handleCommand = async (name: string, args: string): Promise<boolean> => {
    const theme = getTheme();

    switch (name) {
      case 'diff':
        showDiff();
        return true;

      case 'skills':
        showSkills(skills);
        return true;

      case 'theme': {
        if (!args) {
          const current = getTheme();
          const available = listThemes();
          renderLine('');
          for (const themeName of available) {
            const marker = themeName === current.name ? chalk.hex(current.prompt)(sym.prompt) : ' ';
            renderLine(`  ${marker} ${chalk.hex(current.dim)(themeName)}`);
          }
          renderLine('');
          return true;
        }
        if (setTheme(args.trim())) {
          const t = getTheme();
          await updateConfig({ default_theme: t.name });
          renderLine(`\n  ${chalk.hex(t.prompt)(sym.toolDone)} Theme: ${chalk.hex(t.prompt)(t.label)}\n`);
        } else {
          renderError(`Unknown theme: ${args}. Available: ${listThemes().join(', ')}`);
        }
        return true;
      }

      case 'model':
        if (!args) {
          showModelSelector(currentModel);
          const selected = await input.getLine('  Select model number or name › ');
          if (!selected.trim()) {
            renderDim('  Model selection cancelled');
            return true;
          }

          const chosenModel = resolveModelSelection(selected) || selected.trim();
          try {
            await switchModel(chosenModel);
          } catch {
            renderError(`Unknown model: ${selected.trim()}`);
          }
          return true;
        }
        try {
          await switchModel(resolveModelSelection(args.trim()) || args.trim());
        } catch {
          renderError(`Unknown model: ${args.trim()}`);
        }
        return true;

      case 'sessions': {
        await listSessionsCommand();
        return true;
      }

      case 'resume': {
        await resumeSession(args);
        return true;
      }

      case 'help':
        printHelp();
        return true;

      case 'exit':
      case 'quit':
        if (agent) {
          await saveSession(agent.session);
          renderGoodbye(agent.session.id);
        } else {
          renderGoodbye();
        }
        input.close();
        deactivateLayout();
        process.exit(0);

      case 'btw': {
        if (!args) {
          renderError('/btw requires a question');
          return true;
        }
        const a = await getAgent();
        const { provider: p } = resolveProvider(currentModel);
        await btw(args, a.getMessages(), p, currentModel);
        return true;
      }

      case 'compact': {
        const a = await getAgent();
        const { provider: p } = resolveProvider(currentModel);
        await compact(a.session, p, currentModel, args || undefined);
        return true;
      }

      case 'context': {
        const a = await getAgent();
        showContext(a.getMessages(), currentModel);
        return true;
      }

      case 'branch': {
        const a = await getAgent();
        renderDim(`  Conversation branched at: ${a.session.currentBranch}`);
        return true;
      }

      case 'copy': {
        const a = await getAgent();
        copy(args, a.getMessages());
        return true;
      }

      case 'save': {
        const a = await getAgent();
        await saveSession(a.session);
        renderDim(`  Session saved: ${a.session.id}`);
        return true;
      }

      case 'team': {
        const { provider: p } = resolveProvider(currentModel);
        await handleTeamCommand(args, cwd, p, currentModel);
        return true;
      }

      default: {
        const skill = skills.findByTrigger(`/${name}`);
        if (skill) {
          const content = skills.activate(skill.name);
          if (content) {
            renderDim(`  ${sym.toolDone} Activated skill: ${skill.name}`);
            const a = await getAgent();
            const prompt = args ? `${content}\n\nUser request: ${args}` : content;
            await sendAndRender(a, prompt);
          } else {
            renderDim(`  Skill ${skill.name} already active.`);
            if (args) {
              const a = await getAgent();
              await sendAndRender(a, args);
            }
          }
          return true;
        }

        if (agent) {
          const extCmd = agent.extensions.getCommand(name);
          if (extCmd) {
            await extCmd(args);
            return true;
          }
        }

        renderError(`Unknown command: /${name}`);
        return true;
      }
    }
  };

  // REPL loop
  while (true) {
    try {
      const promptColor = opts.color ? chalk.hex(opts.color) : chalk.hex(getTheme().prompt);
      if (!quietStreamOutput && !isLayoutActive()) {
        renderText('\n');
      }
      const line = await input.getLine(promptColor(`${sym.prompt} `));
      const trimmed = line.trim();

      clearSuggestionsBelowCursor(1);

      if (!trimmed) continue;

      if (isLayoutActive()) {
        clearFooterLines();
        renderLayout();
      }

      // ! prefix: run bash command directly
      if (trimmed.startsWith('!')) {
        const cmd = trimmed.slice(1).trim();
        if (cmd) {
          try {
            const { execSync } = await import('node:child_process');
            const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30000 });
            if (output.trim()) {
              renderLine(chalk.hex(getTheme().dim)(output.trimEnd()));
            }
            if (agent !== null) {
              const { addEntry } = await import('@blush/core');
              addEntry(agent!.session, {
                role: 'user',
                content: `[Shell command: ${cmd}]\n${output}`,
              });
            }
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
      try {
        const a = await getAgent();

        const usageBefore = { ...a.usage.total };
        const startTime = Date.now();
        await sendAndRender(a, trimmed);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Show status after response
        const total = a.usage.total;
        const turnInputTokens = total.inputTokens - usageBefore.inputTokens;
        const turnOutputTokens = total.outputTokens - usageBefore.outputTokens;
        renderStatus({
          model: currentModel,
          tokens: String(turnInputTokens + turnOutputTokens),
          cost: `$${((turnInputTokens * 0.003 + turnOutputTokens * 0.015) / 1000).toFixed(3)}`,
          time: `${elapsed}s`,
        });

        // Show prompt suggestions before the next prompt is rendered.
        const { provider: p } = resolveProvider(currentModel);
        await showSuggestions(a.getMessages(), p, currentModel);

        // Auto-save
        await saveSession(a.session);
      } catch (err) {
        renderError((err as Error).message);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') break;
      renderError((err as Error).message);
    }
  }
}
