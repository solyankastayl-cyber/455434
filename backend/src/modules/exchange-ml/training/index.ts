/**
 * Exchange Auto-Learning Loop - PR2: Training Module Index
 * 
 * Exports for the training subsystem:
 * - Trainer Service
 * - Model Registry Service
 * - Model Loader (BLOCK 2.3)
 * - Retrain Scheduler
 */

// Types
export * from './exchange_training.types.js';

// Services
export { ExchangeTrainerService, getExchangeTrainerService } from './exchange_trainer.service.js';
export { ExchangeModelRegistryService, getExchangeModelRegistryService } from './exchange_model_registry.service.js';
export { ExchangeModelLoader, getExchangeModelLoader, resetExchangeModelLoader } from './exchange_model_loader.js';
export { ExchangeRetrainScheduler, getExchangeRetrainScheduler } from './exchange_retrain_scheduler.js';

console.log('[Exchange ML] Training module index loaded (with Model Loader)');
