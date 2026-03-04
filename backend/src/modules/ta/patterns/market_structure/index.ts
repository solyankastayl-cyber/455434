/**
 * Phase R7: Market Structure Detectors
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';
import { detectBOS } from './bos.detector.js';
import { detectCHOCH } from './choch.detector.js';
import { detectTrendShift } from './trend_shift.detector.js';
import { detectRangeBox } from './range.detector.js';

export function runMarketStructureDetectors(input: PatternInput): PatternResult[] {
  return [
    ...detectBOS(input),
    ...detectCHOCH(input),
    ...detectTrendShift(input),
    ...detectRangeBox(input),
  ];
}

export {
  detectBOS,
  detectCHOCH,
  detectTrendShift,
  detectRangeBox,
};
