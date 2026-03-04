/**
 * S10.7 — Exchange ML Module Index
 * 
 * V4 Auto-Learning Loop Architecture:
 * - PR1: Dataset & Labeling Pipeline (CURRENT)
 * - PR2: Retrain Engine
 * - PR3: Shadow Evaluation & Promotion Gate
 * - PR4: Auto-Rollback & Health Monitor
 * - PR5: Runtime Self-Defense Integration
 * - PR6: Observability & Admin Panel
 */

// Legacy S10.7 exports (existing ML system)
export * from './ml.types.js';
export * from './featureExtractor.js';
export * from './labeler.js';
export * from './ml.service.js';
export * from './ml.trainer.js';
export * from './ml.comparison.js';
export * from './model.registry.js';
export * from './macroFeatureExtractor.js';
export * from './ml.shadow.training.js';
export * from './contracts/mlops.promotion.types.js';
export * from './ml.modifier.service.js';
export * from './ml.promotion.service.js';
export * from './ml.shadow.monitor.service.js';
export { mlRoutes, mlShadowRoutes, mlopsPromotionRoutes, step3PromotionRoutes } from './ml.routes.js';

// ═══════════════════════════════════════════════════════════════
// V4 AUTO-LEARNING LOOP (PR1+)
// ═══════════════════════════════════════════════════════════════

// PR1: Dataset & Labeling Pipeline
export * from './dataset/index.js';
export * from './jobs/index.js';

// PR2: Retrain Engine
export * from './training/index.js';

// PR3: Shadow Mode
export * from './shadow/index.js';

// PR4/5/6: Lifecycle (Auto-Promotion, Auto-Rollback, Guardrails)
export * from './lifecycle/index.js';

// Performance: Horizon Performance & Cross-Horizon Bias
export * from './performance/index.js';

// NEW: Capital-Centric Performance Metrics
export * from './perf/index.js';

// NEW: Freeze Configuration (v4.8.0)
export * from './config/exchange_freeze_config.js';

// NEW: Monitor Routes (v4.8.0)
export { registerExchangeMonitorRoutes } from './perf/exchange_monitor.routes.js';

// Contracts
export * from './contracts/exchange.types.js';

// Combined Verdict Service
export * from './exchange.verdict.service.js';

// Snapshots: Immutable prediction ledger (BLOCK 1)
export * from './snapshots/index.js';
export { exchangeSnapshotPublicRoutes, exchangeSnapshotAdminRoutes } from './snapshots/exchange_snapshot.routes.js';

// Segments: Forecast visualization with Ghost rollforward (BLOCK 4 - Legacy)
export * from './segments/index.js';
export { forecastSegmentPublicRoutes, forecastSegmentAdminRoutes } from './segments/forecast_segment.routes.js';

// ═══════════════════════════════════════════════════════════════
// BLOCK 5-7: Model Iteration Engine (NEW - replaces synthetic bridge)
// ═══════════════════════════════════════════════════════════════
export * from './iteration/index.js';
export { exchSegmentsPublicRoutes, exchSegmentsAdminRoutes } from './iteration/exch_segments.routes.js';
export {
  startHorizonRollScheduler,
  stopHorizonRollScheduler,
  isHorizonRollSchedulerRunning,
  triggerHorizonRollCheck,
} from './iteration/exch_horizon_roll.scheduler.js';

// Admin routes
export { exchangeMLAdminRoutes } from './admin/index.js';

console.log('[Exchange ML] V4 Auto-Learning Module loaded (PR1-PR6 + Performance + Snapshots + Segments + Iteration BLOCK 5-7)');
