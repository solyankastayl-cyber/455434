/**
 * Strategy Profiles Module Index
 */
export {
  StrategyProfileModel,
  type IStrategyProfile,
  type StrategyType,
  type RiskLevel,
  type InfluenceLevel,
  type PerformanceProxy,
  getRiskLevel,
  getInfluenceLevel,
  STRATEGY_DISPLAY_NAMES,
  STRATEGY_DESCRIPTIONS,
} from './strategy_profiles.model.js';

export {
  strategyTypeSchema,
  riskLevelSchema,
  influenceLevelSchema,
  strategySortSchema,
  type StrategyTypeEnum,
  type RiskLevelEnum,
  type InfluenceLevelEnum,
  type StrategySortEnum,
} from './strategy_profiles.schema.js';

export {
  strategyProfilesRepository,
  type StrategyProfileUpsertData,
} from './strategy_profiles.repository.js';

export {
  strategyProfilesService,
  formatStrategyProfile,
  type ClassificationInput,
} from './strategy_profiles.service.js';

export { strategyProfilesRoutes } from './strategy_profiles.routes.js';
