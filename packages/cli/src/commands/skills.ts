import chalk from 'chalk';
import { SkillRegistry } from '@blushagent/core';
import { renderLine } from '@blushagent/tui';

export function showSkills(registry: SkillRegistry): void {
  const skills = registry.list();

  if (skills.length === 0) {
    renderLine(chalk.dim('No skills installed. Add .md files to ~/.blush/skills/ or .blush/skills/'));
    return;
  }

  renderLine(chalk.bold('\nSkills'));

  for (const skill of skills) {
    const active = registry.isActive(skill.name) ? chalk.green(' (active)') : '';
    const trigger = chalk.cyan(skill.trigger);
    const desc = skill.description ? chalk.dim(` -- ${skill.description}`) : '';
    renderLine(`  ${trigger} ${chalk.white(skill.name)}${active}${desc}`);
  }

  renderLine('');
}
