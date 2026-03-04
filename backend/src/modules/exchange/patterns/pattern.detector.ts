/**
 * S10.5 — Pattern Detector (Rules-based Engine)
 * 
 * Evaluates market state against pattern library.
 * 
 * PRINCIPLES:
 * - One market can have MULTIPLE patterns
 * - Patterns CAN conflict (bullish + bearish simultaneously)
 * - NO final decision — just detection
 * - NO signals — just explanation
 */

import { v4 as uuid } from 'uuid';
import {
  ExchangePattern,
  PatternDetectionInput,
  PatternDirection,
  PatternStrength,
  PatternDiagnostics,
} from './pattern.types.js';
import { PATTERN_LIBRARY, getPatternDefinition } from './pattern.library.js';

// ═══════════════════════════════════════════════════════════════
// DETECTION RESULT (internal)
// ═══════════════════════════════════════════════════════════════

interface DetectionResult {
  matched: boolean;
  reason: string;
  conditionsMet: string[];
  conditionsNotMet: string[];
  direction: PatternDirection;
  strength: PatternStrength;
  confidence: number;
  metrics: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════
// MAIN DETECTION FUNCTION
// ═══════════════════════════════════════════════════════════════

export function detectPatterns(input: PatternDetectionInput): ExchangePattern[] {
  const patterns: ExchangePattern[] = [];
  const now = Date.now();

  for (const def of PATTERN_LIBRARY) {
    const result = evaluatePattern(def.id, input);
    
    if (result.matched) {
      patterns.push({
        id: uuid(),
        patternId: def.id,
        symbol: input.symbol,
        name: def.name,
        category: def.category,
        direction: result.direction,
        strength: result.strength,
        confidence: result.confidence,
        conditions: result.conditionsMet,
        metrics: result.metrics,
        detectedAt: now,
        timeframe: def.defaultTimeframe,
      });
    }
  }

  return patterns;
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTICS (for admin)
// ═══════════════════════════════════════════════════════════════

export function detectPatternsWithDiagnostics(input: PatternDetectionInput): PatternDiagnostics {
  const startTime = Date.now();
  const evaluated: PatternDiagnostics['evaluated'] = [];
  const detectedPatterns: ExchangePattern[] = [];

  for (const def of PATTERN_LIBRARY) {
    const result = evaluatePattern(def.id, input);
    
    evaluated.push({
      patternId: def.id,
      name: def.name,
      matched: result.matched,
      reason: result.reason,
      conditionsMet: result.conditionsMet,
      conditionsNotMet: result.conditionsNotMet,
    });
    
    if (result.matched) {
      detectedPatterns.push({
        id: uuid(),
        patternId: def.id,
        symbol: input.symbol,
        name: def.name,
        category: def.category,
        direction: result.direction,
        strength: result.strength,
        confidence: result.confidence,
        conditions: result.conditionsMet,
        metrics: result.metrics,
        detectedAt: startTime,
        timeframe: def.defaultTimeframe,
      });
    }
  }

  return {
    symbol: input.symbol,
    input,
    evaluated,
    detectedPatterns,
    evaluatedAt: startTime,
    durationMs: Date.now() - startTime,
  };
}

// ═══════════════════════════════════════════════════════════════
// PATTERN EVALUATION (per pattern)
// ═══════════════════════════════════════════════════════════════

function evaluatePattern(patternId: string, input: PatternDetectionInput): DetectionResult {
  const def = getPatternDefinition(patternId);
  if (!def) {
    return notMatched('Pattern definition not found');
  }

  switch (patternId) {
    // ─────────────────────────────────────────────────────────────
    // FLOW PATTERNS
    // ─────────────────────────────────────────────────────────────
    case 'FLOW_AGGRESSIVE_BUY_ABSORPTION':
      return evaluateAggressiveBuyAbsorption(input, def.thresholds);
    
    case 'FLOW_AGGRESSIVE_SELL_ABSORPTION':
      return evaluateAggressiveSellAbsorption(input, def.thresholds);
    
    case 'FLOW_BUYER_EXHAUSTION':
      return evaluateBuyerExhaustion(input, def.thresholds);
    
    case 'FLOW_SELLER_EXHAUSTION':
      return evaluateSellerExhaustion(input, def.thresholds);

    // ─────────────────────────────────────────────────────────────
    // OI PATTERNS
    // ─────────────────────────────────────────────────────────────
    case 'OI_EXPANSION_FLAT_PRICE':
      return evaluateOiExpansionFlatPrice(input, def.thresholds);
    
    case 'OI_COLLAPSE_AFTER_EXPANSION':
      return evaluateOiCollapseAfterExpansion(input, def.thresholds);
    
    case 'OI_DIVERGENCE_PRICE':
      return evaluateOiDivergencePrice(input, def.thresholds);

    // ─────────────────────────────────────────────────────────────
    // LIQUIDATION PATTERNS
    // ─────────────────────────────────────────────────────────────
    case 'LIQ_LONG_SQUEEZE_CONTINUATION':
      return evaluateLongSqueezeContinuation(input, def.thresholds);
    
    case 'LIQ_SHORT_SQUEEZE_EXHAUSTION':
      return evaluateShortSqueezeExhaustion(input, def.thresholds);
    
    case 'LIQ_CASCADE_EXHAUSTION_ZONE':
      return evaluateCascadeExhaustionZone(input, def.thresholds);

    // ─────────────────────────────────────────────────────────────
    // VOLUME PATTERNS
    // ─────────────────────────────────────────────────────────────
    case 'VOL_SPIKE_NO_FOLLOWTHROUGH':
      return evaluateVolumeSpikeNoFollowthrough(input, def.thresholds);
    
    case 'VOL_COMPRESSION':
      return evaluateVolumeCompression(input, def.thresholds);

    // ─────────────────────────────────────────────────────────────
    // STRUCTURE PATTERNS
    // ─────────────────────────────────────────────────────────────
    case 'STRUCT_RANGE_TRAP':
      return evaluateRangeTrap(input, def.thresholds);
    
    case 'STRUCT_TREND_ACCEPTANCE':
      return evaluateTrendAcceptance(input, def.thresholds);

    default:
      return notMatched('No evaluation logic for pattern');
  }
}

// ═══════════════════════════════════════════════════════════════
// FLOW PATTERN EVALUATORS
// ═══════════════════════════════════════════════════════════════

function evaluateAggressiveBuyAbsorption(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  // Check buy dominance
  const buyDominance = input.orderFlow?.aggressor === 'BUYER' ? input.orderFlow.dominance : 0;
  if (buyDominance >= thresholds.minBuyDominance) {
    conditionsMet.push(`Buy dominance ${(buyDominance * 100).toFixed(0)}% >= ${thresholds.minBuyDominance * 100}%`);
  } else {
    conditionsNotMet.push(`Buy dominance ${(buyDominance * 100).toFixed(0)}% < ${thresholds.minBuyDominance * 100}%`);
  }
  
  // Check price stability
  const priceChange = Math.abs(input.price?.deltaPct || 0);
  if (priceChange <= thresholds.maxPriceChange) {
    conditionsMet.push(`Price change ${priceChange.toFixed(2)}% <= ${thresholds.maxPriceChange}%`);
  } else {
    conditionsNotMet.push(`Price change ${priceChange.toFixed(2)}% > ${thresholds.maxPriceChange}%`);
  }
  
  // Check absorption
  const absorptionStrength = input.absorption?.strength || 0;
  const absorptionOnAsk = input.absorption?.side === 'ASK';
  if (absorptionStrength >= thresholds.minAbsorptionStrength && absorptionOnAsk) {
    conditionsMet.push(`Absorption on ASK side, strength ${(absorptionStrength * 100).toFixed(0)}%`);
  } else {
    conditionsNotMet.push(`No strong ASK absorption detected`);
  }

  const matched = conditionsNotMet.length === 0 && conditionsMet.length >= 2;
  const confidence = matched ? Math.min(0.95, 0.5 + buyDominance * 0.3 + absorptionStrength * 0.2) : 0;

  return {
    matched,
    reason: matched ? 'Heavy buy pressure absorbed by passive sellers' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction: 'BEARISH',  // Absorption of buying = bearish implication
    strength: confidence > 0.8 ? 'STRONG' : confidence > 0.6 ? 'MEDIUM' : 'WEAK',
    confidence,
    metrics: { buyDominance, priceChange, absorptionStrength },
  };
}

function evaluateAggressiveSellAbsorption(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  const sellDominance = input.orderFlow?.aggressor === 'SELLER' ? input.orderFlow.dominance : 0;
  if (sellDominance >= thresholds.minSellDominance) {
    conditionsMet.push(`Sell dominance ${(sellDominance * 100).toFixed(0)}% >= ${thresholds.minSellDominance * 100}%`);
  } else {
    conditionsNotMet.push(`Sell dominance ${(sellDominance * 100).toFixed(0)}% < ${thresholds.minSellDominance * 100}%`);
  }
  
  const priceChange = Math.abs(input.price?.deltaPct || 0);
  if (priceChange <= thresholds.maxPriceChange) {
    conditionsMet.push(`Price change ${priceChange.toFixed(2)}% <= ${thresholds.maxPriceChange}%`);
  } else {
    conditionsNotMet.push(`Price change ${priceChange.toFixed(2)}% > ${thresholds.maxPriceChange}%`);
  }
  
  const absorptionStrength = input.absorption?.strength || 0;
  const absorptionOnBid = input.absorption?.side === 'BID';
  if (absorptionStrength >= thresholds.minAbsorptionStrength && absorptionOnBid) {
    conditionsMet.push(`Absorption on BID side, strength ${(absorptionStrength * 100).toFixed(0)}%`);
  } else {
    conditionsNotMet.push(`No strong BID absorption detected`);
  }

  const matched = conditionsNotMet.length === 0 && conditionsMet.length >= 2;
  const confidence = matched ? Math.min(0.95, 0.5 + sellDominance * 0.3 + absorptionStrength * 0.2) : 0;

  return {
    matched,
    reason: matched ? 'Heavy sell pressure absorbed by passive buyers' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction: 'BULLISH',  // Absorption of selling = bullish implication
    strength: confidence > 0.8 ? 'STRONG' : confidence > 0.6 ? 'MEDIUM' : 'WEAK',
    confidence,
    metrics: { sellDominance, priceChange, absorptionStrength },
  };
}

function evaluateBuyerExhaustion(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  const dominance = input.orderFlow?.dominance || 0;
  const isBuyer = input.orderFlow?.aggressor === 'BUYER';
  const intensity = input.orderFlow?.intensity || 'LOW';
  
  // Weakening buy dominance
  if (!isBuyer || dominance <= thresholds.maxBuyDominance) {
    conditionsMet.push(`Buy dominance weakened to ${(dominance * 100).toFixed(0)}%`);
  } else {
    conditionsNotMet.push(`Buy dominance still strong at ${(dominance * 100).toFixed(0)}%`);
  }
  
  // Volume ratio check (using volume data)
  const volumeRatio = input.volume?.ratio || 1;
  if (volumeRatio < 0.8) {
    conditionsMet.push(`Volume dropping (${(volumeRatio * 100).toFixed(0)}% of average)`);
  } else {
    conditionsNotMet.push(`Volume still elevated`);
  }
  
  // Intensity dropping
  if (intensity === 'LOW' || intensity === 'MEDIUM') {
    conditionsMet.push(`Flow intensity: ${intensity}`);
  } else {
    conditionsNotMet.push(`Flow intensity still ${intensity}`);
  }

  const matched = conditionsMet.length >= 2;
  const confidence = matched ? 0.6 + (1 - dominance) * 0.3 : 0;

  return {
    matched,
    reason: matched ? 'Buy pressure fading after sustained buying' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction: 'BEARISH',
    strength: confidence > 0.75 ? 'MEDIUM' : 'WEAK',
    confidence,
    metrics: { dominance, volumeRatio, intensity },
  };
}

function evaluateSellerExhaustion(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  const dominance = input.orderFlow?.dominance || 0;
  const isSeller = input.orderFlow?.aggressor === 'SELLER';
  const intensity = input.orderFlow?.intensity || 'LOW';
  
  if (!isSeller || dominance <= thresholds.maxSellDominance) {
    conditionsMet.push(`Sell dominance weakened to ${(dominance * 100).toFixed(0)}%`);
  } else {
    conditionsNotMet.push(`Sell dominance still strong at ${(dominance * 100).toFixed(0)}%`);
  }
  
  const volumeRatio = input.volume?.ratio || 1;
  if (volumeRatio < 0.8) {
    conditionsMet.push(`Volume dropping (${(volumeRatio * 100).toFixed(0)}% of average)`);
  } else {
    conditionsNotMet.push(`Volume still elevated`);
  }
  
  if (intensity === 'LOW' || intensity === 'MEDIUM') {
    conditionsMet.push(`Flow intensity: ${intensity}`);
  } else {
    conditionsNotMet.push(`Flow intensity still ${intensity}`);
  }

  const matched = conditionsMet.length >= 2;
  const confidence = matched ? 0.6 + (1 - dominance) * 0.3 : 0;

  return {
    matched,
    reason: matched ? 'Sell pressure fading after sustained selling' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction: 'BULLISH',
    strength: confidence > 0.75 ? 'MEDIUM' : 'WEAK',
    confidence,
    metrics: { dominance, volumeRatio, intensity },
  };
}

// ═══════════════════════════════════════════════════════════════
// OI PATTERN EVALUATORS
// ═══════════════════════════════════════════════════════════════

function evaluateOiExpansionFlatPrice(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  const oiDeltaPct = input.oi?.deltaPct || 0;
  const priceDeltaPct = Math.abs(input.price?.deltaPct || 0);
  
  if (oiDeltaPct >= thresholds.minOiChangePct) {
    conditionsMet.push(`OI grew ${oiDeltaPct.toFixed(1)}% >= ${thresholds.minOiChangePct}%`);
  } else {
    conditionsNotMet.push(`OI change ${oiDeltaPct.toFixed(1)}% < ${thresholds.minOiChangePct}%`);
  }
  
  if (priceDeltaPct <= thresholds.maxPriceChangePct) {
    conditionsMet.push(`Price flat: ${priceDeltaPct.toFixed(2)}% <= ${thresholds.maxPriceChangePct}%`);
  } else {
    conditionsNotMet.push(`Price moved ${priceDeltaPct.toFixed(2)}%`);
  }

  const matched = conditionsNotMet.length === 0;
  const confidence = matched ? Math.min(0.9, 0.5 + oiDeltaPct * 0.05) : 0;

  return {
    matched,
    reason: matched ? 'New positions building without directional move' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction: 'NEUTRAL',  // Buildup, direction unknown
    strength: oiDeltaPct > 10 ? 'STRONG' : oiDeltaPct > 7 ? 'MEDIUM' : 'WEAK',
    confidence,
    metrics: { oiDeltaPct, priceDeltaPct },
  };
}

function evaluateOiCollapseAfterExpansion(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  const oiDeltaPct = input.oi?.deltaPct || 0;
  
  // Looking for negative OI delta
  if (oiDeltaPct <= -thresholds.minOiDropPct) {
    conditionsMet.push(`OI dropped ${Math.abs(oiDeltaPct).toFixed(1)}% >= ${thresholds.minOiDropPct}%`);
  } else {
    conditionsNotMet.push(`OI change ${oiDeltaPct.toFixed(1)}% (need ${-thresholds.minOiDropPct}% drop)`);
  }
  
  // Check regime for context
  const regime = input.regime?.type || 'NEUTRAL';
  if (regime === 'DISTRIBUTION' || regime === 'EXHAUSTION') {
    conditionsMet.push(`Regime context: ${regime}`);
  }

  const matched = conditionsNotMet.length === 0;
  const confidence = matched ? Math.min(0.85, 0.6 + Math.abs(oiDeltaPct) * 0.03) : 0;

  return {
    matched,
    reason: matched ? 'Positions being closed en masse' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction: 'NEUTRAL',  // Collapse can precede either direction
    strength: Math.abs(oiDeltaPct) > 12 ? 'STRONG' : 'MEDIUM',
    confidence,
    metrics: { oiDeltaPct, regime },
  };
}

function evaluateOiDivergencePrice(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  const oiDeltaPct = input.oi?.deltaPct || 0;
  const priceDeltaPct = input.price?.deltaPct || 0;
  
  // Check for significant price move
  if (Math.abs(priceDeltaPct) >= thresholds.minPriceChangePct) {
    conditionsMet.push(`Price moved ${priceDeltaPct.toFixed(2)}%`);
  } else {
    conditionsNotMet.push(`Price change ${priceDeltaPct.toFixed(2)}% < ${thresholds.minPriceChangePct}%`);
  }
  
  // Check for significant OI change
  if (Math.abs(oiDeltaPct) >= thresholds.minOiChangePct) {
    conditionsMet.push(`OI changed ${oiDeltaPct.toFixed(1)}%`);
  } else {
    conditionsNotMet.push(`OI change ${oiDeltaPct.toFixed(1)}% < ${thresholds.minOiChangePct}%`);
  }
  
  // Check for divergence (opposite signs)
  const isDivergent = (priceDeltaPct > 0 && oiDeltaPct < 0) || (priceDeltaPct < 0 && oiDeltaPct > 0);
  if (isDivergent) {
    conditionsMet.push(`Divergence: Price ${priceDeltaPct > 0 ? 'up' : 'down'}, OI ${oiDeltaPct > 0 ? 'up' : 'down'}`);
  } else {
    conditionsNotMet.push(`No divergence: Price and OI moving same direction`);
  }

  const matched = conditionsNotMet.length === 0;
  const confidence = matched ? 0.7 : 0;
  
  // Direction depends on price direction (divergence suggests weakness)
  const direction: PatternDirection = priceDeltaPct > 0 ? 'BEARISH' : 'BULLISH';

  return {
    matched,
    reason: matched ? 'Price and OI moving opposite - potential trend weakness' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction,
    strength: 'MEDIUM',
    confidence,
    metrics: { oiDeltaPct, priceDeltaPct, isDivergent },
  };
}

// ═══════════════════════════════════════════════════════════════
// LIQUIDATION PATTERN EVALUATORS
// ═══════════════════════════════════════════════════════════════

function evaluateLongSqueezeContinuation(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  const active = input.liquidation?.active || false;
  const direction = input.liquidation?.direction;
  const phase = input.liquidation?.phase || '';
  
  if (active) {
    conditionsMet.push('Cascade active');
  } else {
    conditionsNotMet.push('No active cascade');
  }
  
  if (direction === 'LONG') {
    conditionsMet.push('Direction: LONG liquidations');
  } else {
    conditionsNotMet.push(`Direction: ${direction || 'none'} (need LONG)`);
  }
  
  const activePhases = ['START', 'ACTIVE', 'PEAK'];
  if (activePhases.includes(phase)) {
    conditionsMet.push(`Phase: ${phase}`);
  } else {
    conditionsNotMet.push(`Phase: ${phase} (need START/ACTIVE/PEAK)`);
  }

  const matched = conditionsNotMet.length === 0;
  const confidence = matched ? (phase === 'PEAK' ? 0.9 : phase === 'ACTIVE' ? 0.8 : 0.65) : 0;

  return {
    matched,
    reason: matched ? 'Long liquidations cascading, price continuing down' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction: 'BEARISH',
    strength: phase === 'PEAK' ? 'STRONG' : 'MEDIUM',
    confidence,
    metrics: { active, direction, phase },
  };
}

function evaluateShortSqueezeExhaustion(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  const active = input.liquidation?.active || false;
  const direction = input.liquidation?.direction;
  const phase = input.liquidation?.phase || '';
  
  if (active || phase === 'DECAY' || phase === 'END') {
    conditionsMet.push('Cascade active or recently ended');
  } else {
    conditionsNotMet.push('No cascade context');
  }
  
  if (direction === 'SHORT') {
    conditionsMet.push('Direction: SHORT liquidations');
  } else {
    conditionsNotMet.push(`Direction: ${direction || 'none'} (need SHORT)`);
  }
  
  if (phase === 'DECAY' || phase === 'END') {
    conditionsMet.push(`Phase: ${phase} (exhaustion)`);
  } else {
    conditionsNotMet.push(`Phase: ${phase} (need DECAY/END)`);
  }

  const matched = conditionsNotMet.length === 0;
  const confidence = matched ? 0.75 : 0;

  return {
    matched,
    reason: matched ? 'Short squeeze losing momentum' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction: 'BEARISH',  // Exhaustion of short squeeze = potential reversal down
    strength: 'MEDIUM',
    confidence,
    metrics: { active, direction, phase },
  };
}

function evaluateCascadeExhaustionZone(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  const phase = input.liquidation?.phase || '';
  const intensity = input.liquidation?.intensity || 'LOW';
  
  if (phase === 'END' || phase === 'DECAY') {
    conditionsMet.push(`Cascade phase: ${phase}`);
  } else {
    conditionsNotMet.push(`Cascade phase: ${phase} (need END/DECAY)`);
  }
  
  // Prior intensity should have been high
  const wasIntense = intensity === 'HIGH' || intensity === 'EXTREME' || 
                     (input.liquidation?.volumeUsd || 0) > 100000;
  if (wasIntense) {
    conditionsMet.push(`Prior intensity: ${intensity}`);
  }

  const matched = phase === 'END' || phase === 'DECAY';
  const confidence = matched ? 0.7 : 0;

  return {
    matched,
    reason: matched ? 'Liquidation cascade ending, market stabilizing' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction: 'NEUTRAL',  // After cascade = potential reversal zone
    strength: 'MEDIUM',
    confidence,
    metrics: { phase, intensity },
  };
}

// ═══════════════════════════════════════════════════════════════
// VOLUME PATTERN EVALUATORS
// ═══════════════════════════════════════════════════════════════

function evaluateVolumeSpikeNoFollowthrough(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  const volumeRatio = input.volume?.ratio || 1;
  const priceDeltaPct = Math.abs(input.price?.deltaPct || 0);
  
  if (volumeRatio >= thresholds.minVolumeRatio) {
    conditionsMet.push(`Volume spike: ${volumeRatio.toFixed(1)}x average`);
  } else {
    conditionsNotMet.push(`Volume ratio ${volumeRatio.toFixed(1)}x < ${thresholds.minVolumeRatio}x`);
  }
  
  if (priceDeltaPct <= thresholds.maxPriceChangePct) {
    conditionsMet.push(`Price returned to flat: ${priceDeltaPct.toFixed(2)}%`);
  } else {
    conditionsNotMet.push(`Price moved ${priceDeltaPct.toFixed(2)}%`);
  }

  const matched = conditionsNotMet.length === 0;
  const confidence = matched ? Math.min(0.85, 0.5 + volumeRatio * 0.15) : 0;

  return {
    matched,
    reason: matched ? 'Volume spike but price returned - failed move / liquidity grab' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction: 'NEUTRAL',  // Failed move in either direction
    strength: volumeRatio > 3 ? 'STRONG' : 'MEDIUM',
    confidence,
    metrics: { volumeRatio, priceDeltaPct },
  };
}

function evaluateVolumeCompression(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  const volumeRatio = input.volume?.ratio || 1;
  
  if (volumeRatio <= thresholds.maxVolumeRatio) {
    conditionsMet.push(`Volume compressed: ${(volumeRatio * 100).toFixed(0)}% of average`);
  } else {
    conditionsNotMet.push(`Volume ${(volumeRatio * 100).toFixed(0)}% > ${thresholds.maxVolumeRatio * 100}% threshold`);
  }
  
  // Check regime for consolidation context
  const regime = input.regime?.type || 'NEUTRAL';
  if (regime === 'ACCUMULATION' || regime === 'NEUTRAL') {
    conditionsMet.push(`Regime: ${regime} (consolidation context)`);
  }

  const matched = conditionsNotMet.length === 0;
  const confidence = matched ? 0.65 : 0;

  return {
    matched,
    reason: matched ? 'Low volume consolidation - potential breakout ahead' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction: 'NEUTRAL',
    strength: 'WEAK',
    confidence,
    metrics: { volumeRatio, regime },
  };
}

// ═══════════════════════════════════════════════════════════════
// STRUCTURE PATTERN EVALUATORS
// ═══════════════════════════════════════════════════════════════

function evaluateRangeTrap(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  // Use regime context to detect false breakouts
  const regime = input.regime?.type || 'NEUTRAL';
  const priceDeltaPct = input.price?.deltaPct || 0;
  const volumeRatio = input.volume?.ratio || 1;
  
  // Range trap indicators:
  // - Price spiked then reversed (small final delta)
  // - Volume elevated on reversal
  // - Not in expansion regime
  
  const priceReversed = Math.abs(priceDeltaPct) < 0.5;
  if (priceReversed && volumeRatio > 1.2) {
    conditionsMet.push(`Price reversed to ${priceDeltaPct.toFixed(2)}% with ${volumeRatio.toFixed(1)}x volume`);
  } else {
    conditionsNotMet.push(`No reversal pattern detected`);
  }
  
  if (regime !== 'EXPANSION') {
    conditionsMet.push(`Not in expansion (regime: ${regime})`);
  } else {
    conditionsNotMet.push(`In expansion regime - likely real breakout`);
  }

  const matched = conditionsMet.length >= 2 && conditionsNotMet.length === 0;
  const confidence = matched ? 0.7 : 0;
  
  // Direction: opposite of the failed breakout
  const direction: PatternDirection = priceDeltaPct > 0 ? 'BEARISH' : priceDeltaPct < 0 ? 'BULLISH' : 'NEUTRAL';

  return {
    matched,
    reason: matched ? 'False breakout - price reversed after breaking range' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction,
    strength: 'MEDIUM',
    confidence,
    metrics: { priceDeltaPct, volumeRatio, regime },
  };
}

function evaluateTrendAcceptance(input: PatternDetectionInput, thresholds: Record<string, number>): DetectionResult {
  const conditionsMet: string[] = [];
  const conditionsNotMet: string[] = [];
  
  const regime = input.regime?.type || 'NEUTRAL';
  const priceDeltaPct = input.price?.deltaPct || 0;
  const regimeConfidence = input.regime?.confidence || 0;
  
  // Trend acceptance: 
  // - In expansion regime
  // - Clear directional move
  // - High confidence
  
  if (regime === 'EXPANSION') {
    conditionsMet.push(`Expansion regime`);
  } else {
    conditionsNotMet.push(`Not in expansion (regime: ${regime})`);
  }
  
  if (Math.abs(priceDeltaPct) >= 1) {
    conditionsMet.push(`Directional move: ${priceDeltaPct.toFixed(2)}%`);
  } else {
    conditionsNotMet.push(`Price move ${priceDeltaPct.toFixed(2)}% too small`);
  }
  
  if (regimeConfidence >= 0.6) {
    conditionsMet.push(`High regime confidence: ${(regimeConfidence * 100).toFixed(0)}%`);
  }

  const matched = regime === 'EXPANSION' && Math.abs(priceDeltaPct) >= 1;
  const confidence = matched ? regimeConfidence : 0;
  const direction: PatternDirection = priceDeltaPct > 0 ? 'BULLISH' : 'BEARISH';

  return {
    matched,
    reason: matched ? 'Market accepting new range after breakout' : conditionsNotMet.join('; '),
    conditionsMet,
    conditionsNotMet,
    direction,
    strength: regimeConfidence > 0.8 ? 'STRONG' : 'MEDIUM',
    confidence,
    metrics: { regime, priceDeltaPct, regimeConfidence },
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function notMatched(reason: string): DetectionResult {
  return {
    matched: false,
    reason,
    conditionsMet: [],
    conditionsNotMet: [reason],
    direction: 'NEUTRAL',
    strength: 'WEAK',
    confidence: 0,
    metrics: {},
  };
}
