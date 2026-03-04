/**
 * BLOCK 56.2-56.3 — Fractal Lifecycle Module
 * 
 * Forward-truth engine components:
 * - Signal Snapshot Writer
 * - Outcome Resolver
 * - Model Registry
 * - Promotion Workflow
 */

export { 
  snapshotWriterService, 
  SnapshotWriterService,
  type SnapshotWriteResult,
  type PresetKey
} from './snapshot.writer.service.js';

export { snapshotWriterRoutes } from './snapshot.writer.routes.js';

export {
  outcomeResolverService,
  OutcomeResolverService,
  type HorizonDays,
  type ResolveResult
} from './outcome.resolver.service.js';

export { outcomeResolverRoutes } from './outcome.resolver.routes.js';

// Existing lifecycle components
export { FractalAutoPromotionService } from './fractal_auto_promotion.service.js';
export { LIFECYCLE_CONFIG } from './fractal_lifecycle.config.js';
export { FractalModelRegistry } from './fractal_model_registry.service.js';
