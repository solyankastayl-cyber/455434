/**
 * Shadow Mode Module Index
 */

// Types
export type {
  V1Scores,
  V2Scores,
  ShadowDiff,
  ShadowSnapshot,
  ShadowMetrics,
  KillSwitchStatus,
} from './shadow.types.js';

// Model
export { ShadowSnapshotModel, type IShadowSnapshot } from './shadow.model.js';

// Service
export {
  compareV1V2,
  getShadowMetrics,
  evaluateKillSwitch,
  getRecentComparisons,
} from './shadow.service.js';
