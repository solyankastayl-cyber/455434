/**
 * Exchange ML Iteration Module (BLOCK 5)
 * =======================================
 * 
 * Model Iteration Engine for segmented forecasts.
 * Each new prediction = separate segment.
 * No redrawing of old data.
 * 
 * Exports:
 * - Model: ExchForecastSegment schema
 * - Repo: Database operations
 * - Service: Business logic (maybeRollSegment)
 * - Routes: API endpoints
 * - Scheduler: Auto 30D roll on 7D resolution (BLOCK 7)
 */

// Model
export * from './exch_forecast_segment.model.js';

// Repository
export * from './exch_forecast_segment.repo.js';

// Service
export * from './exch_forecast_segment.service.js';

// Routes
export * from './exch_segments.routes.js';

// Scheduler (BLOCK 7)
export * from './exch_horizon_roll.scheduler.js';

console.log('[Exchange ML] Iteration module loaded (BLOCK 5 + 7)');
