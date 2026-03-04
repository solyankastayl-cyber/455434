/**
 * Phase R8: Elliott Wave Engine
 * Main entry point for all Elliott Wave pattern detection
 */

import { PatternInput, PatternResult, Pivot } from '../utils/pattern_types.js';
import { detectImpulse5Wave } from './impulse_5wave.detector.js';
import { detectABCCorrection } from './correction_abc.detector.js';
import { detectExtendedWave } from './extended_wave.detector.js';

/**
 * Run all Elliott Wave detectors
 */
export function runElliottDetectors(pivots: Pivot[]): PatternResult[] {
  const patterns: PatternResult[] = [];
  
  patterns.push(
    ...detectImpulse5Wave(pivots),
    ...detectABCCorrection(pivots),
    ...detectExtendedWave(pivots)
  );
  
  return patterns;
}

/**
 * Run Elliott detection from PatternInput
 */
export function detectElliottPatterns(input: PatternInput): PatternResult[] {
  const pivots = input.pivots || [];
  return runElliottDetectors(pivots);
}

export {
  detectImpulse5Wave,
  detectABCCorrection,
  detectExtendedWave,
};

export * from './elliott_utils.js';
