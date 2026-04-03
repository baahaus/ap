import chalk from 'chalk';
import type { Provider } from '@blushagent/ai';
import {
  createTeamSession,
  spawnPeer,
  messagePeer,
  synthesize,
  reviewPeer,
  runPipeline,
  mergePeer,
  getTeamStatus,
  listTasks,
  type TeamSession,
  type PipelineStage,
} from '@blushagent/team';
import { renderLine, renderError } from '@blushagent/tui';

let activeTeam: TeamSession | null = null;

function ensureTeam(repoPath: string, provider: Provider, model: string): TeamSession {
  if (!activeTeam) {
    activeTeam = createTeamSession(repoPath, provider, model);
    renderLine(chalk.dim(`Team session created: ${activeTeam.id}`));
  }
  return activeTeam;
}

export async function handleTeamCommand(
  args: string,
  repoPath: string,
  provider: Provider,
  model: string,
): Promise<void> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0];
  const rest = parts.slice(1).join(' ');

  switch (subcommand) {
    case 'spawn': {
      const nameParts = rest.split(/\s+/);
      const name = nameParts[0];
      if (!name) {
        renderError('Usage: /team spawn <name> [--prompt "initial task"]');
        return;
      }

      const promptIdx = rest.indexOf('--prompt');
      const prompt = promptIdx !== -1 ? rest.slice(promptIdx + 9).trim().replace(/^["']|["']$/g, '') : undefined;

      const team = ensureTeam(repoPath, provider, model);

      try {
        renderLine(chalk.dim(`Spawning agent "${name}"...`));
        const peer = await spawnPeer(team, name, prompt);
        renderLine(chalk.green(`Agent "${name}" spawned on branch: ${peer.worktree.branch}`));
        if (prompt) {
          renderLine(chalk.dim(`Initial prompt sent: ${prompt.slice(0, 60)}${prompt.length > 60 ? '...' : ''}`));
        }
      } catch (err) {
        renderError((err as Error).message);
      }
      break;
    }

    case 'msg':
    case 'message': {
      const msgParts = rest.split(/\s+/);
      const target = msgParts[0];
      const message = msgParts.slice(1).join(' ');

      if (!target || !message) {
        renderError('Usage: /team msg <agent-name> <message>');
        return;
      }

      const team = ensureTeam(repoPath, provider, model);

      try {
        await messagePeer(team, 'user', target, message);
        renderLine(chalk.dim(`Message sent to ${target}`));
      } catch (err) {
        renderError((err as Error).message);
      }
      break;
    }

    case 'status': {
      if (!activeTeam) {
        renderLine(chalk.dim('No active team session. Use /team spawn to create agents.'));
        return;
      }

      const status = getTeamStatus(activeTeam);

      if (status.agents.length === 0) {
        renderLine(chalk.dim('No agents in team.'));
        return;
      }

      renderLine(chalk.bold('\nTeam Status'));
      renderLine(chalk.dim(`Session: ${activeTeam.id}\n`));

      for (const agent of status.agents) {
        const statusColor = agent.status === 'working' ? chalk.yellow
          : agent.status === 'done' ? chalk.green
          : chalk.white;
        renderLine(`  ${chalk.bold(agent.name)} ${statusColor(agent.status)} ${chalk.dim(agent.branch)}`);
      }

      // Show tasks if any
      const tasks = await listTasks(activeTeam.id);
      if (tasks.length > 0) {
        renderLine(chalk.bold('\nTasks'));
        for (const task of tasks) {
          const statusIcon = task.status === 'done' ? chalk.green('\u2713')
            : task.status === 'in_progress' ? chalk.yellow('\u25CB')
            : task.status === 'blocked' ? chalk.red('\u2717')
            : chalk.dim('\u25CB');
          const assignee = task.assignedTo ? chalk.dim(` [${task.assignedTo}]`) : '';
          renderLine(`  ${statusIcon} ${task.title}${assignee}`);
        }
      }

      renderLine('');
      break;
    }

    case 'synthesize':
    case 'sync': {
      if (!activeTeam) {
        renderError('No active team session.');
        return;
      }

      renderLine(chalk.dim('Synthesizing outputs from all agents...'));
      try {
        const result = await synthesize(activeTeam, provider, model);
        renderLine(chalk.bold('\nSynthesis:\n'));
        renderLine(result);
      } catch (err) {
        renderError((err as Error).message);
      }
      break;
    }

    case 'merge': {
      const name = rest.trim();
      if (!name) {
        renderError('Usage: /team merge <agent-name>');
        return;
      }

      if (!activeTeam) {
        renderError('No active team session.');
        return;
      }

      renderLine(chalk.dim(`Merging ${name}'s worktree...`));
      const result = await mergePeer(activeTeam, name);

      if (result.success) {
        renderLine(chalk.green(`Successfully merged ${name}'s changes.`));
      } else {
        renderError(`Merge failed: ${result.output}`);
      }
      break;
    }

    case 'review': {
      const reviewParts = rest.trim().split(/\s+/);
      const target = reviewParts[0];
      const reviewer = reviewParts[1];

      if (!target || !reviewer) {
        renderError('Usage: /team review <target-agent> <reviewer-agent> [--criteria "..."]');
        return;
      }

      if (!activeTeam) {
        renderError('No active team session.');
        return;
      }

      const criteriaIdx = rest.indexOf('--criteria');
      const criteria = criteriaIdx !== -1 ? rest.slice(criteriaIdx + 11).trim().replace(/^["']|["']$/g, '') : undefined;

      renderLine(chalk.dim(`${reviewer} reviewing ${target}'s output...`));
      try {
        const result = await reviewPeer(activeTeam, reviewer, target, provider, model, criteria);
        if (result.approved) {
          renderLine(chalk.green(`\nApproved by ${reviewer}`));
        } else {
          renderLine(chalk.yellow(`\nChanges requested by ${reviewer}`));
        }
        renderLine(chalk.dim('\nFeedback:\n'));
        renderLine(result.feedback);
      } catch (err) {
        renderError((err as Error).message);
      }
      break;
    }

    case 'pipeline': {
      if (!activeTeam) {
        renderError('No active team session.');
        return;
      }

      // Parse: /team pipeline agent1:"prompt1" agent2:"prompt2" ...
      const stageRegex = /(\w+):"([^"]+)"/g;
      const stages: PipelineStage[] = [];
      let match;
      while ((match = stageRegex.exec(rest)) !== null) {
        stages.push({ name: match[1], prompt: match[2] });
      }

      if (stages.length === 0) {
        renderError('Usage: /team pipeline agent1:"task 1" agent2:"task 2" ...');
        return;
      }

      renderLine(chalk.dim(`Running pipeline: ${stages.map((s) => s.name).join(' \u2192 ')}...`));
      try {
        const result = await runPipeline(activeTeam, stages);
        for (const stage of result.stages) {
          renderLine(chalk.bold(`\n${stage.name}:`));
          renderLine(stage.output.slice(0, 500) + (stage.output.length > 500 ? '...' : ''));
        }
        renderLine(chalk.bold.green('\nPipeline complete.'));
      } catch (err) {
        renderError((err as Error).message);
      }
      break;
    }

    case 'help':
    default: {
      renderLine(`
${chalk.bold('Team Commands')}

  /team spawn <name> [--prompt "task"]              Create a new peer agent
  /team msg <name> <message>                        Send message to an agent
  /team status                                      Show all agents and tasks
  /team synthesize                                  Combine all agent outputs
  /team review <target> <reviewer> [--criteria ""]  Have one agent review another
  /team pipeline agent1:"task" agent2:"task" ...    Sequential handoff pipeline
  /team merge <name>                                Merge agent's changes back
  /team help                                        Show this help
      `);
      break;
    }
  }
}
