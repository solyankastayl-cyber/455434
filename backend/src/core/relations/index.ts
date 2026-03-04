/**
 * Relations Module Index
 * Aggregated relations layer (L3) - built from transfers (L2)
 * 
 * Key concept: 1000 transfers → 1 relation with density score
 * This is how we solve the "onion problem" (Warhammer-style corridors)
 */

// Model
export {
  RelationModel,
  type IRelation,
  type RelationWindow,
  type RelationDirection,
  type RelationSource,
  type RelationChain,
  WINDOW_DAYS,
  calculateDensityScore,
} from './relations.model.js';

// Schemas
export {
  RelationWindowEnum,
  RelationDirectionEnum,
  RelationChainEnum,
  RelationSourceEnum,
  QueryGraphSchema,
  QueryByAddressSchema,
  QueryCorridorSchema,
  RelationResponseSchema,
  type QueryGraphInput,
  type QueryByAddressInput,
  type QueryCorridorInput,
  type RelationResponse,
} from './relations.schema.js';

// Repository
export {
  RelationsRepository,
  relationsRepository,
  type RelationFilter,
  type RelationSort,
  type PaginationOptions,
} from './relations.repository.js';

// Service
export {
  RelationsService,
  relationsService,
  formatRelation,
} from './relations.service.js';

// Routes
export { relationsRoutes, routes } from './relations.routes.js';
