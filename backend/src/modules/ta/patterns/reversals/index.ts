/**
 * Phase R4: Reversal Detectors
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';
import { detectTripleTop } from './triple_top.detector.js';
import { detectTripleBottom } from './triple_bottom.detector.js';
import { detectRoundingTop } from './rounding_top.detector.js';
import { detectRoundingBottom } from './rounding_bottom.detector.js';

export function runReversalDetectors(input: PatternInput): PatternResult[] {
  return [
    ...detectTripleTop(input),
    ...detectTripleBottom(input),
    ...detectRoundingTop(input),
    ...detectRoundingBottom(input),
  ];
}

export {
  detectTripleTop,
  detectTripleBottom,
  detectRoundingTop,
  detectRoundingBottom,
};
