/**
 * Transfers Module Index
 * Normalized transfers layer - API between on-chain data and analytics
 * 
 * ALL analytics modules read from here:
 * - Relations
 * - Bundles
 * - Scores
 * - Signals
 */

// Model
export {
  TransferModel,
  type ITransfer,
  type AssetType,
  type TransferDirection,
  type TransferSource,
  type Chain,
} from './transfers.model.js';

// Schemas
export {
  AssetTypeEnum,
  TransferSourceEnum,
  ChainEnum,
  QueryByAddressSchema,
  QueryByAssetSchema,
  QueryCorridorSchema,
  NetflowQuerySchema,
  TransferResponseSchema,
  type QueryByAddressInput,
  type QueryByAssetInput,
  type QueryCorridorInput,
  type NetflowQueryInput,
  type TransferResponse,
} from './transfers.schema.js';

// Repository
export {
  TransfersRepository,
  transfersRepository,
  type TransferFilter,
  type TransferSort,
  type PaginationOptions,
} from './transfers.repository.js';

// Service
export {
  TransfersService,
  transfersService,
  formatTransfer,
} from './transfers.service.js';

// Routes
export { transfersRoutes, routes } from './transfers.routes.js';
