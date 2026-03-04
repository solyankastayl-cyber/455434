/**
 * PHASE 5 — Learning Module (Auto-Learning Loop)
 * ================================================
 * Module entry point and registration
 * 
 * Phase 5.1: Outcome Tracking ✅
 * Phase 5.2: Retrain + Promotion ✅
 * Phase 5.3: Shadow Monitoring + Auto-Rollback ✅
 */

import { FastifyInstance } from 'fastify';

// ═══════════════════════════════════════════════════════════════
// PHASE 5.1 — Outcome Tracking
// ═══════════════════════════════════════════════════════════════

export * from './contracts/outcome.types.js';
export { DecisionOutcomeModel } from './storage/outcome.model.js';
export { resolvePrice, getCurrentPrice, clearPriceCache, getCacheStats } from './services/price.resolver.js';
export { buildOutcome, shouldSkipDecision, isReadyForCalculation } from './services/outcome.builder.js';
export { runOutcomeJob, getOutcomeStats } from './jobs/outcome.job.js';
export { outcomeRoutes } from './routes/outcome.routes.js';

// ═══════════════════════════════════════════════════════════════
// PHASE 5.2 — Retrain + Promotion
// ═══════════════════════════════════════════════════════════════

export { MlModelRegistry } from './storage/ml_model.model.js';
export type { MlModelStage, MlModelAlgo, MlModelDoc } from './storage/ml_model.model.js';
export { MlRun } from './storage/ml_run.model.js';
export type { MlRunType, MlRunStatus, MlRunDoc } from './storage/ml_run.model.js';
export { ActiveModelState } from './runtime/active_model.state.js';
export { runRetrainJob } from './jobs/retrain.job.js';
export type { RetrainParams, RetrainResult } from './jobs/retrain.job.js';
export { promoteCandidate, rollbackToPrevious, retireCandidate } from './jobs/promotion.job.js';
export { mlopsRoutes } from './routes/mlops.routes.js';

// ═══════════════════════════════════════════════════════════════
// PHASE 5.3 — Shadow Monitoring
// ═══════════════════════════════════════════════════════════════

export { 
  runShadowEvaluation, 
  runManualEvaluation, 
  getShadowHealthSummary,
  calculateHealthState,
  SHADOW_CONFIG,
} from './services/shadow.service.js';

export type { 
  HealthState,
  ShadowEvalResult,
  ShadowHealthSummary,
} from './services/shadow.service.js';

// ═══════════════════════════════════════════════════════════════
// MODULE REGISTRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Register Learning Module (Phase 5)
 */
export async function registerLearningModule(app: FastifyInstance): Promise<void> {
  const { outcomeRoutes } = await import('./routes/outcome.routes.js');
  const { mlopsRoutes } = await import('./routes/mlops.routes.js');
  const { fomoWsRoutes } = await import('./routes/fomo.ws.routes.js');
  const { ActiveModelState } = await import('./runtime/active_model.state.js');
  const { initFomoWsMonitor } = await import('./services/fomo.ws.service.js');
  
  // Register Phase 5.1 outcome tracking routes
  await outcomeRoutes(app);
  
  // Register Phase 5.2/5.3 MLOps routes
  await mlopsRoutes(app);
  
  // Register FOMO AI WebSocket routes
  await fomoWsRoutes(app);
  
  // Initialize active model state from database
  await ActiveModelState.initialize();
  
  // Initialize FOMO WebSocket monitors for default symbols
  initFomoWsMonitor();
  
  console.log('[Phase 5] Learning Module registered (5.1 + 5.2 + 5.3 + FOMO WS)');
  app.log.info('[Phase 5] Learning Module (Outcome + MLOps + Shadow + FOMO WS) registered');
}

console.log('[Phase 5] Learning Module entry point loaded');
