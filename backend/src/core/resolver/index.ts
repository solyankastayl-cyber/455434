/**
 * Resolver Module (Phase 15.5.2)
 */
export { resolverRoutes } from './resolver.routes.js';
export { 
  resolve, 
  clearExpiredResolutions, 
  getBootstrapStats, 
  getIndexerStatus 
} from './resolver.service.js';
export { 
  ResolutionModel, 
  ResolvedType, 
  ResolutionStatus,
  SuggestionType,
  RESOLUTION_CACHE_TTL,
  RESOLUTION_PENDING_TTL 
} from './resolution.model.js';
export { BootstrapJobModel, BootstrapType, BootstrapStatus } from './bootstrap.model.js';
