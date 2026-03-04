/**
 * Brain ML Module Index
 * P8.0: Quantile Forecast Layer (B1 baseline + B2 MoE)
 */

// Contracts
export * from './contracts/feature_vector.contract.js';
export * from './contracts/quantile_forecast.contract.js';
export * from './contracts/quantile_train.contract.js';

// Services
export { getFeatureBuilderService } from './services/feature_builder.service.js';
export { getBaselineQuantileModelService } from './services/quantile_model.service.js';
export { getForecastPipelineService } from './services/forecast_pipeline.service.js';
export { getDatasetBuilderService } from './services/dataset_builder.service.js';
export { getQuantileMixtureService } from './services/quantile_mixture.service.js';

// Storage
export { getQuantileModelRepo } from './storage/quantile_model.repo.js';

// Routes
export { brainMlRoutes } from './routes/brain_ml.routes.js';
export { brainForecastRoutes } from './routes/brain_forecast.routes.js';
