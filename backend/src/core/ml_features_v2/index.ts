/**
 * ML Features V2 Module Index (P0.6)
 * 
 * Unified feature engineering layer for ML models.
 */

// Types
export * from './types/feature.types.js';

// Registry
export {
  FEATURE_REGISTRY,
  getAllFeatureKeys,
  getFeaturesBySource,
  getCriticalFeatures,
  getFeatureDefinition,
  validateFeatureValue,
  getRegistryVersion,
  getRegistryStats
} from './registry/feature_registry.js';

// Providers
export {
  extractRouteFeatures,
  extractDexFeatures,
  extractActorFeatures,
  extractWatchlistFeatures,
  extractSystemFeatures,
  extractMarketFeatures
} from './providers/index.js';

// Builder
export {
  buildFeatureVector,
  buildFeatureVectorsBatch
} from './builder/index.js';

// Normalization
export {
  normalizeFeatureVector,
  vectorToArray,
  getFeatureNames
} from './normalization/index.js';

// Storage
export {
  FeatureSnapshotModel,
  saveFeatureSnapshot,
  getLatestSnapshot,
  getSnapshotsForEntity,
  getSnapshotStats
} from './storage/feature_snapshot.model.js';

export {
  FeatureAuditModel,
  createAuditEntry,
  getRecentAudits,
  getAuditsForEntity,
  getAuditStats
} from './storage/feature_audit.model.js';

// Routes
export { mlFeaturesRoutes } from './api/index.js';
