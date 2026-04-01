import chalk from 'chalk';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { renderLine } from '@ap/tui';

const AP_DIR = join(homedir(), '.ap');

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function init(): Promise<void> {
  renderLine(chalk.bold('\nAP Setup\n'));

  const dirs = [
    AP_DIR,
    join(AP_DIR, 'extensions'),
    join(AP_DIR, 'skills'),
    join(AP_DIR, 'sessions'),
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
  const configPath = join(AP_DIR, 'config.json');
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

    const defaultModel = await ask(rl, chalk.white('  Default model (Enter for claude-sonnet-4-20250514): '));
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
  const agentsPath = join(AP_DIR, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    await writeFile(agentsPath, `# Global AP Instructions

# Add instructions here that apply to all projects.
# These are loaded into every AP session's system prompt.
`);
    renderLine(chalk.green(`  Created ${agentsPath.replace(homedir(), '~')}`));
  }

  renderLine(chalk.bold.green('\n  AP is ready.\n'));
  renderLine(chalk.dim('  Run `ap` to start a session.'));
  renderLine(chalk.dim('  Run `ap --help` for all options.'));
  renderLine(chalk.dim('  Add skills to ~/.ap/skills/'));
  renderLine(chalk.dim('  Add extensions to ~/.ap/extensions/\n'));
}
