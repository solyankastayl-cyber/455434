/**
 * Phase R1: Structure Detectors
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';
import { detectSupport } from './support.detector.js';
import { detectResistance } from './resistance.detector.js';
import { detectPivot } from './pivot.detector.js';
import { detectRange } from './range.detector.js';
import { detectFlip } from './flip.detector.js';
import { detectLiquiditySweep } from './liquidity_sweep.detector.js';
import { detectGap } from './gap.detector.js';
import { detectOrderBlock } from './orderblock.detector.js';

export function runStructureDetectors(input: PatternInput): PatternResult[] {
  return [
    ...detectSupport(input),
    ...detectResistance(input),
    ...detectPivot(input),
    ...detectRange(input),
    ...detectFlip(input),
    ...detectLiquiditySweep(input),
    ...detectGap(input),
    ...detectOrderBlock(input),
  ];
}

export {
  detectSupport,
  detectResistance,
  detectPivot,
  detectRange,
  detectFlip,
  detectLiquiditySweep,
  detectGap,
  detectOrderBlock,
};
