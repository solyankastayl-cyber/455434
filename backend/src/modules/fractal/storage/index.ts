/**
 * BLOCK 43.1-43.3 — Storage Module Exports
 * BLOCK 56.2-56.3 — Signal Snapshots + Research Registry
 */

// Models
export { 
  FractalCalibrationV2Model, 
  type IFractalCalibrationV2,
  type ICalibrationBucket 
} from './models/fractal_calibration_v2.model.js';

export { 
  FractalReliabilitySnapshotModel,
  type IFractalReliabilitySnapshot,
  type ReliabilityBadge,
  type IReliabilityComponents,
  type IReliabilityMetrics,
  type IReliabilityContext
} from './models/fractal_reliability_snapshot.model.js';

export { 
  FractalCertStampModel,
  type IFractalCertStamp,
  type ICertSummary
} from './models/fractal_cert_stamp.model.js';

export { 
  FractalEntropyHistoryModel,
  type IFractalEntropyHistory
} from './models/fractal_entropy_history.model.js';

// BLOCK 56.2 — Signal Snapshots
export {
  SignalSnapshotModel,
  upsertSignalSnapshot,
  getSnapshots,
  getLatestSnapshot,
  countSnapshots,
  type SignalSnapshotDocument,
  type ModelType,
  type ActionType,
  type GuardMode,
  type HealthStatus,
  type SignalSource,
  type StrategyPreset,
  type StrategyMode
} from './signal-snapshot.schema.js';

// BLOCK 56.3 — Research Model Registry
export {
  ResearchModelModel,
  createResearchModel,
  getShadowModels,
  getCandidateModels,
  updateModelPerformance,
  promoteToCandidate,
  archiveModel,
  generateParamHash,
  type ResearchModelDocument,
  type ResearchModelStatus,
  type ResearchModelParamSet,
  type ResearchModelPerformance
} from './research-model.schema.js';

// Services
export { 
  ReliabilitySnapshotWriter,
  reliabilitySnapshotWriter,
  type ReliabilitySnapshotInput,
  type EntropyTickInput
} from './reliability_snapshot.writer.js';

export { 
  DriftInjectService,
  driftInjectService,
  type DriftInjectParams,
  type DriftInjectResult
} from './drift_inject.service.js';
