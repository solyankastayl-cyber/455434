/**
 * B4 — Exchange Verdict Engine
 * 
 * Deterministic rules for BULLISH/BEARISH/NEUTRAL verdict.
 * NO ML, NO AI — only transparent logic.
 */

import {
  ExchangeVerdict,
  ExchangeVerdictDebug,
  Verdict,
  Strength,
  VerdictGuards,
} from './verdict.types.js';
import { MarketContext } from '../context/context.types.js';
import { computeBullBearScores, strengthFromConfidence } from './verdict.scoring.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS (LOCKED v1)
// ═══════════════════════════════════════════════════════════════

const THRESHOLDS = {
  BULLISH_DELTA: 0.10,  // Lowered from 0.20 for more signals
  BEARISH_DELTA: -0.10, // Lowered from -0.20 for more signals
  WHALE_LIFT_GUARD: 1.2,
  MIN_CONFIDENCE_FOR_VERDICT: 0.30, // Lowered from 0.35
} as const;

// ═══════════════════════════════════════════════════════════════
// BUILD VERDICT
// ═══════════════════════════════════════════════════════════════

export function buildExchangeVerdict(ctx: MarketContext): ExchangeVerdictDebug {
  const now = new Date().toISOString();
  
  const reasonsBull: string[] = [];
  const reasonsBear: string[] = [];
  const blockers: string[] = [];
  const boosts: string[] = [];
  const penalties: string[] = [];
  
  const guards: VerdictGuards = {
    blockedByWhaleRisk: false,
    blockedByCascadeRisk: false,
    blockedByConflict: false,
    blockedByReadiness: false,
  };
  
  // ─────────────────────────────────────────────────────────────
  // 1) Gate: Readiness
  // ─────────────────────────────────────────────────────────────
  
  if (ctx.readiness.status === 'NO_DATA') {
    blockers.push('READINESS_NO_DATA');
    guards.blockedByReadiness = true;
    
    return createNeutralVerdict(ctx, {
      blockers,
      penalties,
      boosts,
      guards,
      confidence: 0.2,
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // 2) Core scoring
  // ─────────────────────────────────────────────────────────────
  
  const axes = {
    momentum: ctx.axes.momentum,
    structure: ctx.axes.structure,
    participation: ctx.axes.participation,
    orderbookPressure: ctx.axes.orderbookPressure,
    positioning: ctx.axes.positioning,
    marketStress: ctx.axes.marketStress,
  };
  
  const { bullScore, bearScore, delta } = computeBullBearScores(axes);
  
  // Base confidence: how separated are scores + readiness
  let confidence = clamp01(0.25 + Math.abs(delta) * 0.9);
  confidence = clamp01(confidence * (0.6 + 0.4 * clamp01(ctx.readiness.score)));
  
  // ─────────────────────────────────────────────────────────────
  // 3) Determine verdict by delta
  // ─────────────────────────────────────────────────────────────
  
  let verdict: Verdict = 'NEUTRAL';
  if (delta >= THRESHOLDS.BULLISH_DELTA) verdict = 'BULLISH';
  else if (delta <= THRESHOLDS.BEARISH_DELTA) verdict = 'BEARISH';
  
  // ─────────────────────────────────────────────────────────────
  // 4) Generate reasons from axes
  // ─────────────────────────────────────────────────────────────
  
  const ax = ctx.axes;
  
  if (verdict === 'BULLISH') {
    if (ax.momentum > 0.25) reasonsBull.push('momentum_positive');
    if (ax.structure > 0.2) reasonsBull.push('structure_supportive');
    if (ax.participation > 0.6) reasonsBull.push('participation_strong');
    if (ax.orderbookPressure > 0.2) reasonsBull.push('bid_pressure');
    if (ax.marketStress < 0.35) reasonsBull.push('stress_low');
    if (ax.positioning < 0.4) reasonsBull.push('crowding_low');
  } else if (verdict === 'BEARISH') {
    if (ax.momentum < -0.25) reasonsBear.push('momentum_negative');
    if (ax.structure < -0.2) reasonsBear.push('structure_breakdown');
    if (ax.participation < 0.3) reasonsBear.push('participation_weak');
    if (ax.orderbookPressure < -0.2) reasonsBear.push('ask_pressure');
    if (ax.marketStress > 0.65) reasonsBear.push('stress_high');
    if (ax.positioning > 0.7) reasonsBear.push('crowding_high');
  } else {
    if (Math.abs(ax.momentum) < 0.15) blockers.push('momentum_unclear');
    if (ax.marketStress > 0.5 && ax.marketStress < 0.65) blockers.push('stress_elevated');
  }
  
  // ─────────────────────────────────────────────────────────────
  // 5) Regime boosts
  // ─────────────────────────────────────────────────────────────
  
  if (ctx.regime?.type) {
    const regimeType = String(ctx.regime.type).toUpperCase();
    
    if (verdict === 'BULLISH' && ['ACCUMULATION', 'EXPANSION'].includes(regimeType)) {
      confidence = clamp01(confidence + 0.08 * clamp01(ctx.regime.confidence));
      boosts.push('regime_support_bullish');
    }
    if (verdict === 'BEARISH' && ['EXHAUSTION', 'SQUEEZE', 'DISTRIBUTION'].includes(regimeType)) {
      confidence = clamp01(confidence + 0.08 * clamp01(ctx.regime.confidence));
      boosts.push('regime_support_bearish');
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // 6) Readiness penalty
  // ─────────────────────────────────────────────────────────────
  
  if (ctx.readiness.status === 'DEGRADED') {
    blockers.push('READINESS_DEGRADED');
    confidence = clamp01(confidence * 0.7);
    penalties.push('readiness_penalty');
    guards.blockedByReadiness = true;
  }
  
  // ─────────────────────────────────────────────────────────────
  // 7) Whale guard (hard rule)
  // ─────────────────────────────────────────────────────────────
  
  const whaleHigh = ctx.whaleRisk.bucket === 'HIGH';
  const whaleLiftOk = (ctx.whaleRisk.lift ?? 1) >= THRESHOLDS.WHALE_LIFT_GUARD;
  
  if (whaleHigh && whaleLiftOk) {
    blockers.push('WHALE_RISK_GUARD');
    confidence = clamp01(confidence * 0.6);
    penalties.push('whale_guard_penalty');
    guards.blockedByWhaleRisk = true;
    
    // STRONG forbidden, and neutralize if confidence too low
    if (confidence < THRESHOLDS.MIN_CONFIDENCE_FOR_VERDICT) {
      verdict = 'NEUTRAL';
      blockers.push('whale_guard_neutralized');
    }
  }
  
  // Add whale pattern if active
  if (ctx.whaleRisk.activePattern) {
    blockers.push(`whale_pattern_${ctx.whaleRisk.activePattern}`);
    if (ctx.whaleRisk.activePattern === 'FORCED_SQUEEZE_RISK') {
      guards.blockedByCascadeRisk = true;
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // 8) Strength + STRONG restrictions
  // ─────────────────────────────────────────────────────────────
  
  let strength = strengthFromConfidence(confidence);
  if (strength === 'STRONG' && (ctx.readiness.status !== 'READY' || (whaleHigh && whaleLiftOk))) {
    strength = 'MEDIUM';
    blockers.push('strong_blocked_by_guard');
  }
  
  // ─────────────────────────────────────────────────────────────
  // 9) Build output
  // ─────────────────────────────────────────────────────────────
  
  const evidence = {
    regime: ctx.regime ? { type: ctx.regime.type, confidence: ctx.regime.confidence } : null,
    stress: ctx.axes.marketStress,
    whales: {
      netBias: ctx.whaleRisk.netBias !== undefined 
        ? (ctx.whaleRisk.netBias > 0.1 ? 'LONG' : ctx.whaleRisk.netBias < -0.1 ? 'SHORT' : 'MIXED')
        : 'UNKNOWN',
      riskBucket: ctx.whaleRisk.bucket,
      lift: ctx.whaleRisk.lift,
    },
    patterns: ctx.patterns.map(p => p.id),
  };
  
  return {
    symbol: ctx.symbol,
    exchange: ctx.exchange,
    
    verdict,
    confidence,
    strength,
    
    reasons: {
      bullish: reasonsBull,
      bearish: reasonsBear,
      blockers,
    },
    evidence,
    guards,
    
    axisContrib: axes,
    
    readiness: ctx.readiness,
    contextRefs: { updatedAt: ctx.updatedAt },
    updatedAt: now,
    
    debug: {
      bullScore,
      bearScore,
      delta,
      penalties,
      boosts,
      thresholds: {
        bullishDelta: THRESHOLDS.BULLISH_DELTA,
        bearishDelta: THRESHOLDS.BEARISH_DELTA,
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Create neutral verdict for edge cases
// ═══════════════════════════════════════════════════════════════

function createNeutralVerdict(
  ctx: MarketContext,
  opts: {
    blockers: string[];
    penalties: string[];
    boosts: string[];
    guards: VerdictGuards;
    confidence: number;
  }
): ExchangeVerdictDebug {
  return {
    symbol: ctx.symbol,
    exchange: ctx.exchange,
    
    verdict: 'NEUTRAL',
    confidence: opts.confidence,
    strength: 'WEAK',
    
    reasons: {
      bullish: [],
      bearish: [],
      blockers: opts.blockers,
    },
    evidence: {
      regime: null,
      stress: ctx.axes.marketStress,
      whales: {
        netBias: 'UNKNOWN',
        riskBucket: ctx.whaleRisk.bucket,
      },
      patterns: [],
    },
    guards: opts.guards,
    
    axisContrib: ctx.axes,
    readiness: ctx.readiness,
    contextRefs: { updatedAt: ctx.updatedAt },
    updatedAt: new Date().toISOString(),
    
    debug: {
      bullScore: 0,
      bearScore: 0,
      delta: 0,
      penalties: opts.penalties,
      boosts: opts.boosts,
      thresholds: {
        bullishDelta: THRESHOLDS.BULLISH_DELTA,
        bearishDelta: THRESHOLDS.BEARISH_DELTA,
      },
    },
  };
}

console.log('[B4] Verdict Engine loaded');
