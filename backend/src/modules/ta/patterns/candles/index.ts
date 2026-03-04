/**
 * Phase R6: Candlestick Pattern Detectors
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';
import { detectMorningStar } from './morning_star.detector.js';
import { detectEveningStar } from './evening_star.detector.js';
import { detectDoji } from './doji.detector.js';
import { detectEngulfing } from './engulfing.detector.js';
import { detectHammerShootingStar } from './hammer.detector.js';
import { detectInsideBar } from './inside_bar.detector.js';

export function runCandleDetectors(input: PatternInput): PatternResult[] {
  return [
    ...detectMorningStar(input),
    ...detectEveningStar(input),
    ...detectDoji(input),
    ...detectEngulfing(input),
    ...detectHammerShootingStar(input),
    ...detectInsideBar(input),
  ];
}

export {
  detectMorningStar,
  detectEveningStar,
  detectDoji,
  detectEngulfing,
  detectHammerShootingStar,
  detectInsideBar,
};
