/**
 * Phase U: Performance Engine - Index
 * 
 * High-performance pattern detection infrastructure.
 */

export { buildFeatureCache, type FeatureCache } from './feature_cache.js';
export { 
  shouldRunFamily, 
  getActiveFamilies, 
  type FamilyName, 
  type GatingContext, 
  type GatingResult 
} from './family_gate.js';
export { 
  runParallel, 
  runParallelCollect, 
  batchItems,
  type ParallelOptions, 
  type TaskResult 
} from './parallel_runner.js';
export { 
  stablePatternSort, 
  mergePatterns, 
  deduplicatePatterns,
  groupByType,
  topN 
} from './merge.js';
export { 
  FAMILY_BUDGETS, 
  getBudget, 
  applyBudget, 
  isBudgetExceeded,
  type FamilyBudget 
} from './budgets.js';
export { 
  createTimingCollector, 
  logTimings, 
  analyzeTimings,
  type PhaseTimings, 
  type TimingCollector 
} from './timings.js';
export { 
  runPatternEngineFast, 
  runPatternEngineSync,
  DEFAULT_FAST_ENGINE_OPTIONS,
  type FastEngineOptions,
  type FastEngineResult
} from './pattern_engine_fast.js';
