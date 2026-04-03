import chalk from 'chalk';
import { basename } from 'node:path';
import { loadConfig, resolveProvider, updateConfig, estimateCost, generateSessionTitle, type Message, type StreamEvent } from '@blush/ai';
import {
  createAgent,
  saveSession,
  loadSession,
  listSessionSummaries,
  deleteSession,
  getActiveMessages,
  listBranches,
  switchBranch,
  SkillRegistry,
  type SessionSummary,
  type MCPConnection,
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
  clearToolActivity,
  renderError,
  renderDim,
  renderTurnSeparator,
  renderWelcome,
  renderGoodbye,
  renderThemeSwatch,
  renderStatus,
  createSpinner,
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
  resetLayout,
  sym,
  StreamMarkdown,
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
  addFavorite,
  removeFavorite,
} from './commands/index.js';
import { assistantPrefix, prefixStreamChunk, summarizeToolInput } from './rendering.js';

const VERSION = '0.1.2';
const SLASH_COMMANDS = [
  '/btw',
  '/compact',
  '/branch',
  '/context',
  '/diff',
  '/effort',
  '/mcp',
  '/model',
  '/new',
  '/resume',
  '/sessions',
  '/team',
  '/skills',
  '/theme',
  '/copy',
  '/loop',
  '/save',
  '/help',
  '/exit',
];
const BRANCH_SUBCOMMANDS = ['fork'];
const SESSIONS_SUBCOMMANDS = ['delete'];
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

function renderSessionBrowser(sessions: SessionSummary[], currentSessionId?: string): void {
  const theme = getTheme();
  const cwd = process.cwd();
  const home = process.env.HOME || '';
  const cwdDisplay = cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

  renderLine('');
  renderLine(`  ${chalk.hex(theme.text).bold('SESSIONS')}  ${chalk.hex(theme.muted)(`(${sessions.length} session${sessions.length === 1 ? '' : 's'} in ${cwdDisplay})`)}`);
  renderLine('');

  for (const [index, session] of sessions.entries()) {
    const isCurrent = session.id === currentSessionId;
    const num = String(index + 1);
    const marker = isCurrent
      ? chalk.hex(theme.prompt).bold(`${sym.prompt} ${num}`)
      : chalk.hex(theme.muted)(`  ${num}`);
    const title = truncateMiddle(session.title, 44);
    const titleFmt = isCurrent
      ? chalk.hex(theme.prompt).bold(title)
      : chalk.hex(theme.text).bold(title);
    const tag = isCurrent ? chalk.hex(theme.prompt)('  current') : '';

    // Build metadata line
    const metaParts: string[] = [];
    metaParts.push(`${session.entryCount} message${session.entryCount === 1 ? '' : 's'}`);
    metaParts.push(formatRelativeTime(session.updatedAt));
    if (session.model) {
      metaParts.push(session.model);
    }
    const meta = metaParts.join(` ${sym.dot} `);

    renderLine(`  ${marker}  ${titleFmt}${tag}`);
    renderLine(`       ${chalk.hex(theme.muted)(meta)}`);
    renderLine('');
  }
}

async function listSessionsCommand(): Promise<void> {
  const cwd = process.cwd();
  const sessions = await listSessionSummaries(cwd);
  if (sessions.length === 0) {
    renderDim('  No sessions yet. Start one and it\'ll show up here.');
    return;
  }
  renderSessionBrowser(sessions);
}

async function showSessionSelector(currentSessionId?: string): Promise<SessionSummary[]> {
  const cwd = process.cwd();
  const sessions = await listSessionSummaries(cwd);

  if (sessions.length === 0) {
    renderDim('  No sessions yet. Start one and it\'ll show up here.');
    return [];
  }

  renderSessionBrowser(sessions, currentSessionId);
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
    ['  /branch', 'List branches and switch, or /branch fork'],
    ['  /context', 'Show context window usage'],
    ['  /diff', 'Show uncommitted git changes'],
    ['  /effort [on|off]', 'Toggle extended thinking'],
    ['  /mcp', 'Show connected MCP servers and tools'],
    ['  /model [name|number]', 'Switch model or open selector'],
    ['  /model fav <name>', 'Add model to favorites'],
    ['  /model unfav <name>', 'Remove model from favorites'],
    ['  /new', 'Start a new session'],
    ['  /resume [id|number]', 'Resume another saved session'],
    ['  /sessions [delete]', 'Browse or manage sessions'],
    ['  /team <subcommand>', 'Team management'],
    ['  /skills', 'List installed skills'],
    ['  /theme [name]', 'Set or show color theme'],
    ['  /copy [N]', 'Copy Nth response to clipboard'],
    ['  /loop <interval> <prompt|/cmd>', 'Run on a timer (e.g. /loop 5m run tests)'],
    ['  /loop stop', 'Stop the active loop'],
    ['  /help', 'Show this help'],
    ['  /exit', 'Exit'],
  ]);

  renderLine('');
  renderDivider('keys');
  renderLine('');
  renderHelp([
    ['  Enter', 'Send message'],
    ['  Opt+Enter', 'Insert newline (multiline drafting)'],
    ['  Tab', 'Complete commands, models, sessions, and paths'],
    ['  Escape', 'Interrupt agent while working'],
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
  let thinking = false;
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
  let assistantCol = 0;
  const sessionStartTime = Date.now();
  let totalToolCalls = 0;
  const messageQueue: string[] = [];
  let isProcessing = false;
  let loopTimer: ReturnType<typeof setInterval> | null = null;
  let loopCommand = '';
  let loopIntervalMs = 0;
  let loopCount = 0;
  const spinner = createSpinner();
  const streamMd = new StreamMarkdown();
  let abortController: AbortController | null = null;
  let titleGenerated = Boolean(existingSession?.title);

  function beginResponse(): void {
    if (quietStreamOutput) return;
    if (responseStarted) return;
    renderTurnSeparator();
    streamMd.reset();
    responseStarted = true;
    assistantLineStart = true;
    assistantCol = 0;
  }

  function renderAssistantChunk(text: string): void {
    const theme = getTheme();
    const styled = streamMd.process(text);
    const { output, lineStart, col } = prefixStreamChunk(
      styled,
      assistantPrefix(
        `  ${chalk.hex(theme.border)(sym.boxV)} `,
        `  ${chalk.hex(theme.border)(sym.boxV)} `,
      ),
      assistantLineStart,
      assistantCol,
    );
    assistantLineStart = lineStart;
    assistantCol = col;
    if (output) {
      renderText(output);
    }
  }

  async function sendAndRender(a: Awaited<ReturnType<typeof createAgent>>, content: string) {
    responseStarted = false;
    assistantLineStart = true;
    assistantCol = 0;
    clearToolActivity();

    // Set up abort controller for this message
    abortController = new AbortController();
    const { signal } = abortController;

    // Listen for Escape while agent is running
    const onAbortKey = (_char: string, key: { name?: string }) => {
      if (key.name === 'escape' && abortController && !signal.aborted) {
        abortController.abort();
        spinner.stop();
        renderText('\n');
        renderDim('  interrupted');
      }
    };
    process.stdin.on('keypress', onAbortKey);

    if (!quietStreamOutput) {
      spinner.start('thinking');
    }
    try {
      // Race the send against the abort signal so Escape returns control immediately
      const aborted = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true });
      });
      const response = await Promise.race([
        a.send(content, { signal }),
        aborted,
      ]);
      if (!quietStreamOutput && !signal.aborted) {
        // Flush any pending markdown buffer
        const flushed = streamMd.flush();
        if (flushed) renderAssistantChunk(flushed);
        renderText('\n');
      }
      return response;
    } catch (err) {
      if ((err as Error).message === 'interrupted') {
        // Return a synthetic empty response -- partial work is already in the session
        return { role: 'assistant' as const, content: '' };
      }
      throw err;
    } finally {
      spinner.stop();
      clearToolActivity();
      process.stdin.off('keypress', onAbortKey);
      abortController = null;
    }
  }

  async function sendTurnWithStatus(a: Awaited<ReturnType<typeof createAgent>>, message: string) {
    const usageBefore = { ...a.usage.total };
    const toolCallsBefore = totalToolCalls;
    const startTime = Date.now();
    await sendAndRender(a, message);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const total = a.usage.total;
    const turnInputTokens = total.inputTokens - usageBefore.inputTokens;
    const turnOutputTokens = total.outputTokens - usageBefore.outputTokens;
    const turnCacheReadTokens = (total.cacheReadTokens || 0) - (usageBefore.cacheReadTokens || 0);
    const turnCost = estimateCost(currentModel, {
      inputTokens: turnInputTokens,
      outputTokens: turnOutputTokens,
      cacheReadTokens: turnCacheReadTokens,
    });
    const sessionCost = estimateCost(currentModel, {
      inputTokens: total.inputTokens,
      outputTokens: total.outputTokens,
      cacheReadTokens: total.cacheReadTokens,
    });
    const statusParts: Record<string, string> = {
      model: currentModel,
      tokens: `~${((turnInputTokens + turnOutputTokens) / 1000).toFixed(1)}k`,
    };
    if (sessionCost !== null) {
      const fmt = (v: number) => v < 0.01 ? v.toFixed(4) : v.toFixed(3);
      statusParts.cost = turnCost !== null && total.calls > 1
        ? `$${fmt(turnCost)} ($${fmt(sessionCost)} session)`
        : `$${fmt(sessionCost)}`;
    }
    const turnToolCalls = totalToolCalls - toolCallsBefore;
    if (turnToolCalls > 0) {
      statusParts.tools = String(turnToolCalls);
    }
    statusParts.time = `${elapsed}s`;
    renderStatus(statusParts);

    if (!titleGenerated) {
      titleGenerated = true;
      generateSessionTitle(message).then((title) => {
        if (title && a.session) {
          a.session.title = title;
          saveSession(a.session).catch(() => {});
        }
      }).catch(() => {});
    }

    const { provider: p } = resolveProvider(currentModel);
    await showSuggestions(a.getMessages(), p, currentModel);
    await saveSession(a.session);
  }

  async function getAgent() {
    if (agent) return agent;

    const { provider, model: resolvedModel } = resolveProvider(currentModel);
    currentModel = resolvedModel;

    const config = loadConfig();

    agent = await createAgent({
      provider,
      model: currentModel,
      cwd,
      thinking,
      session: activeSession || undefined,
      mcpServers: config.mcpServers,
      onStream: (event: StreamEvent) => {
        if (quietStreamOutput && event.type !== 'error') {
          return;
        }

        switch (event.type) {
          case 'text': {
            spinner.stop();
            clearToolActivity();
            beginResponse();
            renderAssistantChunk(event.text || '');
            break;
          }
          case 'thinking':
            spinner.stop();
            clearToolActivity();
            beginResponse();
            renderAssistantChunk(chalk.hex(getTheme().dim)(event.text || ''));
            break;
          case 'error':
            spinner.stop();
            clearToolActivity();
            beginResponse();
            renderError(event.error || 'Unknown error');
            break;
        }
      },
      onToolStart: (name, toolInput) => {
        spinner.stop();
        if (quietStreamOutput) return;
        beginResponse();
        if (!assistantLineStart) {
          renderText('\n');
        }
        assistantLineStart = true;
        assistantCol = 0;
        renderToolStart(name, summarizeToolInput(name, toolInput));
      },
      onToolEnd: (name, result) => {
        totalToolCalls++;
        if (quietStreamOutput) return;
        renderToolEnd(name, result);
        assistantLineStart = true;
        assistantCol = 0;
        // Restart spinner with impulse for visual continuity
        spinner.start('thinking');
        spinner.impulse();
      },
    });
    activeSession = agent.session;

    const mcpToolCount = agent.mcpTools?.length || 0;
    if (mcpToolCount > 0) {
      renderDim(`  ${mcpToolCount} MCP tool(s) connected`);
    }

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
    const theme = getTheme();
    renderLine(`  ${chalk.hex(theme.accent)(sym.arrow)} ${chalk.hex(theme.text).bold(currentModel)}`);
  }

  async function resumeSession(selection?: string): Promise<void> {
    const currentSessionId = agent?.session.id || activeSession?.id;
    let sessionId = selection?.trim() || '';

    if (!sessionId) {
      const sessions = await showSessionSelector(currentSessionId);
      if (sessions.length === 0) return;

      const selected = await input.getLine('  Select session number or id › ');
      if (!selected.trim()) {
        renderDim('  cancelled');
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

    renderLine(`  ${chalk.hex(getTheme().accent)(sym.session)} ${chalk.hex(getTheme().dim)('resumed')}  ${chalk.hex(getTheme().muted)(`${loaded.entries.length} messages`)}`);
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

  // Start the breathing gradient animation
  const { startGradientBreathing, stopGradientBreathing } = await import('@blush/tui');
  startGradientBreathing(process.stdout.columns || 80);

  if (existingSession) {
    renderResumePreview(getActiveMessages(existingSession));
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

      if (line.startsWith('/model fav ') || line.startsWith('/model unfav ')) {
        return matchingCompletions(
          line,
          listSelectableModels().map((model) => `${line.startsWith('/model unfav') ? '/model unfav' : '/model fav'} ${model.name}`),
        );
      }

      if (line.startsWith('/model ')) {
        return matchingCompletions(
          line,
          [
            '/model fav',
            '/model unfav',
            ...listSelectableModels().map((model) => `/model ${model.name}`),
          ],
        );
      }

      if (line.startsWith('/resume ')) {
        const sessions = await listSessionSummaries(cwd);
        return matchingCompletions(
          line,
          sessions.map((session) => `/resume ${session.id}`),
        );
      }

      if (line === '/branch' || line.startsWith('/branch ')) {
        const completions: string[] = BRANCH_SUBCOMMANDS.map((sub) => `/branch ${sub}`);
        // Also add branch IDs if a session is active
        if (activeSession) {
          const branches = listBranches(activeSession);
          for (const branch of branches) {
            const shortId = branch.id.length > 8 ? branch.id.slice(0, 8) : branch.id;
            completions.push(`/branch ${shortId}`);
          }
        }
        return matchingCompletions(line, completions);
      }

      if (line === '/sessions' || line.startsWith('/sessions ')) {
        const completions: string[] = SESSIONS_SUBCOMMANDS.map((sub) => `/sessions ${sub}`);
        // Also add session IDs for /sessions delete <id>
        if (line.startsWith('/sessions delete ')) {
          const sessions = await listSessionSummaries(cwd);
          for (const session of sessions) {
            completions.push(`/sessions delete ${session.id}`);
          }
        }
        return matchingCompletions(line, completions);
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

  function getSessionStats() {
    const total = agent?.usage.total;
    return {
      duration: Date.now() - sessionStartTime,
      messages: activeSession?.entries.length || 0,
      toolCalls: totalToolCalls,
      tokens: total ? total.inputTokens + total.outputTokens : 0,
    };
  }

  // Clean up spinner on any exit path
  process.on('exit', () => { spinner.stop(); stopGradientBreathing(); if (loopTimer) clearInterval(loopTimer); });
  process.on('uncaughtException', (err) => {
    spinner.stop();
    renderError(err.message);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    spinner.stop();
    renderError(err instanceof Error ? err.message : String(err));
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    spinner.stop();
    renderText('\n');
    if (agent) {
      await saveSession(agent.session);
      renderGoodbye(agent.session.id, getSessionStats());
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

      case 'effort': {
        const theme = getTheme();
        if (args === 'on' || args === 'high') {
          thinking = true;
        } else if (args === 'off' || args === 'low') {
          thinking = false;
        } else {
          thinking = !thinking;
        }
        // Recreate agent on next send to pick up new thinking state
        if (agent) {
          activeSession = agent.session;
          await saveSession(agent.session);
          agent = null;
        }
        const label = thinking ? 'extended thinking on' : 'extended thinking off';
        const color = thinking ? theme.accent : theme.dim;
        renderLine(`  ${chalk.hex(theme.accent)(sym.arrow)} ${chalk.hex(color)(label)}`);
        return true;
      }

      case 'mcp': {
        const a = await getAgent();
        const connections: MCPConnection[] = a.mcpConnections || [];
        if (connections.length === 0) {
          renderDim('  No MCP servers connected');
          renderDim('  Add servers to ~/.blush/config.json under "mcpServers"');
          return true;
        }
        const theme = getTheme();
        renderLine('');
        renderLine(`  ${chalk.hex(theme.text).bold('MCP SERVERS')}`);
        renderLine('');
        for (const conn of connections) {
          const toolCount = conn.tools.length;
          renderLine(`  ${chalk.hex(theme.success)(sym.toolDone)} ${chalk.hex(theme.text).bold(conn.name)}  ${chalk.hex(theme.muted)(`${toolCount} tool${toolCount === 1 ? '' : 's'}`)}`);
          for (const tool of conn.tools) {
            renderLine(`    ${chalk.hex(theme.dim)(tool.name)}`);
          }
          renderLine('');
        }
        return true;
      }

      case 'skills':
        showSkills(skills);
        return true;

      case 'theme': {
        if (!args) {
          const { themes } = await import('@blush/tui');
          const current = getTheme();
          renderLine('');
          renderLine(`  ${chalk.hex(current.text).bold('THEMES')}`);
          renderLine('');
          for (const [themeName, t] of Object.entries(themes)) {
            const isCurrent = themeName === current.name;
            const swatch = [t.prompt, t.accent, t.text, t.success].map(
              (c) => chalk.hex(c)('\u2588'),
            ).join('');
            const marker = isCurrent
              ? chalk.hex(t.prompt).bold(sym.prompt)
              : ' ';
            const label = isCurrent
              ? chalk.hex(t.prompt).bold(t.label)
              : chalk.hex(current.dim)(t.label);
            const tag = isCurrent ? chalk.hex(t.prompt)(' current') : '';
            renderLine(`  ${marker} ${swatch}  ${label}${tag}`);
          }
          renderLine('');
          return true;
        }
        if (setTheme(args.trim())) {
          const t = getTheme();
          await updateConfig({ default_theme: t.name });
          renderLine(`\n  ${chalk.hex(t.prompt)(sym.toolDone)} Theme: ${chalk.hex(t.prompt)(t.label)}`);
          await renderThemeSwatch();
          renderLine('');
        } else {
          renderError(`Unknown theme: ${args}. Available: ${listThemes().join(', ')}`);
        }
        return true;
      }

      case 'model': {
        const modelArgs = args.trim();

        // /model fav <name> — add to favorites
        if (modelArgs.startsWith('fav ')) {
          const name = modelArgs.slice(4).trim();
          if (!name) {
            renderError('Usage: /model fav <model-name>');
            return true;
          }
          const added = await addFavorite(name);
          if (added) {
            renderLine(`  ${chalk.hex(theme.success)(sym.toolDone)} ${chalk.hex(theme.text)(name)} added to favorites`);
          } else {
            renderDim(`  ${name} is already a favorite`);
          }
          return true;
        }

        // /model unfav <name> — remove from favorites
        if (modelArgs.startsWith('unfav ')) {
          const name = modelArgs.slice(6).trim();
          if (!name) {
            renderError('Usage: /model unfav <model-name>');
            return true;
          }
          const removed = await removeFavorite(name);
          if (removed) {
            renderLine(`  ${chalk.hex(theme.success)(sym.toolDone)} ${chalk.hex(theme.text)(name)} removed from favorites`);
          } else {
            renderDim(`  ${name} is not a favorite`);
          }
          return true;
        }

        // /model — interactive selector
        if (!modelArgs) {
          showModelSelector(currentModel);
          const selected = await input.getLine('  Select model number or name › ');
          if (!selected.trim()) {
            renderDim('  cancelled');
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

        // /model <name|number> — direct switch
        try {
          await switchModel(resolveModelSelection(modelArgs) || modelArgs);
        } catch {
          renderError(`Unknown model: ${modelArgs}`);
        }
        return true;
      }

      case 'sessions': {
        const currentSessionId = agent?.session.id || activeSession?.id;

        // /sessions delete <id|number>
        if (args.startsWith('delete')) {
          const deleteArg = args.slice('delete'.length).trim();
          const sessions = await listSessionSummaries(cwd);
          if (sessions.length === 0) {
            renderDim('  No sessions to delete.');
            return true;
          }

          let targetSession: SessionSummary | undefined;
          if (deleteArg) {
            if (/^\d+$/.test(deleteArg)) {
              targetSession = sessions[Number(deleteArg) - 1];
            } else {
              targetSession = sessions.find((s) => s.id === deleteArg);
            }
          } else {
            renderSessionBrowser(sessions, currentSessionId);
            const selected = await input.getLine('  Delete session number or id › ');
            if (!selected.trim()) {
              renderDim('  cancelled');
              return true;
            }
            if (/^\d+$/.test(selected.trim())) {
              targetSession = sessions[Number(selected.trim()) - 1];
            } else {
              targetSession = sessions.find((s) => s.id === selected.trim());
            }
          }

          if (!targetSession) {
            renderError('Session not found');
            return true;
          }

          if (targetSession.id === currentSessionId) {
            renderError('Cannot delete the current session');
            return true;
          }

          const confirmPrompt = `  Delete "${truncateMiddle(targetSession.title, 40)}"? [y/N] `;
          const confirm = await input.getLine(confirmPrompt);
          if (confirm.trim().toLowerCase() !== 'y') {
            renderDim('  cancelled');
            return true;
          }

          const deleted = await deleteSession(cwd, targetSession.id);
          if (deleted) {
            renderLine(`  ${chalk.hex(theme.success)(sym.toolDone)} ${chalk.hex(theme.muted)('deleted')}  ${chalk.hex(theme.dim)(targetSession.title)}`);
          } else {
            renderError('Failed to delete session');
          }
          return true;
        }

        // /sessions (no args) -- full browser with selection
        const sessions = await showSessionSelector(currentSessionId);
        if (sessions.length === 0) return true;

        const selected = await input.getLine('  Select session number or id › ');
        if (!selected.trim()) {
          renderDim('  cancelled');
          return true;
        }

        let sessionId: string | undefined;
        if (/^\d+$/.test(selected.trim())) {
          sessionId = sessions[Number(selected.trim()) - 1]?.id;
        } else {
          sessionId = selected.trim();
        }

        if (!sessionId) {
          renderError('Unknown session selection');
          return true;
        }

        if (sessionId === currentSessionId) {
          renderDim(`  Already on session: ${sessionId}`);
          return true;
        }

        // Resume the selected session (reuse resumeSession logic)
        await resumeSession(sessionId);
        return true;
      }

      case 'new': {
        if (agent) {
          activeSession = agent.session;
          await saveSession(agent.session);
        }

        existingSession = undefined;
        activeSession = undefined;
        agent = null;
        titleGenerated = false;

        if (isLayoutActive()) {
          resetLayout();
          renderLayout();
        }

        renderLine(`  ${chalk.hex(getTheme().accent)(sym.session)} ${chalk.hex(getTheme().dim)('new session')}`);
        return true;
      }

      case 'resume': {
        await resumeSession(args);
        return true;
      }

      case 'loop': {
        const theme = getTheme();

        // /loop stop
        if (args.trim() === 'stop') {
          if (loopTimer) {
            clearInterval(loopTimer);
            loopTimer = null;
            renderLine(`  ${chalk.hex(theme.success)(sym.toolDone)} ${chalk.hex(theme.dim)(`loop stopped after ${loopCount} runs`)}`);
            loopCount = 0;
          } else {
            renderDim('  no active loop');
          }
          return true;
        }

        // /loop (status)
        if (!args.trim()) {
          if (loopTimer) {
            const intervalLabel = loopIntervalMs >= 60000
              ? `${Math.round(loopIntervalMs / 60000)}m`
              : `${Math.round(loopIntervalMs / 1000)}s`;
            renderLine(`  ${chalk.hex(theme.accent)(sym.toolRun)} ${chalk.hex(theme.text)('loop active')}  ${chalk.hex(theme.dim)(`every ${intervalLabel}`)}  ${chalk.hex(theme.muted)(`${loopCount} runs`)}`);
            renderLine(`  ${chalk.hex(theme.muted)('command:')} ${chalk.hex(theme.dim)(loopCommand)}`);
          } else {
            renderDim('  no active loop. Usage: /loop <interval> <prompt or /command>');
          }
          return true;
        }

        // /loop <interval> <command> -- start a new loop
        // Kill existing loop first
        if (loopTimer) {
          clearInterval(loopTimer);
          loopTimer = null;
          loopCount = 0;
        }

        // Parse interval: 30s, 5m, 1h
        const intervalMatch = args.match(/^(\d+)(s|m|h)\s+(.+)$/);
        if (!intervalMatch) {
          renderError('Usage: /loop <interval> <prompt or /command>\n  Examples: /loop 5m run tests, /loop 30s /compact');
          return true;
        }

        const [, numStr, unit, cmd] = intervalMatch;
        const num = parseInt(numStr, 10);
        const multiplier = unit === 'h' ? 3600000 : unit === 'm' ? 60000 : 1000;
        loopIntervalMs = num * multiplier;
        loopCommand = cmd.trim();
        loopCount = 0;

        if (loopIntervalMs < 5000) {
          renderError('Minimum interval is 5s');
          return true;
        }

        const intervalLabel = loopIntervalMs >= 60000
          ? `${Math.round(loopIntervalMs / 60000)}m`
          : `${Math.round(loopIntervalMs / 1000)}s`;

        renderLine(`  ${chalk.hex(theme.accent)(sym.toolRun)} ${chalk.hex(theme.text)('loop started')}  ${chalk.hex(theme.dim)(`every ${intervalLabel}`)}  ${chalk.hex(theme.muted)(loopCommand)}`);

        loopTimer = setInterval(async () => {
          loopCount++;
          const theme2 = getTheme();
          renderLine(`\n  ${chalk.hex(theme2.muted)(`${sym.thinRule.repeat(3)} loop #${loopCount} ${sym.thinRule.repeat(20)}`)}`);

          if (loopCommand.startsWith('/')) {
            // Execute as slash command
            const { name: cmdName, args: cmdArgs } = parseCommand(loopCommand);
            await handleCommand(cmdName, cmdArgs);
          } else {
            // Execute as agent prompt
            try {
              const a = await getAgent();
              isProcessing = true;
              input.setQueueMode((queuedLine) => {
                messageQueue.push(queuedLine);
                renderDim(`  queued (${messageQueue.length} pending)`);
              });
              await sendTurnWithStatus(a, loopCommand);
              while (messageQueue.length > 0) {
                const queued = messageQueue.shift()!;
                await sendTurnWithStatus(a, queued);
              }
              input.setQueueMode(null);
              isProcessing = false;
            } catch (err) {
              input.setQueueMode(null);
              isProcessing = false;
              renderError((err as Error).message);
            }
          }
        }, loopIntervalMs);

        return true;
      }

      case 'help':
        printHelp();
        return true;

      case 'exit':
      case 'quit':
        if (agent) {
          await saveSession(agent.session);
          renderGoodbye(agent.session.id, getSessionStats());
        } else {
          renderGoodbye();
        }
        input.close();
        stopGradientBreathing();
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

        // /branch fork -- create a new branch at the current point
        if (args.trim() === 'fork') {
          renderLine(`  ${chalk.hex(getTheme().accent)(sym.branch)} ${chalk.hex(getTheme().dim)('forked')}  ${chalk.hex(getTheme().muted)(a.session.currentBranch)}`);
          return true;
        }

        // /branch (no args) -- show branch picker
        const branches = listBranches(a.session);

        if (branches.length <= 1) {
          renderDim('  no branches yet -- fork with /branch fork');
          return true;
        }

        renderLine('');
        renderLine(`  ${chalk.hex(theme.text).bold('BRANCHES')}`);
        renderLine('');

        for (const [index, branch] of branches.entries()) {
          const shortId = branch.id.length > 8 ? branch.id.slice(0, 8) : branch.id;
          const marker = branch.isCurrent
            ? chalk.hex(theme.prompt).bold(sym.prompt)
            : chalk.hex(theme.muted)(String(index + 1).padStart(2, ' '));
          const label = branch.isCurrent
            ? chalk.hex(theme.prompt).bold(shortId)
            : chalk.hex(theme.text).bold(shortId);
          const count = chalk.hex(theme.muted)(`(${branch.messageCount} messages)`);
          const preview = branch.lastMessage
            ? chalk.hex(theme.dim)(`"${truncateMiddle(branch.lastMessage, 48)}"`)
            : '';
          const tag = branch.isCurrent ? chalk.hex(theme.prompt)(' current') : '';
          renderLine(`  ${marker} ${label}  ${count}  ${preview}${tag}`);
        }
        renderLine('');

        const selected = await input.getLine('  Select branch number or id › ');
        if (!selected.trim()) {
          renderDim('  cancelled');
          return true;
        }

        let targetBranchId: string | undefined;
        const trimmedSelection = selected.trim();

        if (/^\d+$/.test(trimmedSelection)) {
          const idx = Number(trimmedSelection) - 1;
          targetBranchId = branches[idx]?.id;
        } else {
          // Match by full ID or prefix
          targetBranchId = branches.find(
            (b) => b.id === trimmedSelection || b.id.startsWith(trimmedSelection),
          )?.id;
        }

        if (!targetBranchId) {
          renderError(`Unknown branch: ${trimmedSelection}`);
          return true;
        }

        const targetBranch = branches.find((b) => b.id === targetBranchId);
        if (targetBranch?.isCurrent) {
          renderDim('  already on this branch');
          return true;
        }

        switchBranch(a.session, targetBranchId);
        const shortTarget = targetBranchId.length > 8 ? targetBranchId.slice(0, 8) : targetBranchId;
        renderLine(`  ${chalk.hex(theme.accent)(sym.branch)} ${chalk.hex(theme.dim)('switched')}  ${chalk.hex(theme.text).bold(shortTarget)}`);
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
        renderLine(`  ${chalk.hex(getTheme().success)(sym.toolDone)} ${chalk.hex(getTheme().muted)('saved')}`);
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
            renderLine(`  ${chalk.hex(getTheme().accent)(sym.sparkle)} ${chalk.hex(getTheme().text).bold(skill.name)}`);
            const a = await getAgent();
            const prompt = args ? `${content}\n\nUser request: ${args}` : content;
            await sendAndRender(a, prompt);
          } else {
            renderDim(`  ${skill.name} already active`);
            if (args) {
              const a = await getAgent();
              await sendAndRender(a, args);
            }
          }
          return true;
        }

        // Easter eggs
        if (name === 'coffee') {
          const t = getTheme();
          renderLine('');
          renderLine(`  ${chalk.hex(t.accent)('\u2615')} ${chalk.hex(t.dim)('brewing...')}`);
          await new Promise((r) => setTimeout(r, 800));
          renderLine(`  ${chalk.hex(t.text).bold('here you go.')}`);
          renderLine('');
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

      // Send to agent (with follow-up queue support)
      try {
        const a = await getAgent();

        // Enable queue mode: user can type while agent processes
        isProcessing = true;
        input.setQueueMode((queuedLine) => {
          messageQueue.push(queuedLine);
          renderDim(`  queued (${messageQueue.length} pending)`);
        });

        await sendTurnWithStatus(a, trimmed);

        // Drain queued follow-ups
        while (messageQueue.length > 0) {
          const queued = messageQueue.shift()!;
          await sendTurnWithStatus(a, queued);
        }

        // Disable queue mode
        input.setQueueMode(null);
        isProcessing = false;
      } catch (err) {
        input.setQueueMode(null);
        isProcessing = false;
        renderError((err as Error).message);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') break;
      renderError((err as Error).message);
    }
  }
}
