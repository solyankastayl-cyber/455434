/**
 * INTELLIGENCE MODULE
 * ===================
 * 
 * Central intelligence layer that bridges:
 *   - Raw predictions (Exchange layer)
 *   - Risk adjustments (Meta-Brain)
 *   - Final UI-ready forecasts
 * 
 * Architecture:
 *   Exchange → Meta-Brain → Intelligence → UI
 * 
 * This module ensures the UI displays exactly what the system would act on.
 */

// Services
export { applyMetaBrainToForecast, buildMetaAwareForecast } from './services/meta-aware-forecast.service.js';

// Types
export type {
  MetaAwareForecast,
  AppliedOverlay,
  ForecastCaps,
  RiskLevel,
  MetaAction,
  ForecastAdjustmentContext,
  MetaBrainAdjustmentResult,
} from './contracts/meta-aware-forecast.types.js';

console.log('[Intelligence] Module loaded');
