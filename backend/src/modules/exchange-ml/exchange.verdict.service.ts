/**
 * Exchange Combined Verdict Service
 * ==================================
 * 
 * Combines Environment Model (USE/IGNORE/WARNING) with Direction Model (UP/DOWN/NEUTRAL)
 * to produce final trading verdict.
 * 
 * v4.7.0: Added Trade Quality Layer integration
 * 
 * Architecture:
 * - Environment Model: WHEN to trade (gate)
 * - Direction Model: WHERE to trade (signal)
 * - Quality Filter: SHOULD we trade? (filter)
 * - Combined: action + confidence + position size
 * 
 * Updated Gating Rules (Capital-Centric):
 * - ENV=IGNORE → HOLD (blocked, no readable structure)
 * - ENV=WARNING → Allow trading with REDUCED position size (not blocked!)
 * - ENV=USE → Full trading with Direction signal
 * 
 * Quality Layer Rules:
 * - Minimum confidence threshold (horizon-specific)
 * - Minimum edge probability 
 * - Minimum ATR (avoid choppy markets)
 * - Momentum confirmation bonuses
 * 
 * Key principle:
 * - ENV decides WHEN to trade (gating)
 * - DIR decides WHERE to trade (direction)
 * - QUALITY decides IF the trade is worth taking (filter)
 * - Combined confidence drives POSITION SIZE
 */

import {
  ExchangeEnvPrediction,
  ExchangeDirPrediction,
  ExchangeCombinedVerdict,
  Horizon,
} from './contracts/exchange.types.js';
import { 
  getExchangeTradeQualityService, 
  ExchangeTradeQualityService 
} from './quality/exchange_trade_quality.service.js';
import { QualityInput, QualityDecision } from './perf/exchange_trade_types.js';

// ═══════════════════════════════════════════════════════════════
// WARNING MODE HELPER
// ═══════════════════════════════════════════════════════════════

/**
 * Apply warning mode: allow trading but with reduced confidence/position.
 * WARNING = "market is readable but risky" → trade with caution
 */
function applyWarningMode(
  env: ExchangeEnvPrediction,
  dir: ExchangeDirPrediction
): ExchangeCombinedVerdict {
  // NEUTRAL direction = no trade even in warning
  if (dir.label === 'NEUTRAL') {
    return {
      env,
      dir,
      action: 'HOLD',
      confidence: 0,
      gate: { passed: false, reason: 'DIR_NEUTRAL: No clear direction signal' },
    };
  }
  
  const action: 'BUY' | 'SELL' = dir.label === 'UP' ? 'BUY' : 'SELL';
  
  // Reduced confidence: 60% of normal + env penalty
  // WARNING mode caps max confidence at 0.5
  const baseConfidence = dir.confidence * 0.6;
  const envPenalty = (1 - env.confidence) * 0.2;
  const confidence = clamp01(Math.min(0.5, baseConfidence - envPenalty));
  
  return {
    env,
    dir,
    action,
    confidence,
    gate: { 
      passed: true, 
      reason: 'ENV_WARNING: Reduced position size applied' 
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// VERDICT COMBINATION
// ═══════════════════════════════════════════════════════════════

/**
 * Combine Environment and Direction predictions into final verdict.
 * 
 * Algorithm:
 * 1. ENV=IGNORE → HOLD (gate blocked)
 * 2. ENV=WARNING → allow trading with reduced weight
 * 3. ENV=USE, DIR=NEUTRAL → HOLD
 * 4. ENV=USE, DIR=UP/DOWN → BUY/SELL with combined confidence
 */
export function combineExchangeVerdict(
  env: ExchangeEnvPrediction,
  dir: ExchangeDirPrediction
): ExchangeCombinedVerdict {
  // 1️⃣ Environment gate: IGNORE blocks everything
  if (env.label === 'IGNORE') {
    return {
      env,
      dir,
      action: 'HOLD',
      confidence: 0,
      gate: { passed: false, reason: 'ENV_IGNORE: Market structure not readable' },
    };
  }

  // 2️⃣ WARNING: allow trading but reduced position
  if (env.label === 'WARNING') {
    return applyWarningMode(env, dir);
  }

  // 3️⃣ ENV=USE: Direction decides
  if (dir.label === 'NEUTRAL') {
    return {
      env,
      dir,
      action: 'HOLD',
      confidence: 0,
      gate: { passed: false, reason: 'DIR_NEUTRAL: No clear direction signal' },
    };
  }

  const action: 'BUY' | 'SELL' = dir.label === 'UP' ? 'BUY' : 'SELL';

  // 4️⃣ Combined confidence formula:
  // dir.confidence * (0.6 + 0.4 * env.confidence)
  // - At env.confidence=1.0: dir.confidence * 1.0
  // - At env.confidence=0.5: dir.confidence * 0.8
  const combinedConfidence = clamp01(
    dir.confidence * (0.6 + 0.4 * env.confidence)
  );

  return {
    env,
    dir,
    action,
    confidence: combinedConfidence,
    gate: { passed: true },
  };
}

// ═══════════════════════════════════════════════════════════════
// VERDICT ANALYSIS
// ═══════════════════════════════════════════════════════════════

export interface VerdictStats {
  total: number;
  gatePassRate: number; // % of verdicts that passed gate
  actionDistribution: {
    BUY: number;
    SELL: number;
    HOLD: number;
  };
  avgConfidence: number;
  gateBlockReasons: Record<string, number>;
}

export function analyzeVerdicts(verdicts: ExchangeCombinedVerdict[]): VerdictStats {
  const stats: VerdictStats = {
    total: verdicts.length,
    gatePassRate: 0,
    actionDistribution: { BUY: 0, SELL: 0, HOLD: 0 },
    avgConfidence: 0,
    gateBlockReasons: {},
  };

  if (verdicts.length === 0) return stats;

  let gatePassed = 0;
  let totalConfidence = 0;

  for (const v of verdicts) {
    if (v.gate.passed) {
      gatePassed++;
    } else if (v.gate.reason) {
      const key = v.gate.reason.split(':')[0];
      stats.gateBlockReasons[key] = (stats.gateBlockReasons[key] || 0) + 1;
    }

    stats.actionDistribution[v.action]++;
    totalConfidence += v.confidence;
  }

  stats.gatePassRate = (gatePassed / verdicts.length) * 100;
  stats.avgConfidence = totalConfidence / verdicts.length;

  return stats;
}

// ═══════════════════════════════════════════════════════════════
// VERDICT QUALITY METRICS
// ═══════════════════════════════════════════════════════════════

export interface VerdictQuality {
  signalStrength: 'STRONG' | 'MODERATE' | 'WEAK' | 'BLOCKED';
  tradeable: boolean;
  reasons: string[];
}

export function assessVerdictQuality(verdict: ExchangeCombinedVerdict): VerdictQuality {
  const reasons: string[] = [];

  // Blocked by gate
  if (!verdict.gate.passed) {
    return {
      signalStrength: 'BLOCKED',
      tradeable: false,
      reasons: [verdict.gate.reason || 'Gate blocked'],
    };
  }

  // HOLD is not tradeable
  if (verdict.action === 'HOLD') {
    return {
      signalStrength: 'WEAK',
      tradeable: false,
      reasons: ['Direction model returned NEUTRAL'],
    };
  }

  // Assess confidence
  let strength: 'STRONG' | 'MODERATE' | 'WEAK';
  
  if (verdict.confidence >= 0.7) {
    strength = 'STRONG';
    reasons.push('High confidence signal');
  } else if (verdict.confidence >= 0.5) {
    strength = 'MODERATE';
    reasons.push('Moderate confidence signal');
  } else {
    strength = 'WEAK';
    reasons.push('Low confidence signal');
  }

  // Check env quality
  if (verdict.env.confidence >= 0.7) {
    reasons.push('Strong market structure');
  }

  // Check dir alignment
  if (verdict.dir.confidence >= 0.6) {
    reasons.push(`Clear ${verdict.dir.label} signal`);
  }

  return {
    signalStrength: strength,
    tradeable: true,
    reasons,
  };
}

// ═══════════════════════════════════════════════════════════════
// POSITION SIZING (based on verdict quality)
// ═══════════════════════════════════════════════════════════════

export interface PositionSize {
  sizeMultiplier: number; // 0-1, where 1 = full position
  reason: string;
}

export function calculatePositionSize(verdict: ExchangeCombinedVerdict): PositionSize {
  // Not tradeable
  if (!verdict.gate.passed || verdict.action === 'HOLD') {
    return { sizeMultiplier: 0, reason: 'Not tradeable' };
  }

  // Base size on confidence
  // Strong signal: 80-100%
  // Moderate: 50-80%
  // Weak: 20-50%
  
  const envFactor = Math.min(1, verdict.env.confidence + 0.2);
  const dirFactor = verdict.dir.confidence;
  
  const rawSize = envFactor * 0.4 + dirFactor * 0.6;
  const sizeMultiplier = clamp01(rawSize);

  let reason: string;
  if (sizeMultiplier >= 0.7) {
    reason = 'Full position: high confidence';
  } else if (sizeMultiplier >= 0.4) {
    reason = 'Reduced position: moderate confidence';
  } else {
    reason = 'Minimal position: low confidence';
  }

  return { sizeMultiplier, reason };
}

// ═══════════════════════════════════════════════════════════════
// QUALITY-ENHANCED VERDICT (v4.7.0)
// ═══════════════════════════════════════════════════════════════

export interface QualityEnhancedVerdictInput {
  env: ExchangeEnvPrediction;
  dir: ExchangeDirPrediction;
  horizon: Horizon;
  
  // Additional features for quality gate
  atrPct?: number;
  volSpike20?: number;
  emaCrossDist?: number;
  distToVWAP7?: number;
}

export interface QualityEnhancedVerdict extends ExchangeCombinedVerdict {
  qualityGate: QualityDecision;
  finalSizeMultiplier: number;
}

/**
 * Combine verdict with Quality Layer filter.
 * 
 * This is the main function for production use.
 * It first computes the base verdict, then applies the quality filter.
 * 
 * If quality filter blocks the trade, action becomes HOLD.
 * If quality filter allows, size is adjusted by sizeMultiplier.
 */
export function combineVerdictWithQuality(
  input: QualityEnhancedVerdictInput
): QualityEnhancedVerdict {
  const { env, dir, horizon, atrPct, volSpike20, emaCrossDist, distToVWAP7 } = input;
  
  // 1. Get base verdict
  const baseVerdict = combineExchangeVerdict(env, dir);
  
  // 2. If base verdict is already HOLD, skip quality check
  if (baseVerdict.action === 'HOLD') {
    return {
      ...baseVerdict,
      qualityGate: {
        allowTrade: false,
        sizeMultiplier: 0,
        reasons: ['BASE_VERDICT_HOLD: ' + (baseVerdict.gate.reason || 'No trade signal')],
      },
      finalSizeMultiplier: 0,
    };
  }
  
  // 3. Apply Quality Layer
  const qualitySvc = getExchangeTradeQualityService();
  
  const qualityInput: QualityInput = {
    horizon,
    envState: env.label,
    dirProbUp: dir.label === 'UP' ? dir.confidence : (1 - dir.confidence) / 2,
    dirProbDown: dir.label === 'DOWN' ? dir.confidence : (1 - dir.confidence) / 2,
    confidence: baseVerdict.confidence,
    atrPct,
    volSpike20,
    emaCrossDist,
    distToVWAP7,
  };
  
  const qualityDecision = qualitySvc.decide(qualityInput);
  
  // 4. Apply quality decision
  if (!qualityDecision.allowTrade) {
    // Quality filter blocked the trade
    return {
      ...baseVerdict,
      action: 'HOLD',
      confidence: 0,
      gate: {
        passed: false,
        reason: `QUALITY_BLOCKED: ${qualityDecision.reasons.join(', ')}`,
      },
      qualityGate: qualityDecision,
      finalSizeMultiplier: 0,
    };
  }
  
  // 5. Trade allowed - calculate final position size
  const baseSize = calculatePositionSize(baseVerdict);
  const finalSizeMultiplier = baseSize.sizeMultiplier * qualityDecision.sizeMultiplier;
  
  return {
    ...baseVerdict,
    qualityGate: qualityDecision,
    finalSizeMultiplier: clamp01(finalSizeMultiplier),
  };
}

/**
 * Get quality service summary for debugging/UI.
 */
export function getQualityServiceSummary(): string {
  const svc = getExchangeTradeQualityService();
  return svc.getThresholdsSummary();
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

console.log('[Exchange ML] Verdict service loaded (v4.7.0 with Quality Layer)');
