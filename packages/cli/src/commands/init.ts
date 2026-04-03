import chalk from 'chalk';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { DEFAULT_ANTHROPIC_MODEL } from '@blushagent/ai';
import { renderLine } from '@blushagent/tui';

const BLUSH_DIR = join(homedir(), '.blush');

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function init(): Promise<void> {
  renderLine(chalk.bold('\nBlush Setup\n'));

  const dirs = [
    BLUSH_DIR,
    join(BLUSH_DIR, 'extensions'),
    join(BLUSH_DIR, 'packages'),
    join(BLUSH_DIR, 'skills'),
    join(BLUSH_DIR, 'sessions'),
  ];

  // Create directories
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
      renderLine(chalk.green(`  Created ${dir.replace(homedir(), '~')}`));
    } else {
      renderLine(chalk.dim(`  Exists  ${dir.replace(homedir(), '~')}`));
    }
  }

  // Config file
  const configPath = join(BLUSH_DIR, 'config.json');
  if (!existsSync(configPath)) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    renderLine('');
    const apiKey = await ask(rl, chalk.white('  Anthropic API key (or Enter to skip): '));

    const config: Record<string, string> = {};
    if (apiKey.trim()) {
      config.anthropic_api_key = apiKey.trim();
    }

    const openaiKey = await ask(rl, chalk.white('  OpenAI API key (or Enter to skip): '));
    if (openaiKey.trim()) {
      config.openai_api_key = openaiKey.trim();
    }

    const defaultModel = await ask(rl, chalk.white(`  Default model (Enter for ${DEFAULT_ANTHROPIC_MODEL}): `));
    if (defaultModel.trim()) {
      config.default_model = defaultModel.trim();
    }

    rl.close();

    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    renderLine(chalk.green(`\n  Created ${configPath.replace(homedir(), '~')}`));
  } else {
    renderLine(chalk.dim(`  Exists  ${configPath.replace(homedir(), '~')}`));
  }

  // Global AGENTS.md
  const agentsPath = join(BLUSH_DIR, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    await writeFile(agentsPath, `# Global Blush Instructions

# Add instructions here that apply to all projects.
# These are loaded into every Blush session's system prompt.
`);
    renderLine(chalk.green(`  Created ${agentsPath.replace(homedir(), '~')}`));
  }

  renderLine(chalk.bold.green('\n  Blush is ready.\n'));
  renderLine(chalk.dim('  Run `blush` to start a session.'));
  renderLine(chalk.dim('  Run `blush --help` for all options.'));
  renderLine(chalk.dim('  Built-in skills load automatically. Add overrides to ~/.blush/skills/'));
  renderLine(chalk.dim('  Add extensions to ~/.blush/extensions/\n'));
  renderLine(chalk.dim('  Install community packages with `blush install <source>`.\n'));
}
