/**
 * Exchange Auto-Learning Loop - PR3: Shadow Module Index
 * 
 * Exports for shadow mode evaluation system.
 */

// Types
export * from './exchange_shadow.types.js';

// Services
export { ExchangeShadowRecorderService, getExchangeShadowRecorderService } from './exchange_shadow_recorder.service.js';
export { ExchangeShadowMetricsService, getExchangeShadowMetricsService } from './exchange_shadow_metrics.service.js';
export { ExchangeInferenceService, getExchangeInferenceService } from './exchange_inference.service.js';

console.log('[Exchange ML] Shadow module index loaded');
