/**
 * P4/P5: Cross-Asset Module Index
 * 
 * Exports all cross-asset composite lifecycle components.
 */

// Contracts
export * from './contracts/composite.contract.js';

// Store
export { CompositeStore } from './store/composite.store.js';

// Services
export { calculateVolatilityResults, calculateVolPenalty } from './services/composite.vol.js';
export { calculateSmartWeights, calculateConfidenceFactor } from './services/composite.weights.js';
export { buildCompositePath } from './services/composite.builder.js';
export { promoteComposite, auditCompositeInvariants } from './services/composite.promote.service.js';

// P5-A: Resolve
export { resolveCompositeSnapshot, resolveAllMatureComposites, forceResolveSnapshot } from './services/composite.resolve.service.js';

// P5-B: Drift
export { 
  getCompositeDrift, 
  getDriftByVersion, 
  getDriftByHorizon,
  getComponentAttribution,
  getWeightsDiagnostics,
  getWorstSnapshots,
  getBestSnapshots 
} from './services/composite.drift.service.js';

// Routes
export { compositeLifecycleRoutes } from './api/composite.lifecycle.routes.js';
