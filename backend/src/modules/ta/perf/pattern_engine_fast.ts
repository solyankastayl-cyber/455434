/**
 * Phase U: Fast Pattern Engine
 * 
 * High-performance pattern detection with:
 * - Compute-once feature cache
 * - Smart family gating
 * - Parallel execution
 * - Deterministic merge
 * - Budget enforcement
 * 
 * Drop-in replacement for standard pattern detection.
 */

import { TAContext, CandidatePattern, OhlcvCandle, Pivot } from '../domain/types.js';
import { buildFeatureCache, FeatureCache } from './feature_cache.js';
import { shouldRunFamily, getActiveFamilies, GatingContext, FamilyName } from './family_gate.js';
import { runParallelCollect, ParallelOptions } from './parallel_runner.js';
import { mergePatterns, stablePatternSort, deduplicatePatterns } from './merge.js';
import { getBudget, applyBudget } from './budgets.js';
import { createTimingCollector, logTimings, PhaseTimings } from './timings.js';
import { getDetectorRegistry, Detector } from '../detectors/index.js';
import { logger } from '../infra/logger.js';

export interface FastEngineOptions {
  concurrency: number;
  maxTotalPatterns: number;
  enableTimings: boolean;
  enableGating: boolean;
  timeoutMs: number;
}

export const DEFAULT_FAST_ENGINE_OPTIONS: FastEngineOptions = {
  concurrency: 4,
  maxTotalPatterns: 500,
  enableTimings: true,
  enableGating: true,
  timeoutMs: 5000,
};

export interface FastEngineResult {
  patterns: CandidatePattern[];
  timings?: PhaseTimings;
  familiesRun: string[];
  familiesSkipped: string[];
  totalDetectors: number;
}

/**
 * Map detector families to actual detector IDs
 * These IDs must match what's registered in the detector registry
 */
const FAMILY_TO_DETECTORS: Record<FamilyName, string[]> = {
  STRUCTURE: ['structure', 'bos', 'choch'],
  LEVELS: ['levels', 'phase_t_sr_flip', 'phase_t_liquidity', 'sr_flip', 'liquidity'],
  BREAKOUTS: ['breakout', 'phase_t_failed_breakout', 'failed_breakout'],
  TRIANGLES: ['triangle', 'phase_t_diamond', 'diamond'],
  FLAGS: ['flag', 'pennant'],
  REVERSALS: ['double', 'hs', 'head_shoulder', 'phase_r_reversals', 'reversal'],
  HARMONICS: ['abcd', 'harmonic', 'phase_r_harmonics', 'gartley', 'bat', 'butterfly'],
  ELLIOTT: ['elliott', 'wave', 'phase_r8'],
  CANDLES: ['candle', 'candle_pack', 'doji', 'engulf', 'hammer'],
  DIVERGENCES: ['divergence', 'phase_t_hidden_divergence', 'hidden_div', 'regular_div'],
  MICROSTRUCTURE: ['microstructure', 'order_block', 'ob'],
  VOLUME: ['volume', 'climax'],
  MA_PATTERNS: ['ma_', 'phase_r_ma', 'phase_t_ma_advanced', 'golden', 'death', 'squeeze'],
  LIQUIDITY: ['liquidity', 'sweep', 'phase_t_liquidity'],
  TREND_GEOMETRY: ['channel', 'trendline', 'pitchfork', 'phase_t_trend_geometry', 'expanding'],
};

/**
 * Run pattern detection with performance optimizations
 */
export async function runPatternEngineFast(
  ctx: TAContext,
  options: Partial<FastEngineOptions> = {}
): Promise<FastEngineResult> {
  const opts = { ...DEFAULT_FAST_ENGINE_OPTIONS, ...options };
  const timing = createTimingCollector();
  
  timing.start('total');
  
  // ═══════════════════════════════════════════════════════════════
  // 1. Build Feature Cache (compute once)
  // ═══════════════════════════════════════════════════════════════
  
  timing.start('features');
  const cache = buildFeatureCache(
    ctx.candles,
    ctx.indicators,
    ctx.features
  );
  ctx.cache = cache;
  timing.end('features');
  
  // ═══════════════════════════════════════════════════════════════
  // 2. Family Gating (skip irrelevant families)
  // ═══════════════════════════════════════════════════════════════
  
  timing.start('gating');
  
  const gatingCtx: GatingContext = {
    candleCount: ctx.candles?.length || 0,
    pivotCount: ctx.pivots?.length || 0,
    regime: ctx.structure?.regime,
    volRegime: ctx.vol?.regime,
    hasVolume: Array.isArray(ctx.candles) && ctx.candles.some(c => c.volume && c.volume > 0),
    volatility: cache.volatility,
    trendStrength: cache.trendStrength,
    cache,
  };
  
  let activeFamilies: FamilyName[];
  const skippedFamilies: FamilyName[] = [];
  
  if (opts.enableGating) {
    activeFamilies = getActiveFamilies(gatingCtx) || [];
    
    const allFamilies: FamilyName[] = Object.keys(FAMILY_TO_DETECTORS) as FamilyName[];
    for (const f of allFamilies) {
      if (!activeFamilies || !activeFamilies.includes(f)) {
        skippedFamilies.push(f);
      }
    }
  } else {
    activeFamilies = Object.keys(FAMILY_TO_DETECTORS) as FamilyName[];
  }
  
  timing.end('gating');
  
  // ═══════════════════════════════════════════════════════════════
  // 3. Run Detector Families in Parallel
  // ═══════════════════════════════════════════════════════════════
  
  timing.start('families');
  
  const registry = getDetectorRegistry();
  const allDetectors = registry.getAll();
  
  // Create tasks for each family
  const familyTasks: Array<{
    family: FamilyName;
    task: () => Promise<CandidatePattern[]>;
  }> = [];
  
  for (const family of activeFamilies) {
    const detectorIds = FAMILY_TO_DETECTORS[family] || [];
    const budget = getBudget(family);
    
    const task = async (): Promise<CandidatePattern[]> => {
      timing.startFamily(family);
      
      const patterns: CandidatePattern[] = [];
      
      // Run all detectors for this family
      for (const detector of allDetectors) {
        if (!detector || !detector.id) continue;
        
        // Check if detector belongs to this family (case-insensitive partial match)
        const detectorIdLower = (detector.id || '').toLowerCase();
        const detectorTypes = Array.isArray(detector.types) ? detector.types : [];
        
        const matchesFamily = detectorIds.some(id => {
          if (!id) return false;
          const idLower = id.toLowerCase();
          return detectorIdLower.includes(idLower) ||
            detectorTypes.some(t => t && t.toLowerCase().includes(idLower));
        });
        
        if (!matchesFamily) continue;
        
        try {
          const detected = detector.detect(ctx);
          if (Array.isArray(detected)) {
            patterns.push(...detected);
          }
          
          // Enforce budget
          if (patterns.length >= budget.maxCandidates) {
            break;
          }
        } catch (error) {
          logger.warn({ 
            family, 
            detector: detector.id, 
            error: (error as Error).message 
          }, 'Detector failed');
        }
      }
      
      // Apply budget and return
      const budgeted = applyBudget(patterns, budget);
      timing.endFamily(family, budgeted.length);
      
      return budgeted;
    };
    
    familyTasks.push({ family, task });
  }
  
  // Execute in parallel
  const parallelOpts: ParallelOptions = {
    concurrency: opts.concurrency,
    timeoutMs: opts.timeoutMs,
  };
  
  const { results: familyResults, errors } = await runParallelCollect(
    familyTasks.map(ft => ft.task),
    parallelOpts
  );
  
  if (errors.length > 0) {
    logger.warn({ errorCount: errors.length }, 'Some families had errors');
  }
  
  timing.end('families');
  
  // ═══════════════════════════════════════════════════════════════
  // 4. Merge & Deduplicate (deterministic)
  // ═══════════════════════════════════════════════════════════════
  
  timing.start('merge');
  
  const patterns = mergePatterns([familyResults], {
    dedup: true,
    maxPatterns: opts.maxTotalPatterns,
    sortFirst: true,
  });
  
  timing.end('merge');
  timing.end('total');
  
  // ═══════════════════════════════════════════════════════════════
  // 5. Collect Results & Timings
  // ═══════════════════════════════════════════════════════════════
  
  const timings = timing.getTimings();
  
  if (opts.enableTimings) {
    logTimings(timings);
  }
  
  return {
    patterns,
    timings: opts.enableTimings ? timings : undefined,
    familiesRun: activeFamilies,
    familiesSkipped: skippedFamilies,
    totalDetectors: allDetectors.length,
  };
}

/**
 * Simplified sync wrapper for existing code
 */
export function runPatternEngineSync(ctx: TAContext): CandidatePattern[] {
  // For sync usage, just run all detectors sequentially
  const registry = getDetectorRegistry();
  const allDetectors = registry.getAll();
  
  const patterns: CandidatePattern[] = [];
  
  for (const detector of allDetectors) {
    try {
      const detected = detector.detect(ctx);
      patterns.push(...detected);
    } catch (error) {
      // Skip failed detectors
    }
  }
  
  // Sort and dedupe
  patterns.sort(stablePatternSort);
  return deduplicatePatterns(patterns);
}
