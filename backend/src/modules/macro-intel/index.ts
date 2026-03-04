/**
 * Macro Intelligence Module
 * 
 * Market Regime Engine - transforms macro data into actionable intelligence
 * 
 * ARCHITECTURE:
 * - macro (existing) = raw data (Fear & Greed, Dominance)
 * - macro-intel (this) = interpreted regime + impact
 * 
 * GOLDEN RULES:
 * ❌ Macro never creates signals
 * ❌ Macro never flips decisions  
 * ❌ Macro never increases confidence
 * ✅ Macro provides context
 * ✅ Macro can block/reduce
 * ✅ Macro feeds ML as features
 */

export { macroIntelRoutes } from './macro-intel.routes.js';

// Re-export types
export * from './contracts/macro-intel.types.js';

// Re-export services
export { 
  getMacroIntelSnapshot, 
  getCurrentMacroIntelSnapshot,
  getMacroIntelContext,
  getMacroMlFeatures 
} from './services/macro-intel.snapshot.service.js';

export { 
  buildMacroGrid, 
  getMacroGridWithActive, 
  getActiveRegimeCell 
} from './services/macro-grid.service.js';

export {
  detectRegime,
  detectTrend,
  detectAllTrends,
} from './services/regime.detector.js';

console.log('[MacroIntel] Module loaded');
