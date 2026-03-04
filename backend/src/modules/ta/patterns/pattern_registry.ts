/**
 * Pattern Registry — Complete TA knowledge base
 * 
 * Phase A: Registries & Taxonomy
 * 
 * TA Engine v1.0 — 70+ patterns across 12 groups
 * 
 * This is the "textbook" of technical analysis in code.
 * NOT all patterns have detectors yet — registry defines what EXISTS.
 * Active detectors are separate (Phase B/C).
 */

import { define, PatternMetaMap } from './pattern_meta.js';

export const PATTERN_REGISTRY: PatternMetaMap = {
  // ═══════════════════════════════════════════════════════════════
  // STRUCTURE (market structure analysis)
  // ═══════════════════════════════════════════════════════════════
  
  BOS_BULL: define({
    type: 'BOS_BULL',
    group: 'STRUCTURE',
    family: 'STRUCTURE',
    direction: 'BULL',
    exclusivityKey: 'structure@tf',
    stage: 'CORE',
    priority: 92,
    requires: ['PIVOTS'],
    notes: 'Break of Structure up (HH break)',
    implemented: true,
  }),
  
  BOS_BEAR: define({
    type: 'BOS_BEAR',
    group: 'STRUCTURE',
    family: 'STRUCTURE',
    direction: 'BEAR',
    exclusivityKey: 'structure@tf',
    stage: 'CORE',
    priority: 92,
    requires: ['PIVOTS'],
    notes: 'Break of Structure down (LL break)',
    implemented: true,
  }),
  
  CHOCH_BULL: define({
    type: 'CHOCH_BULL',
    group: 'STRUCTURE',
    family: 'STRUCTURE',
    direction: 'BULL',
    exclusivityKey: 'structure@tf',
    stage: 'CORE',
    priority: 88,
    requires: ['PIVOTS'],
    notes: 'Change of Character up (structure shift)',
    implemented: true,
  }),
  
  CHOCH_BEAR: define({
    type: 'CHOCH_BEAR',
    group: 'STRUCTURE',
    family: 'STRUCTURE',
    direction: 'BEAR',
    exclusivityKey: 'structure@tf',
    stage: 'CORE',
    priority: 88,
    requires: ['PIVOTS'],
    notes: 'Change of Character down',
    implemented: true,
  }),
  
  RANGE_BOX: define({
    type: 'RANGE_BOX',
    group: 'STRUCTURE',
    family: 'STRUCTURE',
    direction: 'NEUTRAL',
    exclusivityKey: 'structure@tf',
    stage: 'CORE',
    priority: 80,
    requires: ['LEVELS'],
    notes: 'Range/consolidation regime',
    implemented: true,
  }),
  
  TREND_UP: define({
    type: 'TREND_UP',
    group: 'STRUCTURE',
    family: 'STRUCTURE',
    direction: 'BULL',
    exclusivityKey: 'structure@tf',
    stage: 'CORE',
    priority: 85,
    requires: ['PIVOTS', 'MA'],
    notes: 'Uptrend regime (HH/HL)',
    implemented: true,
  }),
  
  TREND_DOWN: define({
    type: 'TREND_DOWN',
    group: 'STRUCTURE',
    family: 'STRUCTURE',
    direction: 'BEAR',
    exclusivityKey: 'structure@tf',
    stage: 'CORE',
    priority: 85,
    requires: ['PIVOTS', 'MA'],
    notes: 'Downtrend regime (LL/LH)',
    implemented: true,
  }),

  // ═══════════════════════════════════════════════════════════════
  // LEVELS (support/resistance, flips, sweeps, gaps)
  // ═══════════════════════════════════════════════════════════════
  
  SUPPORT_ZONE: define({
    type: 'SUPPORT_ZONE',
    group: 'LEVELS',
    family: 'LEVEL',
    direction: 'BULL',
    exclusivityKey: 'levels@tf',
    stage: 'CORE',
    priority: 90,
    requires: ['LEVELS'],
    notes: 'Strong support zone (cluster)',
    implemented: true,
  }),
  
  RESISTANCE_ZONE: define({
    type: 'RESISTANCE_ZONE',
    group: 'LEVELS',
    family: 'LEVEL',
    direction: 'BEAR',
    exclusivityKey: 'levels@tf',
    stage: 'CORE',
    priority: 90,
    requires: ['LEVELS'],
    notes: 'Strong resistance zone (cluster)',
    implemented: true,
  }),
  
  SR_FLIP_BULL: define({
    type: 'SR_FLIP_BULL',
    group: 'LEVELS',
    family: 'LEVEL',
    direction: 'BULL',
    exclusivityKey: 'levels@tf',
    stage: 'ADVANCED',
    priority: 82,
    requires: ['LEVELS', 'PIVOTS'],
    notes: 'Flip: resistance → support',
    implemented: true, // Phase T
  }),
  
  SR_FLIP_BEAR: define({
    type: 'SR_FLIP_BEAR',
    group: 'LEVELS',
    family: 'LEVEL',
    direction: 'BEAR',
    exclusivityKey: 'levels@tf',
    stage: 'ADVANCED',
    priority: 82,
    requires: ['LEVELS', 'PIVOTS'],
    notes: 'Flip: support → resistance',
    implemented: true, // Phase T
  }),
  
  LIQUIDITY_SWEEP_HIGH: define({
    type: 'LIQUIDITY_SWEEP_HIGH',
    group: 'LEVELS',
    family: 'LEVEL',
    direction: 'BEAR',
    exclusivityKey: 'levels@tf',
    stage: 'ADVANCED',
    priority: 78,
    requires: ['PIVOTS', 'LEVELS'],
    notes: 'Liquidity grab above high → reversal down',
    implemented: true, // Phase T
  }),
  
  LIQUIDITY_SWEEP_LOW: define({
    type: 'LIQUIDITY_SWEEP_LOW',
    group: 'LEVELS',
    family: 'LEVEL',
    direction: 'BULL',
    exclusivityKey: 'levels@tf',
    stage: 'ADVANCED',
    priority: 78,
    requires: ['PIVOTS', 'LEVELS'],
    notes: 'Liquidity grab below low → reversal up',
    implemented: true, // Phase T
  }),
  
  GAP_FAIR_VALUE: define({
    type: 'GAP_FAIR_VALUE',
    group: 'LEVELS',
    family: 'LEVEL',
    direction: 'BOTH',
    exclusivityKey: 'levels@tf',
    stage: 'EXOTIC',
    priority: 60,
    requires: ['GAPS'],
    notes: 'Fair Value Gap zone',
    implemented: true, // Phase T
  }),

  // ═══════════════════════════════════════════════════════════════
  // BREAKOUTS (breakout/retest/failed)
  // ═══════════════════════════════════════════════════════════════
  
  LEVEL_BREAKOUT: define({
    type: 'LEVEL_BREAKOUT',
    group: 'BREAKOUTS',
    family: 'BREAKOUT',
    direction: 'BULL',
    exclusivityKey: 'breakout@tf',
    stage: 'CORE',
    priority: 88,
    requires: ['LEVELS'],
    notes: 'Breakout + retest (bullish)',
    implemented: true,
  }),
  
  LEVEL_RETEST: define({
    type: 'LEVEL_RETEST',
    group: 'BREAKOUTS',
    family: 'BREAKOUT',
    direction: 'BEAR',
    exclusivityKey: 'breakout@tf',
    stage: 'CORE',
    priority: 88,
    requires: ['LEVELS'],
    notes: 'Breakdown + retest (bearish)',
    implemented: true,
  }),
  
  FAILED_BREAKOUT_BULL_TRAP: define({
    type: 'FAILED_BREAKOUT_BULL_TRAP',
    group: 'BREAKOUTS',
    family: 'BREAKOUT',
    direction: 'BEAR',
    exclusivityKey: 'breakout@tf',
    stage: 'ADVANCED',
    priority: 75,
    requires: ['LEVELS'],
    notes: 'False breakout up (bull trap)',
    implemented: true, // Phase T
  }),
  
  FAILED_BREAKOUT_BEAR_TRAP: define({
    type: 'FAILED_BREAKOUT_BEAR_TRAP',
    group: 'BREAKOUTS',
    family: 'BREAKOUT',
    direction: 'BULL',
    exclusivityKey: 'breakout@tf',
    stage: 'ADVANCED',
    priority: 75,
    requires: ['LEVELS'],
    notes: 'False breakout down (bear trap)',
    implemented: true, // Phase T
  }),

  // ═══════════════════════════════════════════════════════════════
  // TREND_GEOMETRY (channels/trendlines/pitchfork)
  // ═══════════════════════════════════════════════════════════════
  
  CHANNEL_UP: define({
    type: 'CHANNEL_UP',
    group: 'TREND_GEOMETRY',
    family: 'CHANNEL',
    direction: 'BULL',
    exclusivityKey: 'channel@tf',
    stage: 'CORE',
    priority: 86,
    requires: ['PIVOTS'],
    notes: 'Ascending channel',
    implemented: true,
  }),
  
  CHANNEL_DOWN: define({
    type: 'CHANNEL_DOWN',
    group: 'TREND_GEOMETRY',
    family: 'CHANNEL',
    direction: 'BEAR',
    exclusivityKey: 'channel@tf',
    stage: 'CORE',
    priority: 86,
    requires: ['PIVOTS'],
    notes: 'Descending channel',
    implemented: true,
  }),
  
  CHANNEL_HORIZONTAL: define({
    type: 'CHANNEL_HORIZONTAL',
    group: 'TREND_GEOMETRY',
    family: 'CHANNEL',
    direction: 'NEUTRAL',
    exclusivityKey: 'channel@tf',
    stage: 'CORE',
    priority: 78,
    requires: ['PIVOTS'],
    notes: 'Horizontal channel / range',
    implemented: true, // Phase T
  }),
  
  TRENDLINE_BREAK: define({
    type: 'TRENDLINE_BREAK',
    group: 'TREND_GEOMETRY',
    family: 'TRENDLINE',
    direction: 'BOTH',
    exclusivityKey: 'trend@tf',
    stage: 'ADVANCED',
    priority: 76,
    requires: ['PIVOTS'],
    notes: 'Trendline breakout (either direction)',
    implemented: true, // Phase T
  }),
  
  PITCHFORK_ANDREWS: define({
    type: 'PITCHFORK_ANDREWS',
    group: 'TREND_GEOMETRY',
    family: 'TRENDLINE',
    direction: 'BOTH',
    exclusivityKey: 'trend@tf',
    stage: 'EXOTIC',
    priority: 55,
    requires: ['PIVOTS'],
    notes: 'Andrews pitchfork',
    implemented: true, // Phase T
  }),
  
  EXPANDING_FORMATION: define({
    type: 'EXPANDING_FORMATION',
    group: 'TREND_GEOMETRY',
    family: 'TRENDLINE',
    direction: 'BOTH',
    exclusivityKey: 'trend@tf',
    stage: 'EXOTIC',
    priority: 52,
    requires: ['PIVOTS'],
    notes: 'Megaphone / broadening formation',
    implemented: true, // Phase T
  }),

  // ═══════════════════════════════════════════════════════════════
  // TRIANGLES_WEDGES
  // ═══════════════════════════════════════════════════════════════
  
  TRIANGLE_ASC: define({
    type: 'TRIANGLE_ASC',
    group: 'TRIANGLES_WEDGES',
    family: 'TRIANGLE',
    direction: 'BULL',
    exclusivityKey: 'triangle@tf',
    stage: 'CORE',
    priority: 86,
    requires: ['PIVOTS'],
    notes: 'Ascending triangle',
    implemented: true,
  }),
  
  TRIANGLE_DESC: define({
    type: 'TRIANGLE_DESC',
    group: 'TRIANGLES_WEDGES',
    family: 'TRIANGLE',
    direction: 'BEAR',
    exclusivityKey: 'triangle@tf',
    stage: 'CORE',
    priority: 86,
    requires: ['PIVOTS'],
    notes: 'Descending triangle',
    implemented: true,
  }),
  
  TRIANGLE_SYM: define({
    type: 'TRIANGLE_SYM',
    group: 'TRIANGLES_WEDGES',
    family: 'TRIANGLE',
    direction: 'BOTH',
    exclusivityKey: 'triangle@tf',
    stage: 'CORE',
    priority: 82,
    requires: ['PIVOTS'],
    notes: 'Symmetric triangle',
    implemented: true,
  }),
  
  WEDGE_RISING: define({
    type: 'WEDGE_RISING',
    group: 'TRIANGLES_WEDGES',
    family: 'WEDGE',
    direction: 'BEAR',
    exclusivityKey: 'wedge@tf',
    stage: 'CORE',
    priority: 80,
    requires: ['PIVOTS'],
    notes: 'Rising wedge (bearish)',
    implemented: true,
  }),
  
  WEDGE_FALLING: define({
    type: 'WEDGE_FALLING',
    group: 'TRIANGLES_WEDGES',
    family: 'WEDGE',
    direction: 'BULL',
    exclusivityKey: 'wedge@tf',
    stage: 'CORE',
    priority: 80,
    requires: ['PIVOTS'],
    notes: 'Falling wedge (bullish)',
    implemented: true,
  }),
  
  DIAMOND_TOP: define({
    type: 'DIAMOND_TOP',
    group: 'TRIANGLES_WEDGES',
    family: 'TRIANGLE',
    direction: 'BEAR',
    exclusivityKey: 'triangle@tf',
    stage: 'EXOTIC',
    priority: 45,
    requires: ['PIVOTS'],
    notes: 'Diamond top pattern',
    implemented: true, // Phase T
  }),
  
  DIAMOND_BOTTOM: define({
    type: 'DIAMOND_BOTTOM',
    group: 'TRIANGLES_WEDGES',
    family: 'TRIANGLE',
    direction: 'BULL',
    exclusivityKey: 'triangle@tf',
    stage: 'EXOTIC',
    priority: 45,
    requires: ['PIVOTS'],
    notes: 'Diamond bottom pattern',
    implemented: true, // Phase T
  }),

  // ═══════════════════════════════════════════════════════════════
  // FLAGS_PENNANTS
  // ═══════════════════════════════════════════════════════════════
  
  FLAG_BULL: define({
    type: 'FLAG_BULL',
    group: 'FLAGS_PENNANTS',
    family: 'FLAG',
    direction: 'BULL',
    exclusivityKey: 'flag@tf',
    stage: 'CORE',
    priority: 84,
    requires: ['PIVOTS'],
    notes: 'Bull flag continuation',
    implemented: true,
  }),
  
  FLAG_BEAR: define({
    type: 'FLAG_BEAR',
    group: 'FLAGS_PENNANTS',
    family: 'FLAG',
    direction: 'BEAR',
    exclusivityKey: 'flag@tf',
    stage: 'CORE',
    priority: 84,
    requires: ['PIVOTS'],
    notes: 'Bear flag continuation',
    implemented: true,
  }),
  
  PENNANT: define({
    type: 'PENNANT',
    group: 'FLAGS_PENNANTS',
    family: 'PENNANT',
    direction: 'BOTH',
    exclusivityKey: 'flag@tf',
    stage: 'CORE',
    priority: 78,
    requires: ['PIVOTS'],
    notes: 'Pennant (small symmetrical triangle)',
    implemented: true,
  }),

  // ═══════════════════════════════════════════════════════════════
  // REVERSALS (classic reversal patterns)
  // ═══════════════════════════════════════════════════════════════
  
  DOUBLE_TOP: define({
    type: 'DOUBLE_TOP',
    group: 'REVERSALS',
    family: 'REVERSAL',
    direction: 'BEAR',
    exclusivityKey: 'reversal@tf',
    stage: 'CORE',
    priority: 86,
    requires: ['PIVOTS'],
    notes: 'Double top (M pattern)',
    implemented: true,
  }),
  
  DOUBLE_BOTTOM: define({
    type: 'DOUBLE_BOTTOM',
    group: 'REVERSALS',
    family: 'REVERSAL',
    direction: 'BULL',
    exclusivityKey: 'reversal@tf',
    stage: 'CORE',
    priority: 86,
    requires: ['PIVOTS'],
    notes: 'Double bottom (W pattern)',
    implemented: true,
  }),
  
  HNS: define({
    type: 'HNS',
    group: 'REVERSALS',
    family: 'REVERSAL',
    direction: 'BEAR',
    exclusivityKey: 'reversal@tf',
    stage: 'CORE',
    priority: 84,
    requires: ['PIVOTS'],
    notes: 'Head & Shoulders',
    implemented: true,
  }),
  
  IHNS: define({
    type: 'IHNS',
    group: 'REVERSALS',
    family: 'REVERSAL',
    direction: 'BULL',
    exclusivityKey: 'reversal@tf',
    stage: 'CORE',
    priority: 84,
    requires: ['PIVOTS'],
    notes: 'Inverted Head & Shoulders',
    implemented: true,
  }),
  
  TRIPLE_TOP: define({
    type: 'TRIPLE_TOP',
    group: 'REVERSALS',
    family: 'REVERSAL',
    direction: 'BEAR',
    exclusivityKey: 'reversal@tf',
    stage: 'ADVANCED',
    priority: 70,
    requires: ['PIVOTS'],
    notes: 'Triple top',
    implemented: true,
  }),
  
  TRIPLE_BOTTOM: define({
    type: 'TRIPLE_BOTTOM',
    group: 'REVERSALS',
    family: 'REVERSAL',
    direction: 'BULL',
    exclusivityKey: 'reversal@tf',
    stage: 'ADVANCED',
    priority: 70,
    requires: ['PIVOTS'],
    notes: 'Triple bottom',
    implemented: true,
  }),
  
  ROUNDING_TOP: define({
    type: 'ROUNDING_TOP',
    group: 'REVERSALS',
    family: 'REVERSAL',
    direction: 'BEAR',
    exclusivityKey: 'reversal@tf',
    stage: 'EXOTIC',
    priority: 48,
    requires: ['PIVOTS'],
    notes: 'Rounding top / cup',
    implemented: true,
  }),
  
  ROUNDING_BOTTOM: define({
    type: 'ROUNDING_BOTTOM',
    group: 'REVERSALS',
    family: 'REVERSAL',
    direction: 'BULL',
    exclusivityKey: 'reversal@tf',
    stage: 'EXOTIC',
    priority: 48,
    requires: ['PIVOTS'],
    notes: 'Rounding bottom / cup',
    implemented: true,
  }),

  // ═══════════════════════════════════════════════════════════════
  // HARMONICS (ABCD + advanced)
  // ═══════════════════════════════════════════════════════════════
  
  HARMONIC_ABCD_BULL: define({
    type: 'HARMONIC_ABCD_BULL',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BULL',
    exclusivityKey: 'harmonic@tf',
    stage: 'ADVANCED',
    priority: 72,
    requires: ['PIVOTS', 'FIB'],
    notes: 'AB=CD bullish',
    implemented: true,
  }),
  
  HARMONIC_ABCD_BEAR: define({
    type: 'HARMONIC_ABCD_BEAR',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BEAR',
    exclusivityKey: 'harmonic@tf',
    stage: 'ADVANCED',
    priority: 72,
    requires: ['PIVOTS', 'FIB'],
    notes: 'AB=CD bearish',
    implemented: true,
  }),
  
  HARMONIC_GARTLEY_BULL: define({
    type: 'HARMONIC_GARTLEY_BULL',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BULL',
    exclusivityKey: 'harmonic@tf',
    stage: 'EXOTIC',
    priority: 58,
    requires: ['PIVOTS', 'FIB'],
    notes: 'Gartley bullish (XABCD)',
    implemented: true,
  }),
  
  HARMONIC_GARTLEY_BEAR: define({
    type: 'HARMONIC_GARTLEY_BEAR',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BEAR',
    exclusivityKey: 'harmonic@tf',
    stage: 'EXOTIC',
    priority: 58,
    requires: ['PIVOTS', 'FIB'],
    notes: 'Gartley bearish',
    implemented: true,
  }),
  
  HARMONIC_BAT_BULL: define({
    type: 'HARMONIC_BAT_BULL',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BULL',
    exclusivityKey: 'harmonic@tf',
    stage: 'EXOTIC',
    priority: 55,
    requires: ['PIVOTS', 'FIB'],
    notes: 'Bat bullish',
    implemented: true,
  }),
  
  HARMONIC_BAT_BEAR: define({
    type: 'HARMONIC_BAT_BEAR',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BEAR',
    exclusivityKey: 'harmonic@tf',
    stage: 'EXOTIC',
    priority: 55,
    requires: ['PIVOTS', 'FIB'],
    notes: 'Bat bearish',
    implemented: true,
  }),
  
  HARMONIC_BUTTERFLY_BULL: define({
    type: 'HARMONIC_BUTTERFLY_BULL',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BULL',
    exclusivityKey: 'harmonic@tf',
    stage: 'EXOTIC',
    priority: 52,
    requires: ['PIVOTS', 'FIB'],
    notes: 'Butterfly bullish',
    implemented: true,
  }),
  
  HARMONIC_BUTTERFLY_BEAR: define({
    type: 'HARMONIC_BUTTERFLY_BEAR',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BEAR',
    exclusivityKey: 'harmonic@tf',
    stage: 'EXOTIC',
    priority: 52,
    requires: ['PIVOTS', 'FIB'],
    notes: 'Butterfly bearish',
    implemented: true,
  }),
  
  HARMONIC_SHARK_BULL: define({
    type: 'HARMONIC_SHARK_BULL',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BULL',
    exclusivityKey: 'harmonic@tf',
    stage: 'EXOTIC',
    priority: 48,
    requires: ['PIVOTS', 'FIB'],
    notes: 'Shark bullish',
    implemented: true,
  }),
  
  HARMONIC_SHARK_BEAR: define({
    type: 'HARMONIC_SHARK_BEAR',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BEAR',
    exclusivityKey: 'harmonic@tf',
    stage: 'EXOTIC',
    priority: 48,
    requires: ['PIVOTS', 'FIB'],
    notes: 'Shark bearish',
    implemented: true,
  }),
  
  HARMONIC_CRAB_BULL: define({
    type: 'HARMONIC_CRAB_BULL',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BULL',
    exclusivityKey: 'harmonic@tf',
    stage: 'EXOTIC',
    priority: 45,
    requires: ['PIVOTS', 'FIB'],
    notes: 'Crab bullish',
    implemented: true,
  }),
  
  HARMONIC_CRAB_BEAR: define({
    type: 'HARMONIC_CRAB_BEAR',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BEAR',
    exclusivityKey: 'harmonic@tf',
    stage: 'EXOTIC',
    priority: 45,
    requires: ['PIVOTS', 'FIB'],
    notes: 'Crab bearish',
    implemented: true,
  }),
  
  HARMONIC_THREE_DRIVES_BULL: define({
    type: 'HARMONIC_THREE_DRIVES_BULL',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BULL',
    exclusivityKey: 'harmonic@tf',
    stage: 'EXOTIC',
    priority: 44,
    requires: ['PIVOTS', 'FIB'],
    notes: 'Three Drives bullish',
    implemented: true,
  }),
  
  HARMONIC_THREE_DRIVES_BEAR: define({
    type: 'HARMONIC_THREE_DRIVES_BEAR',
    group: 'HARMONICS',
    family: 'HARMONIC',
    direction: 'BEAR',
    exclusivityKey: 'harmonic@tf',
    stage: 'EXOTIC',
    priority: 44,
    requires: ['PIVOTS', 'FIB'],
    notes: 'Three Drives bearish',
    implemented: true,
  }),

  // ═══════════════════════════════════════════════════════════════
  // WAVES (Elliott / corrections)
  // ═══════════════════════════════════════════════════════════════
  
  ELLIOTT_5_WAVE: define({
    type: 'ELLIOTT_5_WAVE',
    group: 'WAVES',
    family: 'WAVE',
    direction: 'BOTH',
    exclusivityKey: 'wave@tf',
    stage: 'EXOTIC',
    priority: 46,
    requires: ['PIVOTS'],
    notes: '5-wave impulse (Elliott)',
  }),
  
  ELLIOTT_3_WAVE: define({
    type: 'ELLIOTT_3_WAVE',
    group: 'WAVES',
    family: 'WAVE',
    direction: 'BOTH',
    exclusivityKey: 'wave@tf',
    stage: 'EXOTIC',
    priority: 44,
    requires: ['PIVOTS'],
    notes: '3-wave correction',
  }),
  
  CORRECTION_ABC: define({
    type: 'CORRECTION_ABC',
    group: 'WAVES',
    family: 'WAVE',
    direction: 'BOTH',
    exclusivityKey: 'wave@tf',
    stage: 'EXOTIC',
    priority: 42,
    requires: ['PIVOTS'],
    notes: 'ABC correction',
  }),

  // ═══════════════════════════════════════════════════════════════
  // CANDLES (candlestick patterns)
  // ═══════════════════════════════════════════════════════════════
  
  CANDLE_ENGULF_BULL: define({
    type: 'CANDLE_ENGULF_BULL',
    group: 'CANDLES',
    family: 'CANDLE',
    direction: 'BULL',
    exclusivityKey: 'candle@bar',
    stage: 'CORE',
    priority: 70,
    notes: 'Bullish engulfing',
    implemented: true,
  }),
  
  CANDLE_ENGULF_BEAR: define({
    type: 'CANDLE_ENGULF_BEAR',
    group: 'CANDLES',
    family: 'CANDLE',
    direction: 'BEAR',
    exclusivityKey: 'candle@bar',
    stage: 'CORE',
    priority: 70,
    notes: 'Bearish engulfing',
    implemented: true,
  }),
  
  CANDLE_HAMMER: define({
    type: 'CANDLE_HAMMER',
    group: 'CANDLES',
    family: 'CANDLE',
    direction: 'BULL',
    exclusivityKey: 'candle@bar',
    stage: 'CORE',
    priority: 66,
    notes: 'Hammer (bullish pin bar)',
    implemented: true,
  }),
  
  CANDLE_SHOOTING_STAR: define({
    type: 'CANDLE_SHOOTING_STAR',
    group: 'CANDLES',
    family: 'CANDLE',
    direction: 'BEAR',
    exclusivityKey: 'candle@bar',
    stage: 'CORE',
    priority: 66,
    notes: 'Shooting star (bearish pin bar)',
    implemented: true,
  }),
  
  CANDLE_INSIDE: define({
    type: 'CANDLE_INSIDE',
    group: 'CANDLES',
    family: 'CANDLE',
    direction: 'BOTH',
    exclusivityKey: 'candle@bar',
    stage: 'CORE',
    priority: 62,
    notes: 'Inside bar (breakout direction by context)',
    implemented: true,
  }),
  
  CANDLE_MORNING_STAR: define({
    type: 'CANDLE_MORNING_STAR',
    group: 'CANDLES',
    family: 'CANDLE',
    direction: 'BULL',
    exclusivityKey: 'candle@bar',
    stage: 'ADVANCED',
    priority: 58,
    notes: 'Morning star (3-candle bullish)',
    implemented: true,
  }),
  
  CANDLE_EVENING_STAR: define({
    type: 'CANDLE_EVENING_STAR',
    group: 'CANDLES',
    family: 'CANDLE',
    direction: 'BEAR',
    exclusivityKey: 'candle@bar',
    stage: 'ADVANCED',
    priority: 58,
    notes: 'Evening star (3-candle bearish)',
    implemented: true,
  }),
  
  CANDLE_DOJI: define({
    type: 'CANDLE_DOJI',
    group: 'CANDLES',
    family: 'CANDLE',
    direction: 'NEUTRAL',
    exclusivityKey: 'candle@bar',
    stage: 'ADVANCED',
    priority: 54,
    notes: 'Doji (indecision)',
    implemented: true,
  }),

  // ═══════════════════════════════════════════════════════════════
  // OSCILLATORS (divergences)
  // ═══════════════════════════════════════════════════════════════
  
  DIVERGENCE_BULL_RSI: define({
    type: 'DIVERGENCE_BULL_RSI',
    group: 'OSCILLATORS',
    family: 'OSCILLATOR',
    direction: 'BULL',
    exclusivityKey: 'osc@tf',
    stage: 'CORE',
    priority: 72,
    requires: ['OSC'],
    notes: 'RSI bullish divergence',
    implemented: true,
  }),
  
  DIVERGENCE_BEAR_RSI: define({
    type: 'DIVERGENCE_BEAR_RSI',
    group: 'OSCILLATORS',
    family: 'OSCILLATOR',
    direction: 'BEAR',
    exclusivityKey: 'osc@tf',
    stage: 'CORE',
    priority: 72,
    requires: ['OSC'],
    notes: 'RSI bearish divergence',
    implemented: true,
  }),
  
  DIVERGENCE_BULL_MACD: define({
    type: 'DIVERGENCE_BULL_MACD',
    group: 'OSCILLATORS',
    family: 'OSCILLATOR',
    direction: 'BULL',
    exclusivityKey: 'osc@tf',
    stage: 'CORE',
    priority: 68,
    requires: ['OSC'],
    notes: 'MACD bullish divergence',
    implemented: true,
  }),
  
  DIVERGENCE_BEAR_MACD: define({
    type: 'DIVERGENCE_BEAR_MACD',
    group: 'OSCILLATORS',
    family: 'OSCILLATOR',
    direction: 'BEAR',
    exclusivityKey: 'osc@tf',
    stage: 'CORE',
    priority: 68,
    requires: ['OSC'],
    notes: 'MACD bearish divergence',
    implemented: true,
  }),
  
  HIDDEN_DIVERGENCE_BULL: define({
    type: 'HIDDEN_DIVERGENCE_BULL',
    group: 'OSCILLATORS',
    family: 'OSCILLATOR',
    direction: 'BULL',
    exclusivityKey: 'osc@tf',
    stage: 'ADVANCED',
    priority: 60,
    requires: ['OSC', 'PIVOTS'],
    notes: 'Hidden bullish divergence (trend continuation)',
    implemented: true, // Phase T
  }),
  
  HIDDEN_DIVERGENCE_BEAR: define({
    type: 'HIDDEN_DIVERGENCE_BEAR',
    group: 'OSCILLATORS',
    family: 'OSCILLATOR',
    direction: 'BEAR',
    exclusivityKey: 'osc@tf',
    stage: 'ADVANCED',
    priority: 60,
    requires: ['OSC', 'PIVOTS'],
    notes: 'Hidden bearish divergence',
    implemented: true, // Phase T
  }),

  // ═══════════════════════════════════════════════════════════════
  // MA_PATTERNS
  // ═══════════════════════════════════════════════════════════════
  
  MA_CROSS_GOLDEN: define({
    type: 'MA_CROSS_GOLDEN',
    group: 'MA_PATTERNS',
    family: 'MA',
    direction: 'BULL',
    exclusivityKey: 'ma@tf',
    stage: 'CORE',
    priority: 74,
    requires: ['MA'],
    notes: 'Golden cross (50 crosses above 200)',
    implemented: true,
  }),
  
  MA_CROSS_DEATH: define({
    type: 'MA_CROSS_DEATH',
    group: 'MA_PATTERNS',
    family: 'MA',
    direction: 'BEAR',
    exclusivityKey: 'ma@tf',
    stage: 'CORE',
    priority: 74,
    requires: ['MA'],
    notes: 'Death cross (50 crosses below 200)',
    implemented: true,
  }),
  
  MA_REJECTION_BULL: define({
    type: 'MA_REJECTION_BULL',
    group: 'MA_PATTERNS',
    family: 'MA',
    direction: 'BULL',
    exclusivityKey: 'ma@tf',
    stage: 'ADVANCED',
    priority: 66,
    requires: ['MA'],
    notes: 'MA rejection as support',
    implemented: true, // Phase T
  }),
  
  MA_REJECTION_BEAR: define({
    type: 'MA_REJECTION_BEAR',
    group: 'MA_PATTERNS',
    family: 'MA',
    direction: 'BEAR',
    exclusivityKey: 'ma@tf',
    stage: 'ADVANCED',
    priority: 66,
    requires: ['MA'],
    notes: 'MA rejection as resistance',
    implemented: true, // Phase T
  }),
  
  MA_SQUEEZE: define({
    type: 'MA_SQUEEZE',
    group: 'MA_PATTERNS',
    family: 'MA',
    direction: 'BOTH',
    exclusivityKey: 'ma@tf',
    stage: 'ADVANCED',
    priority: 58,
    requires: ['MA'],
    notes: 'MA squeeze (pre-breakout compression)',
    implemented: true, // Phase T
  }),
  
  // ═══════════════════════════════════════════════════════════════
  // Phase R8: Elliott Wave Patterns
  // ═══════════════════════════════════════════════════════════════
  
  ELLIOTT_5_WAVE: define({
    type: 'ELLIOTT_5_WAVE',
    group: 'ELLIOTT',
    family: 'ELLIOTT',
    direction: 'BOTH',
    exclusivityKey: 'elliott@tf',
    stage: 'ADVANCED',
    priority: 75,
    requires: ['PIVOTS'],
    notes: 'Elliott 5-wave impulse structure',
    implemented: true,
  }),
  
  ELLIOTT_3_WAVE: define({
    type: 'ELLIOTT_3_WAVE',
    group: 'ELLIOTT',
    family: 'ELLIOTT',
    direction: 'BOTH',
    exclusivityKey: 'elliott@tf',
    stage: 'ADVANCED',
    priority: 72,
    requires: ['PIVOTS'],
    notes: 'Elliott extended wave 3',
    implemented: true,
  }),
  
  CORRECTION_ABC: define({
    type: 'CORRECTION_ABC',
    group: 'ELLIOTT',
    family: 'ELLIOTT',
    direction: 'BOTH',
    exclusivityKey: 'elliott@tf',
    stage: 'ADVANCED',
    priority: 70,
    requires: ['PIVOTS'],
    notes: 'Elliott ABC correction',
    implemented: true,
  }),
  
  // ═══════════════════════════════════════════════════════════════
  // Phase R10.A: Gap Patterns
  // ═══════════════════════════════════════════════════════════════
  
  GAP_UP: define({
    type: 'GAP_UP',
    group: 'GAPS',
    family: 'GAP',
    direction: 'BULL',
    exclusivityKey: 'gap@bar',
    stage: 'CORE',
    priority: 72,
    notes: 'Gap up breakout',
    implemented: true,
  }),
  
  GAP_DOWN: define({
    type: 'GAP_DOWN',
    group: 'GAPS',
    family: 'GAP',
    direction: 'BEAR',
    exclusivityKey: 'gap@bar',
    stage: 'CORE',
    priority: 72,
    notes: 'Gap down breakdown',
    implemented: true,
  }),
  
  GAP_FILL: define({
    type: 'GAP_FILL',
    group: 'GAPS',
    family: 'GAP',
    direction: 'BOTH',
    exclusivityKey: 'gap@bar',
    stage: 'CORE',
    priority: 70,
    notes: 'Gap fill reversal',
    implemented: true,
  }),
  
  FAIR_VALUE_GAP_BULL: define({
    type: 'FAIR_VALUE_GAP_BULL',
    group: 'GAPS',
    family: 'FVG',
    direction: 'BULL',
    exclusivityKey: 'fvg@bar',
    stage: 'ADVANCED',
    priority: 74,
    notes: 'Bullish fair value gap (3-bar imbalance)',
    implemented: true,
  }),
  
  FAIR_VALUE_GAP_BEAR: define({
    type: 'FAIR_VALUE_GAP_BEAR',
    group: 'GAPS',
    family: 'FVG',
    direction: 'BEAR',
    exclusivityKey: 'fvg@bar',
    stage: 'ADVANCED',
    priority: 74,
    notes: 'Bearish fair value gap',
    implemented: true,
  }),
  
  IMBALANCE_REVERSAL: define({
    type: 'IMBALANCE_REVERSAL',
    group: 'GAPS',
    family: 'FVG',
    direction: 'BOTH',
    exclusivityKey: 'fvg@bar',
    stage: 'ADVANCED',
    priority: 76,
    notes: 'FVG revisit and rejection',
    implemented: true,
  }),
  
  // ═══════════════════════════════════════════════════════════════
  // Phase R10.B: MA Patterns (New)
  // ═══════════════════════════════════════════════════════════════
  
  MA_TREND_STACK: define({
    type: 'MA_TREND_STACK',
    group: 'MA_PATTERNS',
    family: 'MA',
    direction: 'BOTH',
    exclusivityKey: 'ma@tf',
    stage: 'ADVANCED',
    priority: 72,
    requires: ['MA'],
    notes: 'MA alignment change (20/50/200)',
    implemented: true,
  }),
  
  MA_GOLDEN_CROSS: define({
    type: 'MA_GOLDEN_CROSS',
    group: 'MA_PATTERNS',
    family: 'MA',
    direction: 'BULL',
    exclusivityKey: 'ma_cross@tf',
    stage: 'ADVANCED',
    priority: 78,
    requires: ['MA'],
    notes: 'MA20 crosses above MA50',
    implemented: true,
  }),
  
  MA_DEATH_CROSS: define({
    type: 'MA_DEATH_CROSS',
    group: 'MA_PATTERNS',
    family: 'MA',
    direction: 'BEAR',
    exclusivityKey: 'ma_cross@tf',
    stage: 'ADVANCED',
    priority: 78,
    requires: ['MA'],
    notes: 'MA20 crosses below MA50',
    implemented: true,
  }),
  
  MA_PULLBACK_20: define({
    type: 'MA_PULLBACK_20',
    group: 'MA_PATTERNS',
    family: 'MA',
    direction: 'BOTH',
    exclusivityKey: 'ma_pb@tf',
    stage: 'ADVANCED',
    priority: 72,
    requires: ['MA'],
    notes: 'Pullback to MA20 with rejection',
    implemented: true,
  }),
  
  MA_PULLBACK_50: define({
    type: 'MA_PULLBACK_50',
    group: 'MA_PATTERNS',
    family: 'MA',
    direction: 'BOTH',
    exclusivityKey: 'ma_pb@tf',
    stage: 'ADVANCED',
    priority: 70,
    requires: ['MA'],
    notes: 'Pullback to MA50 with rejection',
    implemented: true,
  }),
  
  // ═══════════════════════════════════════════════════════════════
  // Phase R10.C: Divergence Patterns (New)
  // ═══════════════════════════════════════════════════════════════
  
  RSI_DIV_BULL: define({
    type: 'RSI_DIV_BULL',
    group: 'DIVERGENCES',
    family: 'DIVERGENCE',
    direction: 'BULL',
    exclusivityKey: 'rsi_div@tf',
    stage: 'ADVANCED',
    priority: 75,
    requires: ['RSI', 'PIVOTS'],
    notes: 'Regular bullish RSI divergence',
    implemented: true,
  }),
  
  RSI_DIV_BEAR: define({
    type: 'RSI_DIV_BEAR',
    group: 'DIVERGENCES',
    family: 'DIVERGENCE',
    direction: 'BEAR',
    exclusivityKey: 'rsi_div@tf',
    stage: 'ADVANCED',
    priority: 75,
    requires: ['RSI', 'PIVOTS'],
    notes: 'Regular bearish RSI divergence',
    implemented: true,
  }),
  
  RSI_HIDDEN_DIV_BULL: define({
    type: 'RSI_HIDDEN_DIV_BULL',
    group: 'DIVERGENCES',
    family: 'DIVERGENCE',
    direction: 'BULL',
    exclusivityKey: 'rsi_div@tf',
    stage: 'ADVANCED',
    priority: 70,
    requires: ['RSI', 'PIVOTS'],
    notes: 'Hidden bullish RSI divergence',
    implemented: true,
  }),
  
  RSI_HIDDEN_DIV_BEAR: define({
    type: 'RSI_HIDDEN_DIV_BEAR',
    group: 'DIVERGENCES',
    family: 'DIVERGENCE',
    direction: 'BEAR',
    exclusivityKey: 'rsi_div@tf',
    stage: 'ADVANCED',
    priority: 70,
    requires: ['RSI', 'PIVOTS'],
    notes: 'Hidden bearish RSI divergence',
    implemented: true,
  }),
  
  MACD_DIV_BULL: define({
    type: 'MACD_DIV_BULL',
    group: 'DIVERGENCES',
    family: 'DIVERGENCE',
    direction: 'BULL',
    exclusivityKey: 'macd_div@tf',
    stage: 'ADVANCED',
    priority: 74,
    requires: ['MACD', 'PIVOTS'],
    notes: 'Bullish MACD divergence',
    implemented: true,
  }),
  
  MACD_DIV_BEAR: define({
    type: 'MACD_DIV_BEAR',
    group: 'DIVERGENCES',
    family: 'DIVERGENCE',
    direction: 'BEAR',
    exclusivityKey: 'macd_div@tf',
    stage: 'ADVANCED',
    priority: 74,
    requires: ['MACD', 'PIVOTS'],
    notes: 'Bearish MACD divergence',
    implemented: true,
  }),
  
  // ═══════════════════════════════════════════════════════════════
  // Phase R10.D: Pitchfork & Broadening
  // ═══════════════════════════════════════════════════════════════
  
  PITCHFORK: define({
    type: 'PITCHFORK',
    group: 'PITCHFORK',
    family: 'PITCHFORK',
    direction: 'BOTH',
    exclusivityKey: 'pitchfork@tf',
    stage: 'EXOTIC',
    priority: 70,
    requires: ['PIVOTS'],
    notes: "Andrew's Pitchfork channel",
    implemented: true,
  }),
  
  PITCHFORK_BREAK: define({
    type: 'PITCHFORK_BREAK',
    group: 'PITCHFORK',
    family: 'PITCHFORK',
    direction: 'BOTH',
    exclusivityKey: 'pitchfork@tf',
    stage: 'EXOTIC',
    priority: 72,
    requires: ['PIVOTS'],
    notes: 'Pitchfork median line break',
    implemented: true,
  }),
  
  BROADENING_TRIANGLE: define({
    type: 'BROADENING_TRIANGLE',
    group: 'BROADENING',
    family: 'BROADENING',
    direction: 'NEUTRAL',
    exclusivityKey: 'broadening@tf',
    stage: 'EXOTIC',
    priority: 68,
    requires: ['PIVOTS'],
    notes: 'Megaphone / expanding triangle',
    implemented: true,
  }),
  
  BROADENING_WEDGE: define({
    type: 'BROADENING_WEDGE',
    group: 'BROADENING',
    family: 'BROADENING',
    direction: 'BOTH',
    exclusivityKey: 'broadening@tf',
    stage: 'EXOTIC',
    priority: 68,
    requires: ['PIVOTS'],
    notes: 'Diverging wedge formation',
    implemented: true,
  }),
};

// ═══════════════════════════════════════════════════════════════
// Registry Utilities
// ═══════════════════════════════════════════════════════════════

/**
 * Get registry statistics
 */
export function getRegistryStats(): {
  total: number;
  byGroup: Record<string, number>;
  byStage: Record<string, number>;
  byDirection: Record<string, number>;
  implemented: number;
} {
  const patterns = Object.values(PATTERN_REGISTRY);
  
  const byGroup: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  const byDirection: Record<string, number> = {};
  let implemented = 0;
  
  for (const p of patterns) {
    byGroup[p.group] = (byGroup[p.group] || 0) + 1;
    byStage[p.stage] = (byStage[p.stage] || 0) + 1;
    byDirection[p.direction] = (byDirection[p.direction] || 0) + 1;
    if (p.implemented) implemented++;
  }
  
  return {
    total: patterns.length,
    byGroup,
    byStage,
    byDirection,
    implemented,
  };
}

/**
 * Get pattern meta by type
 */
export function getPatternMeta(type: string): typeof PATTERN_REGISTRY[string] | undefined {
  return PATTERN_REGISTRY[type];
}

/**
 * Check if pattern exists in registry
 */
export function isRegisteredPattern(type: string): boolean {
  return type in PATTERN_REGISTRY;
}
