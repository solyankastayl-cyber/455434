/**
 * BLOCK 76.3 — Phase Snapshot Service
 * 
 * Calculates phase strength indicator for terminal header.
 * Aggregates data from:
 * - Phase Stats (73.5/73.6)
 * - Divergence (73.2)
 * - Volatility (P1.4)
 * 
 * Returns lightweight snapshot for real-time display.
 */

import {
  PhaseSnapshot,
  PhaseSnapshotInput,
  PhaseGrade,
  PhaseFlag,
  MIN_SAMPLES_BY_TIER,
} from './phase-snapshot.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp(x: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * Convert score (0-100) to grade (A-F)
 */
function scoreToGrade(score: number): PhaseGrade {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

/**
 * Calculate Strength Index (0-1)
 * 
 * Formula:
 * strengthIndex = 0.40 * normScore + 0.30 * normSharpe + 0.20 * hitRate + 0.10 * (1 - divergencePenalty)
 */
function calculateStrengthIndex(
  score: number,
  sharpe: number,
  hitRate: number,
  divergenceScore: number
): number {
  // Normalize score: 0-100 → 0-1
  const normScore = clamp(score / 100);
  
  // Normalize sharpe: -1 to +2 → 0 to 1
  // sharpe -1 → 0
  // sharpe +2 → 1
  const normSharpe = clamp((sharpe + 1) / 3);
  
  // Hit rate already 0-1
  const normHit = clamp(hitRate);
  
  // Divergence penalty: 0-100 → 0-1 (inverted: higher divergence = lower strength)
  const divergencePenalty = clamp(divergenceScore / 100);
  
  // Final strength calculation
  const strengthIndex = 
    0.40 * normScore +
    0.30 * normSharpe +
    0.20 * normHit +
    0.10 * (1 - divergencePenalty);
  
  return Math.round(strengthIndex * 1000) / 1000;
}

/**
 * Detect warning flags
 */
function detectFlags(input: PhaseSnapshotInput): PhaseFlag[] {
  const flags: PhaseFlag[] = [];
  
  const minSamples = MIN_SAMPLES_BY_TIER[input.tier];
  
  // Sample warnings
  if ((input.samples ?? 0) < minSamples * 0.5) {
    flags.push('VERY_LOW_SAMPLE');
  } else if ((input.samples ?? 0) < minSamples) {
    flags.push('LOW_SAMPLE');
  }
  
  // Divergence warning
  if (input.divergenceScore < 40) {
    flags.push('HIGH_DIVERGENCE');
  }
  
  // Sharpe warning
  if ((input.sharpe ?? 0) < 0) {
    flags.push('NEGATIVE_SHARPE');
  }
  
  // Tail risk warning
  if ((input.tailRisk ?? 0) > 0.55) {
    flags.push('HIGH_TAIL');
  }
  
  // Volatility crisis
  if (input.volRegime === 'CRISIS') {
    flags.push('VOL_CRISIS');
  }
  
  // Entropy/recency warning
  if ((input.entropy ?? 0) > 0.75) {
    flags.push('LOW_RECENCY');
  }
  
  return flags;
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

/**
 * Build Phase Snapshot from available data
 */
export function buildPhaseSnapshot(input: PhaseSnapshotInput): PhaseSnapshot {
  // Default values for missing data
  const score = input.score ?? 50;
  const hitRate = input.hitRate ?? 0.5;
  const sharpe = input.sharpe ?? 0;
  const expectancy = input.expectancy ?? 0;
  const samples = input.samples ?? 0;
  
  // Calculate grade if not provided
  const grade = input.grade ?? scoreToGrade(score);
  
  // Calculate strength index
  const strengthIndex = calculateStrengthIndex(
    score,
    sharpe,
    hitRate,
    input.divergenceScore
  );
  
  // Detect flags
  const flags = detectFlags(input);
  
  return {
    symbol: 'BTC',
    focus: input.focus,
    tier: input.tier,
    
    phase: input.phase,
    phaseId: input.phaseId,
    
    grade,
    score,
    strengthIndex,
    
    hitRate,
    sharpe,
    expectancy,
    samples,
    
    volRegime: input.volRegime,
    divergenceScore: input.divergenceScore,
    
    flags,
    
    asof: new Date().toISOString(),
  };
}

/**
 * Build Phase Snapshot from Terminal Data
 * 
 * Extracts relevant data from horizonMatrix, volatility, etc.
 */
export function buildPhaseSnapshotFromTerminal(
  focus: string,
  globalPhase: string,
  horizonMatrix: Array<{
    horizon: string;
    tier: string;
    direction: string;
    confidence: number;
    reliability: number;
    entropy: number;
    tailRisk: number;
    expectedReturn: number;
  }>,
  volatilityRegime: string,
  consensus74?: {
    consensusIndex: number;
    adaptiveMeta?: {
      divergencePenalties: number;
    };
  }
): PhaseSnapshot {
  // Find current horizon data
  const currentHorizon = horizonMatrix.find(h => h.horizon === focus);
  
  // Determine tier from focus
  const tier = (['180d', '365d'].includes(focus) ? 'STRUCTURE' : 
                ['30d', '90d'].includes(focus) ? 'TACTICAL' : 'TIMING') as 'TIMING' | 'TACTICAL' | 'STRUCTURE';
  
  // Calculate phase score from confidence and reliability
  const conf = currentHorizon?.confidence ?? 0.5;
  const rel = currentHorizon?.reliability ?? 0.5;
  const entropy = currentHorizon?.entropy ?? 0.5;
  const score = Math.round((conf * 0.4 + rel * 0.3 + (1 - entropy) * 0.3) * 100);
  
  // Calculate hit rate proxy from confidence
  const hitRate = Math.min(0.7, 0.3 + conf * 0.5);
  
  // Calculate sharpe proxy from expected return and entropy
  const expRet = currentHorizon?.expectedReturn ?? 0;
  const sharpe = entropy < 0.5 ? expRet * 15 : expRet * 10;
  
  // Divergence score (inverted entropy * 100)
  const divergenceScore = Math.round((1 - entropy) * 100);
  
  // Generate phase ID
  const phaseId = `${globalPhase}_${focus}_${new Date().toISOString().split('T')[0]}`;
  
  return buildPhaseSnapshot({
    focus,
    tier,
    phase: globalPhase as any || 'UNKNOWN',
    phaseId,
    score,
    hitRate,
    sharpe,
    expectancy: expRet,
    samples: 20, // Placeholder - would come from actual match count
    volRegime: volatilityRegime as any || 'NORMAL',
    divergenceScore,
    entropy,
    tailRisk: currentHorizon?.tailRisk ?? 0.5,
  });
}

export default {
  buildPhaseSnapshot,
  buildPhaseSnapshotFromTerminal,
  calculateStrengthIndex,
  scoreToGrade,
};
