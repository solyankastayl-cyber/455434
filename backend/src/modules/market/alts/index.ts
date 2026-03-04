/**
 * Market Alts Module — Index
 * ===========================
 * Blocks 2.4-2.7: Funding Feature + Candidates + Outcomes + Patterns
 */

// Types
export * from './db/types.js';
export * from './db/pattern.cluster.types.js';

// Services
export * from './services/funding.feature.builder.js';
export * from './services/alt.candidates.service.js';
export * from './services/alt.predictions.service.js';
export * from './services/alt.outcome.tracker.service.js';
export * from './services/alt.learning.samples.service.js';
export * from './services/alt.pattern.clusterer.service.js';
export * from './services/vector.math.js';

// Routes
export { registerAltCandidatesRoutes } from './routes/alt.candidates.routes.js';
export { registerAdminAltLearningRoutes } from './routes/admin.learning.routes.js';
export { registerAltPatternsRoutes } from './routes/alt.patterns.routes.js';

console.log('[Market Alts] Module loaded (Blocks 2.4-2.7)');
