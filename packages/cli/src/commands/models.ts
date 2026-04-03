import chalk from 'chalk';
import { getTheme, renderLine, sym } from '@blushagent/tui';
import { loadConfig, updateConfig } from '@blushagent/ai';

export interface SelectableModel {
  name: string;
  provider: string;
}

const selectableModels: SelectableModel[] = [
  { name: 'gpt-5.4', provider: 'Codex' },
  { name: 'gpt-5.4-mini', provider: 'Codex' },
  { name: 'claude-sonnet-4-6-20250610', provider: 'Anthropic' },
  { name: 'claude-sonnet-4-20250514', provider: 'Anthropic' },
  { name: 'claude-opus-4-6', provider: 'Anthropic' },
  { name: 'claude-haiku-4-5-20251001', provider: 'Anthropic' },
  { name: 'gpt-4o', provider: 'OpenAI' },
  { name: 'gpt-4o-mini', provider: 'OpenAI' },
  { name: 'o3-mini', provider: 'OpenAI' },
  { name: 'o1', provider: 'OpenAI' },
  { name: 'o1-mini', provider: 'OpenAI' },
  { name: 'gpt-5.3-codex', provider: 'Codex' },
  { name: 'gpt-5.2-codex', provider: 'Codex' },
  { name: 'gpt-5.2', provider: 'Codex' },
  { name: 'gpt-5.1-codex', provider: 'Codex' },
  { name: 'gpt-5.1', provider: 'Codex' },
  { name: 'gpt-5-codex', provider: 'Codex' },
  { name: 'gpt-5', provider: 'Codex' },
  { name: 'ollama:qwen3.5:9b', provider: 'Ollama' },
  { name: 'ollama:rnj-1', provider: 'Ollama' },
];

function getFavorites(): string[] {
  return loadConfig().favorite_models || [];
}

export function listSelectableModels(): SelectableModel[] {
  return selectableModels;
}

/** Get the ordered display list: favorites first, then the rest grouped by provider. */
function getOrderedModels(favorites: string[]): SelectableModel[] {
  if (favorites.length === 0) return selectableModels;

  const favSet = new Set(favorites);
  const favModels: SelectableModel[] = [];
  for (const name of favorites) {
    const model = selectableModels.find((m) => m.name === name);
    if (model) favModels.push(model);
  }
  const rest = selectableModels.filter((m) => !favSet.has(m.name));
  return [...favModels, ...rest];
}

export function resolveModelSelection(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const favorites = getFavorites();
  const ordered = getOrderedModels(favorites);

  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed) - 1;
    return ordered[index]?.name || null;
  }

  const exact = selectableModels.find((model) => model.name === trimmed);
  if (exact) return exact.name;

  const caseInsensitive = selectableModels.find((model) => model.name.toLowerCase() === trimmed.toLowerCase());
  return caseInsensitive?.name || null;
}

export function showModelSelector(currentModel: string): void {
  const theme = getTheme();
  const favorites = getFavorites();
  const favSet = new Set(favorites);

  renderLine('');

  // Favorites section
  if (favorites.length > 0) {
    renderLine(`  ${chalk.hex(theme.accent).bold('FAVORITES')}`);
    renderLine('');
    let index = 0;
    for (const name of favorites) {
      const model = selectableModels.find((m) => m.name === name);
      if (!model) continue;
      const isCurrent = model.name === currentModel;
      const marker = isCurrent
        ? chalk.hex(theme.prompt).bold(sym.prompt)
        : chalk.hex(theme.muted)(String(index + 1).padStart(2, ' '));
      const modelLabel = isCurrent
        ? chalk.hex(theme.prompt).bold(model.name)
        : chalk.hex(theme.text)(model.name);
      const providerTag = chalk.hex(theme.dim)(` ${model.provider}`);
      const currentTag = isCurrent ? chalk.hex(theme.prompt)(' current') : '';
      renderLine(`  ${marker} ${modelLabel}${providerTag}${currentTag}`);
      index++;
    }
    renderLine('');
  }

  // All models grouped by provider (skip favorites)
  renderLine(`  ${chalk.hex(theme.text).bold('ALL MODELS')}`);
  renderLine('');

  const offset = favorites.length;
  let displayIndex = offset;
  let previousProvider = '';

  for (const model of selectableModels) {
    if (favSet.has(model.name)) continue;

    if (model.provider !== previousProvider) {
      if (previousProvider) renderLine('');
      renderLine(`  ${chalk.hex(theme.accent).bold(model.provider)}`);
      previousProvider = model.provider;
    }

    const isCurrent = model.name === currentModel;
    const marker = isCurrent
      ? chalk.hex(theme.prompt).bold(sym.prompt)
      : chalk.hex(theme.muted)(String(displayIndex + 1).padStart(2, ' '));
    const modelLabel = isCurrent
      ? chalk.hex(theme.prompt).bold(model.name)
      : chalk.hex(theme.text)(model.name);
    const tag = isCurrent ? chalk.hex(theme.prompt)(' current') : '';
    renderLine(`  ${marker} ${modelLabel}${tag}`);
    displayIndex++;
  }

  renderLine('');
  renderLine(`  ${chalk.hex(theme.muted)('or type any model string directly')}`);
  renderLine('');
}

export async function addFavorite(model: string): Promise<boolean> {
  const favorites = getFavorites();
  if (favorites.includes(model)) return false;
  await updateConfig({ favorite_models: [...favorites, model] });
  return true;
}

export async function removeFavorite(model: string): Promise<boolean> {
  const favorites = getFavorites();
  if (!favorites.includes(model)) return false;
  await updateConfig({ favorite_models: favorites.filter((m) => m !== model) });
  return true;
}
