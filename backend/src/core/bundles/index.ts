/**
 * Bundles Module Index
 * Intelligence layer (L4) - built from relations (L3)
 * 
 * Key concept:
 * - relation = road (topology)
 * - bundle = traffic pattern (behavior interpretation)
 * 
 * Bundle types:
 * - accumulation: buying/collecting
 * - distribution: selling/dispersing
 * - flow: balanced movement
 * - wash: suspicious activity
 * - rotation: cyclic patterns
 */

// Model
export {
  BundleModel,
  type IBundle,
  type BundleType,
  type BundleWindow,
  type BundleChain,
  calculateIntensityScore,
  getNetflowDirection,
} from './bundles.model.js';

// Schemas
export {
  BundleTypeEnum,
  BundleWindowEnum,
  BundleChainEnum,
  QueryActiveBundlesSchema,
  QueryByAddressSchema,
  QueryCorridorSchema,
  BundleResponseSchema,
  type QueryActiveBundlesInput,
  type QueryByAddressInput,
  type QueryCorridorInput,
  type BundleResponse,
} from './bundles.schema.js';

// Repository
export {
  BundlesRepository,
  bundlesRepository,
  type BundleFilter,
  type BundleSort,
  type PaginationOptions,
} from './bundles.repository.js';

// Service
export {
  BundlesService,
  bundlesService,
  formatBundle,
  getBundleInterpretation,
  classifyBundleType,
  calculateConsistencyScore,
} from './bundles.service.js';

// Routes
export { bundlesRoutes, routes } from './bundles.routes.js';
