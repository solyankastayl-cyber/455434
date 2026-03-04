/**
 * Macro Context Module
 * 
 * Market State Anchor providing:
 * - Fear & Greed Index
 * - BTC Dominance
 * - Stablecoin Dominance
 * 
 * GOLDEN RULES:
 * ❌ Macro НЕ решает BUY/SELL
 * ❌ Macro НЕ повышает confidence
 * ❌ Macro НЕ зависит от ML
 * ✅ Только контекст
 * ✅ Только фильтр
 * ✅ Только explainability
 */

export { macroRoutes } from './macro.routes.js';

// Re-export types
export * from './contracts/macro.types.js';

// Re-export services
export { getMacroSnapshot, getCurrentSnapshot } from './services/macro.snapshot.service.js';
export { getMacroSignal, calculateMacroImpact } from './services/macro.signal.service.js';
export { 
  startMacroAlertMonitor, 
  stopMacroAlertMonitor, 
  getMacroMonitorState,
  triggerMacroAlertCheck 
} from './services/macro.alert.monitor.js';

console.log('[Macro] Module loaded');
