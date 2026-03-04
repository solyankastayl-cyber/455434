/**
 * ML Quality Storage Index (P0.7)
 */

export {
  FeatureCoverageSnapshotModel,
  generateCoverageSnapshotId,
  saveCoverageSnapshot,
  getLatestCoverage,
  getCoverageHistory,
  getBlockedEntities,
  getCoverageStats
} from './feature_coverage.model.js';

export type {
  BlockReason,
  ISourceCoverage,
  ICoverageStats,
  IFreshnessStats,
  IGateDecision,
  IFeatureCoverageSnapshot
} from './feature_coverage.model.js';

export {
  FeatureDistributionModel,
  DistributionDeltaModel,
  saveDistribution,
  getLatestDistribution,
  getBaselineDistribution,
  saveDelta,
  getRecentDriftAlerts,
  getDriftStats
} from './feature_distribution.model.js';

export type {
  DriftAlertLevel,
  IFeatureDistribution,
  IDistributionDelta
} from './feature_distribution.model.js';
