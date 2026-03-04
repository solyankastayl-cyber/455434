/**
 * Pattern Groups — 12 категорий паттернов для Hypothesis Engine
 * 
 * Phase A: Registries & Taxonomy
 * 
 * TA Engine v1.0 — "книга теханализа" в коде
 */

// ═══════════════════════════════════════════════════════════════
// Pattern Group Types
// ═══════════════════════════════════════════════════════════════

export type PatternGroup =
  | 'STRUCTURE'
  | 'LEVELS'
  | 'BREAKOUTS'
  | 'TREND_GEOMETRY'
  | 'TRIANGLES_WEDGES'
  | 'FLAGS_PENNANTS'
  | 'REVERSALS'
  | 'HARMONICS'
  | 'WAVES'
  | 'CANDLES'
  | 'OSCILLATORS'
  | 'MA_PATTERNS';

export const PATTERN_GROUPS: PatternGroup[] = [
  'STRUCTURE',
  'LEVELS',
  'BREAKOUTS',
  'TREND_GEOMETRY',
  'TRIANGLES_WEDGES',
  'FLAGS_PENNANTS',
  'REVERSALS',
  'HARMONICS',
  'WAVES',
  'CANDLES',
  'OSCILLATORS',
  'MA_PATTERNS',
];

// ═══════════════════════════════════════════════════════════════
// Pattern Direction
// ═══════════════════════════════════════════════════════════════

export type PatternDirection = 'BULL' | 'BEAR' | 'NEUTRAL' | 'BOTH';

// ═══════════════════════════════════════════════════════════════
// Pattern Stage (for hypothesis prioritization)
// ═══════════════════════════════════════════════════════════════

export type PatternStage = 'CORE' | 'ADVANCED' | 'EXOTIC';

// ═══════════════════════════════════════════════════════════════
// Pattern Family (semantic grouping within category)
// ═══════════════════════════════════════════════════════════════

export type PatternFamily =
  | 'STRUCTURE'
  | 'LEVEL'
  | 'BREAKOUT'
  | 'TRENDLINE'
  | 'CHANNEL'
  | 'TRIANGLE'
  | 'WEDGE'
  | 'FLAG'
  | 'PENNANT'
  | 'REVERSAL'
  | 'CANDLE'
  | 'OSCILLATOR'
  | 'MA'
  | 'HARMONIC'
  | 'WAVE';

// ═══════════════════════════════════════════════════════════════
// Exclusivity Key — for Conflict Engine
// ═══════════════════════════════════════════════════════════════

export type ExclusivityKey =
  | 'structure@tf'
  | 'levels@tf'
  | 'breakout@tf'
  | 'trend@tf'
  | 'channel@tf'
  | 'triangle@tf'
  | 'wedge@tf'
  | 'flag@tf'
  | 'reversal@tf'
  | 'harmonic@tf'
  | 'wave@tf'
  | 'candle@bar'
  | 'osc@tf'
  | 'ma@tf'
  | 'none';

// ═══════════════════════════════════════════════════════════════
// Pattern Type — string for extensibility
// ═══════════════════════════════════════════════════════════════

export type RegistryPatternType = string;

// ═══════════════════════════════════════════════════════════════
// Pattern Requirements
// ═══════════════════════════════════════════════════════════════

export type PatternRequirement = 
  | 'PIVOTS' 
  | 'LEVELS' 
  | 'MA' 
  | 'FIB' 
  | 'OSC' 
  | 'VOLUME' 
  | 'GAPS';

// ═══════════════════════════════════════════════════════════════
// Group Metadata
// ═══════════════════════════════════════════════════════════════

export type PatternGroupMeta = {
  id: PatternGroup;
  name: string;
  description: string;
  maxPatternsInHypothesis: number; // how many from this group in one hypothesis
  priority: number; // group priority for ranking
};

export const PATTERN_GROUP_META: Record<PatternGroup, PatternGroupMeta> = {
  STRUCTURE: {
    id: 'STRUCTURE',
    name: 'Market Structure',
    description: 'BOS, CHoCH, trend/range detection',
    maxPatternsInHypothesis: 1,
    priority: 100,
  },
  LEVELS: {
    id: 'LEVELS',
    name: 'Support/Resistance Levels',
    description: 'S/R zones, flips, liquidity sweeps, gaps',
    maxPatternsInHypothesis: 2,
    priority: 95,
  },
  BREAKOUTS: {
    id: 'BREAKOUTS',
    name: 'Breakout Patterns',
    description: 'Breakout, retest, failed breakout/trap',
    maxPatternsInHypothesis: 1,
    priority: 90,
  },
  TREND_GEOMETRY: {
    id: 'TREND_GEOMETRY',
    name: 'Trend Geometry',
    description: 'Channels, trendlines, pitchfork',
    maxPatternsInHypothesis: 1,
    priority: 85,
  },
  TRIANGLES_WEDGES: {
    id: 'TRIANGLES_WEDGES',
    name: 'Triangles & Wedges',
    description: 'Ascending, descending, symmetric triangles, wedges',
    maxPatternsInHypothesis: 1,
    priority: 82,
  },
  FLAGS_PENNANTS: {
    id: 'FLAGS_PENNANTS',
    name: 'Flags & Pennants',
    description: 'Bull/bear flags, pennants',
    maxPatternsInHypothesis: 1,
    priority: 80,
  },
  REVERSALS: {
    id: 'REVERSALS',
    name: 'Reversal Patterns',
    description: 'Double top/bottom, H&S, triple tops',
    maxPatternsInHypothesis: 1,
    priority: 78,
  },
  HARMONICS: {
    id: 'HARMONICS',
    name: 'Harmonic Patterns',
    description: 'ABCD, Gartley, Bat, Butterfly, etc.',
    maxPatternsInHypothesis: 1,
    priority: 70,
  },
  WAVES: {
    id: 'WAVES',
    name: 'Wave Patterns',
    description: 'Elliott waves, ABC corrections',
    maxPatternsInHypothesis: 1,
    priority: 60,
  },
  CANDLES: {
    id: 'CANDLES',
    name: 'Candlestick Patterns',
    description: 'Engulfing, hammer, shooting star, inside bar',
    maxPatternsInHypothesis: 2,
    priority: 65,
  },
  OSCILLATORS: {
    id: 'OSCILLATORS',
    name: 'Oscillator Patterns',
    description: 'RSI/MACD divergences, hidden divergences',
    maxPatternsInHypothesis: 1,
    priority: 72,
  },
  MA_PATTERNS: {
    id: 'MA_PATTERNS',
    name: 'Moving Average Patterns',
    description: 'Golden/death cross, MA rejection, squeeze',
    maxPatternsInHypothesis: 1,
    priority: 68,
  },
};
