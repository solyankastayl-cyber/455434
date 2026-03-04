/**
 * Exchange Auto-Learning Loop - Performance Module Index
 * 
 * Horizon performance tracking and cross-horizon bias adjustment.
 * V2: With Time-Decay support.
 * V3: With Horizon Cascade for training (BLOCK 3).
 */

// Config
export * from './config/decay.config.js';

// Utils
export * from './utils/decay-math.js';

// Models
export * from './models/exchange_horizon_stats.model.js';

// Services
export {
  HorizonPerformanceService,
  getHorizonPerformanceService,
  RawStats,
  DecayStats,
  HorizonPerformanceResult,
} from './horizon-performance.service.js';

export {
  CrossHorizonBiasService,
  getCrossHorizonBiasService,
  CrossHorizonBiasConfig,
  BiasAdjustmentResult,
  BiasBreakdown,
} from './cross-horizon-bias.service.js';

// Horizon Cascade (BLOCK 3)
export {
  HorizonCascadeService,
  getHorizonCascadeService,
  HorizonCascadeState,
  CascadeInfluence,
} from './horizon_cascade.service.js';

// Jobs
export { ExchangeDecayAuditJob, getExchangeDecayAuditJob } from './jobs/decay-audit.job.js';

console.log('[Exchange ML] Performance module index loaded (V3 with Cascade)');
