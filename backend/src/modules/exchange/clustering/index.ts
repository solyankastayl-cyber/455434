/**
 * BLOCK 2.12 — Clustering Module Index
 * =====================================
 */

// Vector math
export * from './vector_builder.js';
export * from './kmeans.js';

// Services
export { FeatureStatsService, featureStatsService } from './feature_stats.service.js';
export { PatternClusterService, patternClusterService, DEFAULT_CLUSTER_FEATURES } from './pattern_cluster.service.js';

// Routes
export { registerPatternClusterRoutes } from './clustering.routes.js';

console.log('[Clustering] Module loaded (Block 2.12)');
