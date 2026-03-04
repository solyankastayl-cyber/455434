/**
 * Phase R8-R10 Pattern Detectors Adapter
 * 
 * Integrates Elliott, Gaps, MA, Divergences, Pitchfork, Broadening
 */

import { Detector, TAContext, CandidatePattern } from '../domain/types.js';
import { runElliottDetectors } from '../patterns/elliott/index.js';
import { runGapDetectors } from '../patterns/gaps/index.js';
import { runPitchforkDetectors } from '../patterns/pitchfork/index.js';
import { runBroadeningDetectors } from '../patterns/broadening/index.js';
import { PatternResult, Pivot } from '../patterns/utils/pattern_types.js';

/**
 * Convert TAContext to internal format
 */
function getCandles(ctx: TAContext) {
  return ctx.series.candles.map(c => ({
    t: c.ts,
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: c.volume,
  }));
}

function getPivots(ctx: TAContext): Pivot[] {
  return ctx.pivots.map(p => ({
    index: ctx.series.candles.findIndex(c => c.ts === p.ts),
    price: p.price,
    kind: p.type === 'HIGH' ? 'HIGH' : 'LOW',
    strength: p.strength,
  }));
}

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
      note: `Phase R8-10: ${result.type}`,
    },
    meta: result.meta || {},
  };
}

// ═══════════════════════════════════════════════════════════════
// Phase R8: Elliott Wave Detector
// ═══════════════════════════════════════════════════════════════

export class PhaseR8ElliottDetector implements Detector {
  id = 'phase_r8_elliott';
  name = 'Phase R8 Elliott Wave';
  version = '1.0.0';
  types = ['ELLIOTT_5_WAVE', 'ELLIOTT_3_WAVE', 'CORRECTION_ABC'];
  
  detect(ctx: TAContext): CandidatePattern[] {
    try {
      const pivots = getPivots(ctx);
      const results = runElliottDetectors(pivots);
      return results.map(r => toCandidatePattern(r, ctx));
    } catch (err) {
      console.error('[PhaseR8] Elliott detection failed:', err);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Phase R10.A: Gap Detector
// ═══════════════════════════════════════════════════════════════

export class PhaseR10GapDetector implements Detector {
  id = 'phase_r10_gaps';
  name = 'Phase R10 Gap Patterns';
  version = '1.0.0';
  types = [
    'GAP_UP', 'GAP_DOWN', 'GAP_FILL',
    'FAIR_VALUE_GAP_BULL', 'FAIR_VALUE_GAP_BEAR',
    'IMBALANCE_REVERSAL',
  ];
  
  detect(ctx: TAContext): CandidatePattern[] {
    try {
      const candles = getCandles(ctx);
      const results = runGapDetectors(candles);
      return results.map(r => toCandidatePattern(r, ctx));
    } catch (err) {
      console.error('[PhaseR10] Gap detection failed:', err);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Phase R10.D: Pitchfork & Broadening Detector
// ═══════════════════════════════════════════════════════════════

export class PhaseR10PitchforkBroadeningDetector implements Detector {
  id = 'phase_r10_pitchfork_broadening';
  name = 'Phase R10 Pitchfork & Broadening';
  version = '1.0.0';
  types = [
    'PITCHFORK', 'PITCHFORK_BREAK',
    'BROADENING_TRIANGLE', 'BROADENING_WEDGE',
  ];
  
  detect(ctx: TAContext): CandidatePattern[] {
    try {
      const candles = getCandles(ctx);
      const pivots = getPivots(ctx);
      
      const results = [
        ...runPitchforkDetectors(pivots, candles),
        ...runBroadeningDetectors(pivots),
      ];
      
      return results.map(r => toCandidatePattern(r, ctx));
    } catch (err) {
      console.error('[PhaseR10] Pitchfork/Broadening detection failed:', err);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Export all Phase R8-R10 detectors
// ═══════════════════════════════════════════════════════════════

export const PHASE_R8_R10_DETECTORS = [
  new PhaseR8ElliottDetector(),
  new PhaseR10GapDetector(),
  new PhaseR10PitchforkBroadeningDetector(),
];

export function getPhaseR8R10DetectorCount(): number {
  return PHASE_R8_R10_DETECTORS.length;
}

export function getPhaseR8R10PatternTypes(): string[] {
  return PHASE_R8_R10_DETECTORS.flatMap(d => d.types);
}
