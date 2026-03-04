/**
 * Phase R10.A: Gaps Module Index
 */

import { PatternResult } from '../utils/pattern_types.js';
import { Candle } from './gaps_utils.js';
import { detectGaps } from './gap.detector.js';
import { detectGapFill } from './gap_fill.detector.js';
import { detectFVG } from './fvg.detector.js';
import { detectImbalanceReversal } from './imbalance_reversal.detector.js';

export function runGapDetectors(candles: Candle[]): PatternResult[] {
  return [
    ...detectGaps(candles),
    ...detectGapFill(candles),
    ...detectFVG(candles),
    ...detectImbalanceReversal(candles),
  ];
}

export {
  detectGaps,
  detectGapFill,
  detectFVG,
  detectImbalanceReversal,
};

export * from './gaps_utils.js';
