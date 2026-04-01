import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const TEAM_DIR = join(homedir(), '.ap', 'team');

export type TaskStatus = 'pending' | 'claimed' | 'in_progress' | 'done' | 'blocked';

export interface TeamTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  createdBy: string;
  assignedTo: string | null;
  dependencies: string[]; // task IDs that must complete first
  result: string | null;
  createdAt: number;
  updatedAt: number;
}

function taskFilePath(sessionId: string): string {
  return join(TEAM_DIR, sessionId, 'tasks.json');
}

async function loadTasks(sessionId: string): Promise<TeamTask[]> {
  const path = taskFilePath(sessionId);
  if (!existsSync(path)) return [];
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

async function saveTasks(sessionId: string, tasks: TeamTask[]): Promise<void> {
  const path = taskFilePath(sessionId);
  await mkdir(join(TEAM_DIR, sessionId), { recursive: true });
  await writeFile(path, JSON.stringify(tasks, null, 2));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function createTask(
  sessionId: string,
  title: string,
  description: string,
  createdBy: string,
  dependencies: string[] = [],
): Promise<TeamTask> {
  const tasks = await loadTasks(sessionId);

  const task: TeamTask = {
    id: generateId(),
    title,
    description,
    status: dependencies.length > 0 ? 'blocked' : 'pending',
    createdBy,
    assignedTo: null,
    dependencies,
    result: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  tasks.push(task);
  await saveTasks(sessionId, tasks);
  return task;
}

export async function claimTask(
  sessionId: string,
  taskId: string,
  agentName: string,
): Promise<TeamTask | null> {
  const tasks = await loadTasks(sessionId);
  const task = tasks.find((t) => t.id === taskId);
  if (!task || task.status !== 'pending') return null;

  task.status = 'claimed';
  task.assignedTo = agentName;
  task.updatedAt = Date.now();
  await saveTasks(sessionId, tasks);
  return task;
}

export async function startTask(sessionId: string, taskId: string): Promise<void> {
  const tasks = await loadTasks(sessionId);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.status = 'in_progress';
  task.updatedAt = Date.now();
  await saveTasks(sessionId, tasks);
}

export async function completeTask(
  sessionId: string,
  taskId: string,
  result: string,
): Promise<void> {
  const tasks = await loadTasks(sessionId);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  task.status = 'done';
  task.result = result;
  task.updatedAt = Date.now();

  // Unblock dependent tasks
  for (const t of tasks) {
    if (t.status === 'blocked' && t.dependencies.includes(taskId)) {
      const allDone = t.dependencies.every(
        (depId) => tasks.find((d) => d.id === depId)?.status === 'done',
      );
      if (allDone) {
        t.status = 'pending';
        t.updatedAt = Date.now();
      }
    }
  }

  await saveTasks(sessionId, tasks);
}

export async function listTasks(sessionId: string): Promise<TeamTask[]> {
  return loadTasks(sessionId);
}

export async function getAvailableTasks(sessionId: string): Promise<TeamTask[]> {
  const tasks = await loadTasks(sessionId);
  return tasks.filter((t) => t.status === 'pending');
}
