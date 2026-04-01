export {
  createTeamSession,
  spawnPeer,
  messagePeer,
  synthesize,
  mergePeer,
  getTeamStatus,
  type TeamSession,
  type PeerAgent,
} from './coordinator.js';

export {
  createWorktree,
  mergeWorktree,
  type Worktree,
} from './worktree.js';

export {
  sendMessage,
  readMessages,
  markRead,
  type TeamMessage,
  type MessageType,
} from './mailbox.js';

export {
  createTask,
  claimTask,
  startTask,
  completeTask,
  listTasks,
  getAvailableTasks,
  type TeamTask,
  type TaskStatus,
} from './taskqueue.js';
