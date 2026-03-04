/**
 * Exchange Auto-Learning Loop - PR4/5/6: Lifecycle Module Index
 * 
 * UPDATED: Capital-Centric v2
 * 
 * Exports for the lifecycle management system.
 */

// Config and types
export * from './exchange_lifecycle.config.js';

// Services
export { ExchangeEventLoggerService, getExchangeEventLoggerService } from './exchange_event_logger.service.js';
export { 
  ExchangeAutoPromotionService, 
  getExchangeAutoPromotionService,
  resetExchangeAutoPromotionService 
} from './exchange_auto_promotion.service.js';
export { 
  ExchangeAutoRollbackService, 
  getExchangeAutoRollbackService,
  resetExchangeAutoRollbackService 
} from './exchange_auto_rollback.service.js';
export { ExchangeGuardrailsService, getExchangeGuardrailsService } from './exchange_guardrails.service.js';
export { ExchangeLifecycleScheduler, getExchangeLifecycleScheduler } from './exchange_lifecycle_scheduler.js';

console.log('[Exchange ML] Lifecycle module index loaded (Capital-Centric v2)');
