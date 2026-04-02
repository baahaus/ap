export {
  createTeamSession,
  spawnPeer,
  messagePeer,
  synthesize,
  reviewPeer,
  runPipeline,
  mergePeer,
  getTeamStatus,
  type TeamSession,
  type PeerAgent,
  type ReviewResult,
  type PipelineStage,
  type PipelineResult,
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
