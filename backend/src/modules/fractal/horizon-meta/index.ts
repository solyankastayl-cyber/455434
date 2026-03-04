/**
 * HORIZON META MODULE — Entry Point
 */

// Contracts
export type {
  HorizonKey,
  HorizonBias,
  HorizonMetaMode,
  ConsensusState,
  HorizonMetaInput,
  HorizonDivergence,
  HorizonConsensus,
  HorizonMetaPack,
  ProjectionSnapshot,
  ProjectionTrackingPack,
} from './horizon_meta.contract.js';

// Config
export {
  horizonMetaConfig,
  loadHorizonMetaConfig,
  projectionTrackingConfig,
  type HorizonMetaConfig,
} from './horizon_meta.config.js';

// Services
export {
  HorizonMetaService,
  getHorizonMetaService,
  resetHorizonMetaService,
} from './horizon_meta.service.js';

export {
  saveProjectionSnapshot,
  getProjectionTrackingPack,
  ensureProjectionTrackingIndexes,
  type SaveSnapshotInput,
  type GetTrackingInput,
} from './projection_tracking.service.js';

// Routes
export { horizonMetaRoutes } from './horizon_meta.routes.js';

// Tests
export { runHorizonMetaTests } from './horizon_meta.tests.js';
