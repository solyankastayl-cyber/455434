/**
 * SPX HORIZON STACK BUILDER — Real Multi-Horizon Consensus
 * 
 * Builds real horizonStack from focus-pack computations
 * for each horizon (7d, 14d, 30d, 90d, 180d, 365d).
 * 
 * This replaces the mock horizonStack in consensus routes.
 */

import { buildSpxFocusPack } from '../spx-core/spx-focus-pack.builder.js';
import type { SpxHorizonKey } from '../spx-core/spx-horizon.config.js';
import type { SpxFocusPack } from '../spx-core/spx-focus-pack.builder.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface HorizonStackItem {
  horizon: SpxHorizonKey;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  confidence: number;
  divergenceGrade: string;
  blockers: string[];
  
  // Additional context from focus-pack
  hitRate: number;
  medianReturn: number;
  p10Return: number;
  p90Return: number;
  sampleSize: number;
  phaseAtNow: string;
  tier: string;
}

export interface HorizonStackBuildResult {
  stack: HorizonStackItem[];
  buildTimeMs: number;
  errors: string[];
  successCount: number;
  failCount: number;
}

// ═══════════════════════════════════════════════════════════════
// HORIZON STACK BUILDER
// ═══════════════════════════════════════════════════════════════

const HORIZONS: SpxHorizonKey[] = ['7d', '14d', '30d', '90d', '180d', '365d'];

/**
 * Build real horizon stack from focus-pack computations
 */
export async function buildRealHorizonStack(): Promise<HorizonStackBuildResult> {
  const t0 = Date.now();
  const stack: HorizonStackItem[] = [];
  const errors: string[] = [];
  
  // Build focus-pack for each horizon
  for (const horizon of HORIZONS) {
    try {
      const focusPack = await buildSpxFocusPack(horizon);
      const item = extractHorizonItem(horizon, focusPack);
      stack.push(item);
    } catch (err: any) {
      errors.push(`${horizon}: ${err.message}`);
      // Add fallback item for failed horizon
      stack.push(buildFallbackItem(horizon));
    }
  }
  
  return {
    stack,
    buildTimeMs: Date.now() - t0,
    errors,
    successCount: HORIZONS.length - errors.length,
    failCount: errors.length,
  };
}

/**
 * Extract horizon item from focus-pack
 */
function extractHorizonItem(horizon: SpxHorizonKey, pack: SpxFocusPack): HorizonStackItem {
  const { overlay, divergence, meta, phase } = pack;
  const { stats } = overlay;
  
  // Determine direction from stats
  let direction: 'BULL' | 'BEAR' | 'NEUTRAL' = 'NEUTRAL';
  if (stats.medianReturn > 0.01) {
    direction = 'BULL';
  } else if (stats.medianReturn < -0.01) {
    direction = 'BEAR';
  }
  
  // Calculate confidence from multiple factors
  const confidence = calculateConfidence(stats, divergence);
  
  // Collect blockers
  const blockers = collectBlockers(pack);
  
  return {
    horizon,
    direction,
    confidence,
    divergenceGrade: divergence.grade,
    blockers,
    hitRate: stats.hitRate,
    medianReturn: stats.medianReturn,
    p10Return: stats.p10Return,
    p90Return: stats.p90Return,
    sampleSize: stats.sampleSize,
    phaseAtNow: phase.phase,
    tier: meta.tier,
  };
}

/**
 * Calculate confidence score (0-1)
 */
function calculateConfidence(
  stats: { hitRate: number; sampleSize: number; medianReturn: number; p10Return: number },
  divergence: { grade: string; score: number }
): number {
  // Base confidence from hit rate
  let confidence = stats.hitRate;
  
  // Sample size factor
  const sampleFactor = Math.min(1, stats.sampleSize / 20);
  confidence *= sampleFactor;
  
  // Divergence factor
  const divFactor = divergenceToFactor(divergence.grade);
  confidence *= divFactor;
  
  // Direction strength factor
  const dirStrength = Math.abs(stats.medianReturn) / 0.10; // 10% return = max strength
  const dirFactor = Math.min(1, 0.7 + dirStrength * 0.3);
  confidence *= dirFactor;
  
  // Risk-adjusted: penalize if p10 is very negative
  if (stats.p10Return < -0.15) {
    confidence *= 0.85;
  }
  
  return Math.max(0.3, Math.min(0.95, confidence));
}

/**
 * Convert divergence grade to confidence factor
 */
function divergenceToFactor(grade: string): number {
  switch (grade) {
    case 'A': return 1.05;
    case 'B': return 1.00;
    case 'C': return 0.90;
    case 'D': return 0.80;
    case 'F': return 0.65;
    default: return 0.90;
  }
}

/**
 * Collect blockers from focus-pack
 */
function collectBlockers(pack: SpxFocusPack): string[] {
  const blockers: string[] = [];
  
  // Check sample size
  if (pack.overlay.stats.sampleSize < 5) {
    blockers.push('LOW_SAMPLE_SIZE');
  }
  
  // Check divergence grade
  if (pack.divergence.grade === 'D' || pack.divergence.grade === 'F') {
    blockers.push('HIGH_DIVERGENCE');
  }
  
  // Check phase flags
  if (pack.phase.flags?.includes('VOL_SHOCK')) {
    blockers.push('VOL_SHOCK');
  }
  
  if (pack.phase.flags?.includes('DEEP_DRAWDOWN')) {
    blockers.push('DEEP_DRAWDOWN');
  }
  
  // Check reliability
  if (pack.diagnostics.reliability < 0.5) {
    blockers.push('LOW_RELIABILITY');
  }
  
  return blockers;
}

/**
 * Build fallback item for failed horizon
 */
function buildFallbackItem(horizon: SpxHorizonKey): HorizonStackItem {
  const tierMap: Record<SpxHorizonKey, string> = {
    '7d': 'TIMING',
    '14d': 'TIMING',
    '30d': 'TACTICAL',
    '90d': 'TACTICAL',
    '180d': 'STRUCTURE',
    '365d': 'STRUCTURE',
  };
  
  return {
    horizon,
    direction: 'NEUTRAL',
    confidence: 0.35,
    divergenceGrade: 'C',
    blockers: ['COMPUTATION_FAILED'],
    hitRate: 0.5,
    medianReturn: 0,
    p10Return: -0.1,
    p90Return: 0.1,
    sampleSize: 0,
    phaseAtNow: 'UNKNOWN',
    tier: tierMap[horizon] || 'TACTICAL',
  };
}

export default { buildRealHorizonStack };
