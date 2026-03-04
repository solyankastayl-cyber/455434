/**
 * Phase R2: Breakout Detectors
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';
import { detectBreakout } from './breakout.detector.js';
import { detectFalseBreakout } from './false_breakout.detector.js';
import { detectRetest } from './retest.detector.js';
import { detectContinuationBreak } from './continuation_break.detector.js';
import { detectCompressionBreak } from './compression_break.detector.js';
import { detectTrendlineBreak } from './trendline_break.detector.js';

export function runBreakoutDetectors(input: PatternInput, levels: number[]): PatternResult[] {
  return [
    ...detectBreakout(input, levels),
    ...detectFalseBreakout(input, levels),
    ...detectRetest(input, levels),
    ...detectContinuationBreak(input),
    ...detectCompressionBreak(input),
    ...detectTrendlineBreak(input),
  ];
}

export {
  detectBreakout,
  detectFalseBreakout,
  detectRetest,
  detectContinuationBreak,
  detectCompressionBreak,
  detectTrendlineBreak,
};
