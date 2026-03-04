/**
 * TA Module v2.0 — Technical Analysis Engine
 * 
 * Production-grade TA system with:
 * - ATR-adaptive Pivot Engine
 * - Market Structure Analysis (HH/HL/LH/LL)
 * - Support/Resistance Zones
 * - Extensible Detector Registry
 * - Phase K: ML Dataset Builder
 * - Phase L: ML Overlay (probability refinement)
 * - Phase M: Multi-Timeframe Aggregation
 * 
 * @version 2.0.0
 */

import { FastifyInstance } from 'fastify';
import { taRoutes } from './runtime/ta.controller.js';

// Export domain types
export * from './domain/types.js';
export * from './domain/math.js';

// Export core engines
export * from './core/indicators.js';
export * from './core/pivots.js';
export * from './core/structure.js';
export * from './core/levels.js';
export * from './core/series.js';

// Export detector utilities
export * from './detectors/base.js';
export * from './detectors/index.js';

// Export service
export { TaService } from './runtime/ta.service.js';

// Phase K: ML Dataset
export * from './ml_dataset/index.js';

// Phase L: ML Overlay
export * from './ml_overlay/index.js';

// Phase M: Multi-Timeframe
export * from './mtf/index.js';

/**
 * Register TA Module with Fastify
 */
export async function registerTaModule(app: FastifyInstance): Promise<void> {
  console.log('[TA] Registering Technical Analysis Module v2.0...');
  
  // Initialize detectors
  const { initializeDetectors } = await import('./detectors/index.js');
  initializeDetectors();
  
  // Register routes
  await app.register(taRoutes, { prefix: '/api/ta' });
  
  console.log('[TA] ✅ TA Module v2.0 registered at /api/ta/*');
  console.log('[TA] Endpoints: /health, /analyze, /structure, /levels, /pivots, /patterns, /features');
}
