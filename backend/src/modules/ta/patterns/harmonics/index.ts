/**
 * Phase R5: Harmonic Pattern Detectors
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';
import { detectGartley } from './gartley.detector.js';
import { detectBat } from './bat.detector.js';
import { detectButterfly } from './butterfly.detector.js';
import { detectCrab } from './crab.detector.js';
import { detectShark } from './shark.detector.js';
import { detectThreeDrives } from './three_drives.detector.js';

export function runHarmonicDetectors(input: PatternInput): PatternResult[] {
  return [
    ...detectGartley(input),
    ...detectBat(input),
    ...detectButterfly(input),
    ...detectCrab(input),
    ...detectShark(input),
    ...detectThreeDrives(input),
  ];
}

export {
  detectGartley,
  detectBat,
  detectButterfly,
  detectCrab,
  detectShark,
  detectThreeDrives,
};

export * from './harmonic_utils.js';
