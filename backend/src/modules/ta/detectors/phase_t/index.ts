/**
 * Phase T: Complete Registry Coverage
 * 
 * Implements remaining 18 patterns to achieve 100% registry coverage:
 * - LEVELS: SR_FLIP, LIQUIDITY_SWEEP, GAP_FAIR_VALUE
 * - BREAKOUTS: FAILED_BREAKOUT traps
 * - TREND_GEOMETRY: CHANNEL_HORIZONTAL, TRENDLINE_BREAK, PITCHFORK_ANDREWS, EXPANDING_FORMATION
 * - TRIANGLES_WEDGES: DIAMOND_TOP/BOTTOM
 * - OSCILLATORS: HIDDEN_DIVERGENCE
 * - MA_PATTERNS: MA_REJECTION, MA_SQUEEZE
 */

export { LiquidityDetector, LIQUIDITY_DETECTOR } from './liquidity.detector.js';
export { SRFlipDetector, SR_FLIP_DETECTOR } from './sr_flip.detector.js';
export { FailedBreakoutDetector, FAILED_BREAKOUT_DETECTOR } from './failed_breakout.detector.js';
export { TrendGeometryDetector, TREND_GEOMETRY_DETECTOR } from './trend_geometry.detector.js';
export { DiamondDetector, DIAMOND_DETECTOR } from './diamond.detector.js';
export { HiddenDivergenceDetector, HIDDEN_DIVERGENCE_DETECTOR } from './hidden_divergence.detector.js';
export { MAAdvancedDetector, MA_ADVANCED_DETECTOR } from './ma_advanced.detector.js';

import { LIQUIDITY_DETECTOR } from './liquidity.detector.js';
import { SR_FLIP_DETECTOR } from './sr_flip.detector.js';
import { FAILED_BREAKOUT_DETECTOR } from './failed_breakout.detector.js';
import { TREND_GEOMETRY_DETECTOR } from './trend_geometry.detector.js';
import { DIAMOND_DETECTOR } from './diamond.detector.js';
import { HIDDEN_DIVERGENCE_DETECTOR } from './hidden_divergence.detector.js';
import { MA_ADVANCED_DETECTOR } from './ma_advanced.detector.js';

/**
 * All Phase T detectors
 */
export const PHASE_T_DETECTORS = [
  LIQUIDITY_DETECTOR,
  SR_FLIP_DETECTOR,
  FAILED_BREAKOUT_DETECTOR,
  TREND_GEOMETRY_DETECTOR,
  DIAMOND_DETECTOR,
  HIDDEN_DIVERGENCE_DETECTOR,
  MA_ADVANCED_DETECTOR,
];
