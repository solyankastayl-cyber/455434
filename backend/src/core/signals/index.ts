/**
 * Signals Module Index
 * Event layer (L5) - built from bundles (L4)
 * 
 * Key concept:
 * - Bundle = state (accumulation, distribution, etc.)
 * - Signal = change event (when state changed)
 * 
 * Signal types:
 * - accumulation_start/end
 * - distribution_start/end
 * - wash_detected/cleared
 * - intensity_spike/drop
 * - bundle_change
 */

// Model
export {
  SignalModel,
  type ISignal,
  type SignalType,
  type SignalEntityType,
  type SignalSeverity,
  getSeverityFromScore,
  calculateSeverityScore,
  generateExplanation,
} from './signals.model.js';

// Schemas
export {
  SignalEntityTypeEnum,
  SignalTypeEnum,
  SignalSeverityEnum,
  QueryLatestSignalsSchema,
  QueryByAddressSchema,
  QueryByCorridorSchema,
  SignalResponseSchema,
  type QueryLatestSignalsInput,
  type QueryByAddressInput,
  type QueryByCorridorInput,
  type SignalResponse,
} from './signals.schema.js';

// Repository
export {
  SignalsRepository,
  signalsRepository,
  type SignalFilter,
  type SignalSort,
  type PaginationOptions,
} from './signals.repository.js';

// Service
export {
  SignalsService,
  signalsService,
  formatSignal,
} from './signals.service.js';

// Routes
export { signalsRoutes, routes } from './signals.routes.js';
