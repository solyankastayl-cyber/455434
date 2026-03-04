/**
 * Scoring Engine — Unified pattern ranking and selection
 * 
 * Takes all candidate patterns from detectors and:
 * 1. Normalizes metrics across different pattern types
 * 2. Applies unified scoring formula
 * 3. Returns ranked list with explanations
 * 4. Selects top-K for UI display
 * 
 * Scoring factors:
 * - Geometry quality (convergence, fit, touches)
 * - Market context (regime, MA alignment)
 * - Risk/Reward ratio
 * - Compression/volatility
 * 
 * Phase 7: Added Feature Pack integration (volGate, MA alignment, Fib confluence)
 */

import { CandidatePattern, TAContext, MarketRegime, PatternType } from '../domain/types.js';
import { getFeatureBonus } from '../features/features.builder.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type ScoreReason = {
  factor: string;
  value: number;     // 0..1
  weight: number;    // contribution weight
  contribution: number; // value * weight
};

export type ScoredPattern = CandidatePattern & {
  scoring: {
    score: number;           // 0..1 final score
    confidence: number;      // 0..1 how consistent factors are
    reasons: ScoreReason[];
  };
};

export type ScoreConfig = {
  topK: number;              // max patterns to return (default 2)
  minScoreToShow: number;    // minimum score threshold (default 0.35)
  // Factor weights
  wGeometry: number;         // default 0.35
  wTouches: number;          // default 0.20
  wCompression: number;      // default 0.10
  wMAContext: number;        // default 0.10
  wRegime: number;           // default 0.10
  wRiskReward: number;       // default 0.15
};

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  topK: 2,
  minScoreToShow: 0.35,
  wGeometry: 0.35,
  wTouches: 0.20,
  wCompression: 0.10,
  wMAContext: 0.10,
  wRegime: 0.10,
  wRiskReward: 0.15,
};

// ═══════════════════════════════════════════════════════════════
// Main API
// ═══════════════════════════════════════════════════════════════

/**
 * Score and select best patterns
 */
export function scoreAndSelectPatterns(
  ctx: TAContext,
  patterns: CandidatePattern[],
  cfg: Partial<ScoreConfig> = {}
): {
  ranked: ScoredPattern[];
  top: ScoredPattern[];
  dropped: ScoredPattern[];
} {
  const config = { ...DEFAULT_SCORE_CONFIG, ...cfg };

  // Score all patterns
  const scored: ScoredPattern[] = patterns.map(p => scorePattern(ctx, p, config));

  // Sort by score descending
  scored.sort((a, b) => b.scoring.score - a.scoring.score);

  // Split into top and dropped
  const top = scored
    .filter(p => p.scoring.score >= config.minScoreToShow)
    .slice(0, config.topK);

  const dropped = scored.filter(p => p.scoring.score < config.minScoreToShow);

  return {
    ranked: scored,
    top,
    dropped,
  };
}

/**
 * Score a single pattern
 */
function scorePattern(
  ctx: TAContext,
  pattern: CandidatePattern,
  cfg: ScoreConfig
): ScoredPattern {
  const reasons: ScoreReason[] = [];

  // 1) Geometry quality
  const geomValue = calculateGeometryScore(pattern);
  reasons.push({
    factor: 'geometry',
    value: geomValue,
    weight: cfg.wGeometry,
    contribution: geomValue * cfg.wGeometry,
  });

  // 2) Touches quality
  const touchValue = calculateTouchesScore(pattern);
  reasons.push({
    factor: 'touches',
    value: touchValue,
    weight: cfg.wTouches,
    contribution: touchValue * cfg.wTouches,
  });

  // 3) Compression context
  const compValue = calculateCompressionScore(ctx, pattern);
  reasons.push({
    factor: 'compression',
    value: compValue,
    weight: cfg.wCompression,
    contribution: compValue * cfg.wCompression,
  });

  // 4) MA context alignment
  const maValue = calculateMAContextScore(ctx, pattern);
  reasons.push({
    factor: 'maContext',
    value: maValue,
    weight: cfg.wMAContext,
    contribution: maValue * cfg.wMAContext,
  });

  // 5) Regime alignment
  const regValue = calculateRegimeScore(ctx, pattern);
  reasons.push({
    factor: 'regime',
    value: regValue,
    weight: cfg.wRegime,
    contribution: regValue * cfg.wRegime,
  });

  // 6) Risk/Reward
  const rrValue = calculateRiskRewardScore(pattern);
  reasons.push({
    factor: 'riskReward',
    value: rrValue,
    weight: cfg.wRiskReward,
    contribution: rrValue * cfg.wRiskReward,
  });

  // Phase 7: Feature Pack bonuses
  let featureBonus = 0;
  let volGate = 1.0;
  
  if (ctx.featuresPack) {
    const entryPrice = pattern.trade?.entry ?? ctx.series.candles[ctx.series.candles.length - 1]?.close ?? 0;
    const featureResult = getFeatureBonus(ctx.featuresPack, pattern.direction, entryPrice);
    featureBonus = featureResult.bonus;
    volGate = featureResult.volGate;
    
    // Add feature bonus as a reason
    if (featureBonus !== 0) {
      reasons.push({
        factor: 'featureBonus',
        value: clamp01(0.5 + featureBonus),
        weight: 0.15,
        contribution: featureBonus * 0.15,
      });
    }
  }

  // Calculate final score (weighted average * volGate)
  const rawScore = calculateWeightedScore(reasons);
  const score = rawScore * volGate;

  // Calculate confidence (factor consistency)
  const confidence = calculateConfidence(reasons) * volGate;

  return {
    ...pattern,
    scoring: {
      score: round(score, 3),
      confidence: round(confidence, 3),
      reasons,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Score Calculators
// ═══════════════════════════════════════════════════════════════

function calculateGeometryScore(p: CandidatePattern): number {
  const m = p.metrics ?? {};

  // If detector already provided totalScore, use it as hint
  if (typeof m.totalScore === 'number' && m.totalScore > 0) {
    return clamp01(m.totalScore);
  }

  // Pattern-specific geometry scoring
  const family = getPatternFamily(p.type);

  switch (family) {
    case 'TRIANGLE': {
      const conv = clamp01(m.convergence ?? 0);
      const msePenalty = clamp01((m.fitMSEUpper ?? 0) + (m.fitMSELower ?? 0));
      return clamp01(0.7 * conv + 0.3 * (1 - msePenalty * 0.5));
    }
    case 'FLAG': {
      const parallel = clamp01(m.parallel ?? 0.5);
      const retrace = clamp01(1 - (m.retrace ?? 0.5));
      const height = clamp01(1 - (m.canvasHeightAtr ?? 2) / 3);
      return clamp01(0.45 * parallel + 0.35 * retrace + 0.20 * height);
    }
    case 'CHANNEL': {
      const parallel = m.isParallel ? 0.8 : 0.5;
      const slopeDiff = clamp01(1 - (m.slopeDiff ?? 0) * 100);
      return clamp01(0.6 * parallel + 0.4 * slopeDiff);
    }
    default: {
      // Generic: use geometryScore if provided
      return clamp01(m.geometryScore ?? 0.5);
    }
  }
}

function calculateTouchesScore(p: CandidatePattern): number {
  const m = p.metrics ?? {};
  const upper = m.touchesUpper ?? 0;
  const lower = m.touchesLower ?? 0;
  const total = m.touches ?? (upper + lower);

  // 2 touches = baseline, 4+ = good, 6+ = excellent
  return clamp01((total - 2) / 4);
}

function calculateCompressionScore(ctx: TAContext, p: CandidatePattern): number {
  const ctxCompression = ctx.structure?.compressionScore ?? 0;
  const patternCompression = p.metrics?.compressionScore ?? p.metrics?.compression ?? 0;

  return clamp01(Math.max(ctxCompression, patternCompression));
}

function calculateMAContextScore(ctx: TAContext, p: CandidatePattern): number {
  const direction = getPatternDirection(p.type);
  if (direction === 'NEUTRAL') return 0.5;

  const maCtx = (p.context?.maContext ?? {}) as Record<string, number>;
  const dist50 = maCtx.priceVsMa50 ?? ctx.features?.priceVsMa50 ?? 0;
  const slope50 = maCtx.maSlope50 ?? ctx.features?.maSlope50 ?? 0;
  const slope200 = maCtx.maSlope200 ?? ctx.features?.maSlope200 ?? 0;

  // Bullish: price above MA, slopes positive
  // Bearish: price below MA, slopes negative
  if (direction === 'BULLISH') {
    const distScore = clamp01(0.5 + dist50 * 2);
    const slopeScore = clamp01(0.5 + (slope50 + slope200 * 0.5) * 50);
    return clamp01(0.55 * distScore + 0.45 * slopeScore);
  } else {
    const distScore = clamp01(0.5 - dist50 * 2);
    const slopeScore = clamp01(0.5 - (slope50 + slope200 * 0.5) * 50);
    return clamp01(0.55 * distScore + 0.45 * slopeScore);
  }
}

function calculateRegimeScore(ctx: TAContext, p: CandidatePattern): number {
  const regime = ctx.structure?.regime ?? 'TRANSITION';
  const direction = getPatternDirection(p.type);
  const family = getPatternFamily(p.type);

  const isTrendUp = regime === 'TREND_UP';
  const isTrendDown = regime === 'TREND_DOWN';
  const isRange = regime === 'RANGE';

  let base = 0.5;

  // Pattern family suitability for regime
  if (isTrendUp || isTrendDown) {
    if (family === 'FLAG' || family === 'CHANNEL') base = 0.75;
    if (family === 'TRIANGLE') base = 0.60;
    if (family === 'REVERSAL') base = 0.55;
  } else if (isRange) {
    if (family === 'TRIANGLE') base = 0.70;
    if (family === 'CHANNEL') base = 0.55;
    if (family === 'FLAG') base = 0.50;
  }

  // Direction alignment bonus/penalty
  if (direction !== 'NEUTRAL') {
    if (isTrendUp && direction === 'BULLISH') base += 0.10;
    if (isTrendDown && direction === 'BEARISH') base += 0.10;
    if (isTrendUp && direction === 'BEARISH') base -= 0.10;
    if (isTrendDown && direction === 'BULLISH') base -= 0.10;
  }

  return clamp01(base);
}

function calculateRiskRewardScore(p: CandidatePattern): number {
  const trade = p.trade;
  if (!trade) return 0.5;

  const rr = trade.riskReward ?? 0;
  if (!rr || rr <= 0) return 0.4;

  // RR 1 -> 0.4, RR 2 -> 0.7, RR 3+ -> 0.85+
  return clamp01(0.3 + Math.min(0.55, rr * 0.2));
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function calculateWeightedScore(reasons: ScoreReason[]): number {
  let num = 0, den = 0;
  for (const r of reasons) {
    num += r.value * r.weight;
    den += r.weight;
  }
  return den > 0 ? num / den : 0.5;
}

function calculateConfidence(reasons: ScoreReason[]): number {
  // Higher confidence when factors are consistent (low variance)
  const values = reasons.map(r => r.value);
  if (values.length === 0) return 0.5;

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;

  return clamp01(1 - Math.sqrt(variance));
}

function getPatternDirection(type: PatternType): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const typeStr = type as string;
  if (typeStr.includes('BULL') || typeStr.includes('ASC') || typeStr.includes('UP')) return 'BULLISH';
  if (typeStr.includes('BEAR') || typeStr.includes('DESC') || typeStr.includes('DOWN')) return 'BEARISH';
  if (typeStr.includes('FALLING')) return 'BULLISH';  // Falling wedge usually breaks up
  if (typeStr.includes('RISING')) return 'BEARISH';   // Rising wedge usually breaks down
  return 'NEUTRAL';
}

function getPatternFamily(type: PatternType): 'TRIANGLE' | 'FLAG' | 'CHANNEL' | 'REVERSAL' | 'OTHER' {
  const typeStr = type as string;
  if (typeStr.includes('TRIANGLE') || typeStr.includes('WEDGE')) return 'TRIANGLE';
  if (typeStr.includes('FLAG') || typeStr.includes('PENNANT')) return 'FLAG';
  if (typeStr.includes('CHANNEL') || typeStr.includes('TRENDLINE')) return 'CHANNEL';
  if (typeStr.includes('HNS') || typeStr.includes('DOUBLE') || typeStr.includes('TOP') || typeStr.includes('BOTTOM')) return 'REVERSAL';
  return 'OTHER';
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function round(x: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(x * factor) / factor;
}
