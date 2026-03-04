/**
 * Phase R Pattern Detectors Adapter
 * 
 * Wraps Phase R pattern detectors to work with the existing detector registry.
 * This allows the new pattern detection code to integrate seamlessly.
 */

import { Detector, TAContext, CandidatePattern, Candle } from '../domain/types.js';
import { runReversalDetectors } from '../patterns/reversals/index.js';
import { runHarmonicDetectors } from '../patterns/harmonics/index.js';
import { runCandleDetectors } from '../patterns/candles/index.js';
import { runMarketStructureDetectors } from '../patterns/market_structure/index.js';
import { PatternInput, PatternResult, Pivot } from '../patterns/utils/pattern_types.js';

/**
 * Convert TAContext candles to PatternInput format
 */
function toPatternInput(ctx: TAContext): PatternInput {
  const candles = ctx.series.candles.map(c => ({
    t: c.ts,
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: c.volume,
  }));
  
  // Convert pivots
  const pivots: Pivot[] = ctx.pivots.map(p => ({
    index: ctx.series.candles.findIndex(c => c.ts === p.ts),
    price: p.price,
    kind: p.type === 'HIGH' ? 'HIGH' : 'LOW',
    strength: p.strength,
  }));
  
  return {
    asset: ctx.series.asset,
    timeframe: ctx.series.tf,
    candles,
    pivots,
    levels: ctx.levels.map(l => l.price),
  };
}

/**
 * Convert PatternResult to CandidatePattern
 */
function toCandidatePattern(result: PatternResult, ctx: TAContext): CandidatePattern {
  const lastCandle = ctx.series.candles[ctx.series.candles.length - 1];
  const startCandle = ctx.series.candles[result.startIndex] || lastCandle;
  const endCandle = ctx.series.candles[result.endIndex] || lastCandle;
  
  return {
    id: `${result.type}_${startCandle?.ts || Date.now()}`,
    ts: endCandle?.ts || Date.now(),
    type: result.type,
    direction: result.direction === 'BULL' ? 'BULL' : result.direction === 'BEAR' ? 'BEAR' : 'BULL',
    keyPrices: {
      entry: lastCandle?.close || 0,
      stop: result.priceLevels?.[1] || lastCandle?.low || 0,
      target: result.priceLevels?.[0] || lastCandle?.high || 0,
    },
    metrics: {
      totalScore: result.confidence,
      geometryScore: result.confidence * 0.6,
      volumeScore: 0.5,
      structureScore: result.confidence * 0.4,
      levelScore: 0.5,
      recencyScore: 0.8,
      note: `Phase R: ${result.type} detected`,
    },
    meta: result.meta || {},
  };
}

// ═══════════════════════════════════════════════════════════════
// Phase R4: Reversal Patterns Detector
// ═══════════════════════════════════════════════════════════════

export class PhaseR4ReversalDetector implements Detector {
  id = 'phase_r4_reversals';
  name = 'Phase R4 Reversal Patterns';
  version = '1.0.0';
  types = ['TRIPLE_TOP', 'TRIPLE_BOTTOM', 'ROUNDING_TOP', 'ROUNDING_BOTTOM'];
  
  detect(ctx: TAContext): CandidatePattern[] {
    try {
      const input = toPatternInput(ctx);
      const results = runReversalDetectors(input);
      return results.map(r => toCandidatePattern(r, ctx));
    } catch (err) {
      console.error('[PhaseR4] Reversal detection failed:', err);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Phase R5: Harmonic Patterns Detector
// ═══════════════════════════════════════════════════════════════

export class PhaseR5HarmonicDetector implements Detector {
  id = 'phase_r5_harmonics';
  name = 'Phase R5 Harmonic Patterns';
  version = '1.0.0';
  types = [
    'HARMONIC_GARTLEY_BULL', 'HARMONIC_GARTLEY_BEAR',
    'HARMONIC_BAT_BULL', 'HARMONIC_BAT_BEAR',
    'HARMONIC_BUTTERFLY_BULL', 'HARMONIC_BUTTERFLY_BEAR',
    'HARMONIC_CRAB_BULL', 'HARMONIC_CRAB_BEAR',
    'HARMONIC_SHARK_BULL', 'HARMONIC_SHARK_BEAR',
    'HARMONIC_THREE_DRIVES_BULL', 'HARMONIC_THREE_DRIVES_BEAR',
  ];
  
  detect(ctx: TAContext): CandidatePattern[] {
    try {
      const input = toPatternInput(ctx);
      const results = runHarmonicDetectors(input);
      return results.map(r => toCandidatePattern(r, ctx));
    } catch (err) {
      console.error('[PhaseR5] Harmonic detection failed:', err);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Phase R6: Candlestick Patterns Detector
// ═══════════════════════════════════════════════════════════════

export class PhaseR6CandleDetector implements Detector {
  id = 'phase_r6_candles';
  name = 'Phase R6 Candlestick Patterns';
  version = '1.0.0';
  types = [
    'CANDLE_MORNING_STAR', 'CANDLE_EVENING_STAR',
    'CANDLE_DOJI', 'CANDLE_ENGULF_BULL', 'CANDLE_ENGULF_BEAR',
    'CANDLE_HAMMER', 'CANDLE_SHOOTING_STAR', 'CANDLE_INSIDE',
  ];
  
  detect(ctx: TAContext): CandidatePattern[] {
    try {
      const input = toPatternInput(ctx);
      const results = runCandleDetectors(input);
      return results.map(r => toCandidatePattern(r, ctx));
    } catch (err) {
      console.error('[PhaseR6] Candle detection failed:', err);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Phase R7: Market Structure Detector
// ═══════════════════════════════════════════════════════════════

export class PhaseR7MarketStructureDetector implements Detector {
  id = 'phase_r7_market_structure';
  name = 'Phase R7 Market Structure';
  version = '1.0.0';
  types = ['BOS_BULL', 'BOS_BEAR', 'CHOCH_BULL', 'CHOCH_BEAR', 'RANGE_BOX', 'TREND_UP', 'TREND_DOWN'];
  
  detect(ctx: TAContext): CandidatePattern[] {
    try {
      const input = toPatternInput(ctx);
      const results = runMarketStructureDetectors(input);
      return results.map(r => toCandidatePattern(r, ctx));
    } catch (err) {
      console.error('[PhaseR7] Market structure detection failed:', err);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Export all Phase R detectors
// ═══════════════════════════════════════════════════════════════

export const PHASE_R_DETECTORS = [
  new PhaseR4ReversalDetector(),
  new PhaseR5HarmonicDetector(),
  new PhaseR6CandleDetector(),
  new PhaseR7MarketStructureDetector(),
];

export function getPhaseRDetectorCount(): number {
  return PHASE_R_DETECTORS.length;
}

export function getPhaseRPatternTypes(): string[] {
  return PHASE_R_DETECTORS.flatMap(d => d.types);
}
