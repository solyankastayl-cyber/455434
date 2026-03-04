/**
 * HORIZON CONSENSUS SERVICE
 * 
 * Soft hierarchy for multi-horizon signals
 * 
 * Key principles:
 * - Does NOT change fractal search
 * - Does NOT change MacroScore
 * - Only affects final verdict/summary layer
 * 
 * Formula:
 *   S_consensus = normalize(
 *     S30 + w90*C90*S90 + w180*C180*S180 + w365*C365*S365
 *   )
 *   
 *   C_consensus = C_base * (1 - contradictionPenalty)
 */

// ═══════════════════════════════════════════════════════════════
// CONTRACTS
// ═══════════════════════════════════════════════════════════════

export interface HorizonSignal {
  horizon: 30 | 90 | 180 | 365;
  score: number;      // [-1, +1]
  confidence: number; // [0, 1]
}

export interface ConsensusConfig {
  weights: Record<number, number>;
  contradictionPenalties: Record<string, number>;
  minConfidenceForBlend: number;
}

export interface ConsensusResult {
  score: number;
  confidence: number;
  baseHorizon: number;
  blendedFrom: number[];
  contradictions: string[];
  contradictionPenalty: number;
}

export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  weights: {
    90: 0.35,
    180: 0.20,
    365: 0.10,
  },
  contradictionPenalties: {
    '90-180': 0.10,
    '180-365': 0.15,
    '90-365': 0.12,
  },
  minConfidenceForBlend: 0.35,
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function getSignal(
  signals: HorizonSignal[],
  horizon: number
): HorizonSignal | null {
  return signals.find(s => s.horizon === horizon) || null;
}

// ═══════════════════════════════════════════════════════════════
// CONTRADICTION DETECTION
// ═══════════════════════════════════════════════════════════════

function detectContradictions(
  signals: HorizonSignal[],
  config: ConsensusConfig
): { contradictions: string[]; penalty: number } {
  const contradictions: string[] = [];
  let penalty = 0;
  
  const pairs = [
    [90, 180],
    [180, 365],
    [90, 365],
  ];
  
  for (const [h1, h2] of pairs) {
    const s1 = getSignal(signals, h1);
    const s2 = getSignal(signals, h2);
    
    if (!s1 || !s2) continue;
    
    // Both must have significant signal and confidence
    if (Math.abs(s1.score) < 0.2 || Math.abs(s2.score) < 0.2) continue;
    if (s1.confidence < 0.3 || s2.confidence < 0.3) continue;
    
    // Check sign contradiction
    if (Math.sign(s1.score) !== Math.sign(s2.score)) {
      const key = `${h1}-${h2}`;
      contradictions.push(key);
      penalty += config.contradictionPenalties[key] || 0.1;
    }
  }
  
  return { contradictions, penalty: clamp(penalty, 0, 0.5) };
}

// ═══════════════════════════════════════════════════════════════
// MAIN CONSENSUS COMPUTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Compute consensus from multiple horizon signals
 * 
 * This is a SOFT hierarchy:
 * - Base is always 30d signal
 * - Longer horizons contribute based on their confidence
 * - Contradictions reduce overall confidence
 */
export function computeConsensus(
  signals: HorizonSignal[],
  config: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG
): ConsensusResult {
  // Get base signal (30d)
  const base = getSignal(signals, 30);
  
  if (!base) {
    // Fallback: use shortest available
    const sorted = [...signals].sort((a, b) => a.horizon - b.horizon);
    if (sorted.length === 0) {
      return {
        score: 0,
        confidence: 0,
        baseHorizon: 0,
        blendedFrom: [],
        contradictions: [],
        contradictionPenalty: 0,
      };
    }
    const fallback = sorted[0];
    return {
      score: fallback.score,
      confidence: fallback.confidence,
      baseHorizon: fallback.horizon,
      blendedFrom: [fallback.horizon],
      contradictions: [],
      contradictionPenalty: 0,
    };
  }
  
  // Start with base
  let blendedScore = base.score;
  const blendedFrom: number[] = [30];
  
  // Add contributions from longer horizons
  for (const horizon of [90, 180, 365]) {
    const signal = getSignal(signals, horizon);
    if (!signal) continue;
    
    const weight = config.weights[horizon] || 0;
    
    // Only blend if confidence is above threshold
    if (signal.confidence >= config.minConfidenceForBlend) {
      blendedScore += weight * signal.confidence * signal.score;
      blendedFrom.push(horizon);
    }
  }
  
  // Normalize to [-1, 1]
  blendedScore = clamp(blendedScore, -1, 1);
  
  // Detect contradictions
  const { contradictions, penalty } = detectContradictions(signals, config);
  
  // Apply contradiction penalty to confidence
  const finalConfidence = base.confidence * (1 - penalty);
  
  return {
    score: round4(blendedScore),
    confidence: round4(clamp(finalConfidence, 0, 1)),
    baseHorizon: 30,
    blendedFrom,
    contradictions,
    contradictionPenalty: round4(penalty),
  };
}

// ═══════════════════════════════════════════════════════════════
// UTILITY: Convert to Verdict
// ═══════════════════════════════════════════════════════════════

export type Verdict = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'HOLD';

export interface VerdictResult {
  verdict: Verdict;
  score: number;
  confidence: number;
  reason: string;
}

export function toVerdict(
  consensus: ConsensusResult,
  bullishThreshold: number = 0.15,
  bearishThreshold: number = -0.15,
  confidenceThreshold: number = 0.3
): VerdictResult {
  const { score, confidence, contradictions } = consensus;
  
  // Low confidence -> HOLD
  if (confidence < confidenceThreshold) {
    return {
      verdict: 'HOLD',
      score,
      confidence,
      reason: 'Low confidence',
    };
  }
  
  // High contradiction -> NEUTRAL
  if (contradictions.length >= 2) {
    return {
      verdict: 'NEUTRAL',
      score,
      confidence,
      reason: 'Horizon contradictions',
    };
  }
  
  // Score-based verdict
  if (score >= bullishThreshold) {
    return {
      verdict: 'BULLISH',
      score,
      confidence,
      reason: `Score ${score} above ${bullishThreshold}`,
    };
  }
  
  if (score <= bearishThreshold) {
    return {
      verdict: 'BEARISH',
      score,
      confidence,
      reason: `Score ${score} below ${bearishThreshold}`,
    };
  }
  
  return {
    verdict: 'NEUTRAL',
    score,
    confidence,
    reason: `Score ${score} in neutral zone`,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  computeConsensus,
  toVerdict,
  DEFAULT_CONSENSUS_CONFIG,
};
