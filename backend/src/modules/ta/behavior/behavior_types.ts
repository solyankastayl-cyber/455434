/**
 * Phase AE1: Scenario Behaviour Types
 * 
 * Key insight: unit of statistics is SCENARIO, not PATTERN
 * Scenario = Pattern + Protocol + Context
 * 
 * This avoids the common TA system error of mixing:
 * - Different entry types
 * - Different stop rules
 * - Different market conditions
 */

import { createHash } from 'crypto';

// ═══════════════════════════════════════════════════════════════
// PROTOCOL TYPES (How we trade the pattern)
// ═══════════════════════════════════════════════════════════════

export type EntryType = 
  | 'BREAKOUT_CLOSE'      // Candle closes beyond level
  | 'BREAKOUT_WICK'       // Wick touches level
  | 'RETEST_REJECTION'    // Price retests and rejects
  | 'MARKET_ENTRY'        // Immediate entry
  | 'LIMIT_ENTRY';        // Limit order at level

export type StopType =
  | 'STRUCTURE_LOW'       // Below last swing low (bull) / above swing high (bear)
  | 'PATTERN_EXTREME'     // Beyond pattern boundary
  | 'ATR_BASED'           // Fixed ATR multiple
  | 'LEVEL_BASED'         // Below/above key level
  | 'PERCENT_BASED';      // Fixed percentage

export type TargetType =
  | 'MEASURED_MOVE'       // Pattern height projection
  | 'POLE_PROJECTION'     // Flag pole length
  | 'FIB_EXTENSION'       // Fibonacci extension
  | 'NEXT_LEVEL'          // Next S/R level
  | 'NECKLINE_PROJECTION' // H&S neckline break
  | 'HARMONIC_TARGET'     // Harmonic pattern target
  | 'ATR_MULTIPLE';       // Fixed ATR target

export type ScenarioProtocol = {
  entryType: EntryType;
  stopType: StopType;
  targetType: TargetType;
  timeoutBars: number;
  
  // Entry confirmation (optional)
  requireVolumeConfirm?: boolean;
  requireCandleConfirm?: boolean;
};

// ═══════════════════════════════════════════════════════════════
// CONTEXT TYPES (Market conditions)
// ═══════════════════════════════════════════════════════════════

export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
export type TrendRegime = 'STRONG_UP' | 'WEAK_UP' | 'RANGE' | 'WEAK_DOWN' | 'STRONG_DOWN';
export type VolumeRegime = 'DRY' | 'NORMAL' | 'EXPANSION' | 'CLIMAX';

export type ScenarioContext = {
  // Trend
  regime: TrendRegime;
  maAlignment: boolean;          // MA50 > MA200 for bull
  maTrend: 'BULL' | 'BEAR' | 'MIXED';
  
  // Volatility
  volatility: VolatilityRegime;
  atrPercent: number;            // ATR as % of price
  
  // Volume
  volumeRegime: VolumeRegime;
  volumeSpike: boolean;          // Volume > 2x average
  
  // Momentum
  rsi: number;
  rsiZone: 'OVERSOLD' | 'NEUTRAL' | 'OVERBOUGHT';
  macdCross: 'BULL' | 'BEAR' | 'NONE';
  
  // Structure
  nearSupport: boolean;
  nearResistance: boolean;
  atKeyLevel: boolean;
  
  // Time
  dayOfWeek?: number;
  hourOfDay?: number;
};

// ═══════════════════════════════════════════════════════════════
// OUTCOME TYPES
// ═══════════════════════════════════════════════════════════════

export type OutcomeStatus = 
  | 'PENDING'        // Scenario active, waiting
  | 'WIN'            // Target reached
  | 'LOSS'           // Stop hit
  | 'TIMEOUT'        // Neither target nor stop, expired
  | 'NO_ENTRY'       // Entry conditions never met
  | 'PARTIAL';       // Partial target reached

export type ScenarioOutcome = {
  status: OutcomeStatus;
  
  // Time metrics
  barsToOutcome: number;         // How many bars until resolved
  entryBar?: number;             // Bar when entry triggered
  exitBar?: number;              // Bar when exit occurred
  
  // Price metrics
  entryPrice?: number;
  exitPrice?: number;
  
  // Performance metrics
  mfe: number;                   // Maximum Favorable Excursion (%)
  mae: number;                   // Maximum Adverse Excursion (%)
  returnPercent?: number;        // Actual return if closed
  
  // R-multiple
  rMultiple?: number;            // Return / Risk
  
  // Additional
  closedBy: 'TARGET' | 'STOP' | 'TIMEOUT' | 'MANUAL' | 'NO_ENTRY';
};

// ═══════════════════════════════════════════════════════════════
// SCENARIO BEHAVIOUR RECORD
// ═══════════════════════════════════════════════════════════════

export type ScenarioBehaviour = {
  // Identity
  _id?: any;
  runId: string;
  scenarioId: string;
  behaviourKey: string;          // Hash of pattern + protocol + timeframe
  
  // Asset
  symbol: string;
  timeframe: string;
  
  // Pattern
  patternType: string;
  patternGroup: string;
  direction: 'BULLISH' | 'BEARISH';
  patternScore: number;
  
  // Protocol (How we trade it)
  protocol: ScenarioProtocol;
  
  // Context (Market conditions)
  context: ScenarioContext;
  
  // Projection (What we expect)
  projection: {
    entry: number;
    stop: number;
    target: number;
    target2?: number;
    riskReward: number;
    probability: number;
  };
  
  // Signal timestamp (CRITICAL: no future data after this point)
  signalTs: Date;
  signalBar: number;             // Bar index when signal was generated
  
  // Outcome (filled later)
  outcome: ScenarioOutcome;
  
  // Metadata
  createdAt: Date;
  updatedAt?: Date;
  version: string;
};

// ═══════════════════════════════════════════════════════════════
// BEHAVIOUR KEY GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * Generate unique behaviour key for scenario type
 * This groups similar scenarios for statistical analysis
 */
export function buildBehaviourKey(
  patternType: string,
  protocol: ScenarioProtocol,
  timeframe: string
): string {
  const components = [
    patternType,
    protocol.entryType,
    protocol.stopType,
    protocol.targetType,
    timeframe,
  ].join('|');
  
  return createHash('md5').update(components).digest('hex').substring(0, 12);
}

/**
 * Generate readable behaviour key label
 */
export function getBehaviourKeyLabel(
  patternType: string,
  protocol: ScenarioProtocol,
  timeframe: string
): string {
  return `${patternType}:${protocol.entryType}:${protocol.stopType}:${protocol.targetType}:${timeframe}`;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT PROTOCOLS BY PATTERN TYPE
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_PROTOCOLS: Record<string, ScenarioProtocol> = {
  // Triangles
  'TRIANGLE_ASC': {
    entryType: 'BREAKOUT_CLOSE',
    stopType: 'STRUCTURE_LOW',
    targetType: 'MEASURED_MOVE',
    timeoutBars: 40,
    requireVolumeConfirm: true,
  },
  'TRIANGLE_DESC': {
    entryType: 'BREAKOUT_CLOSE',
    stopType: 'STRUCTURE_LOW',
    targetType: 'MEASURED_MOVE',
    timeoutBars: 40,
    requireVolumeConfirm: true,
  },
  'TRIANGLE_SYM': {
    entryType: 'BREAKOUT_CLOSE',
    stopType: 'PATTERN_EXTREME',
    targetType: 'MEASURED_MOVE',
    timeoutBars: 35,
  },
  
  // Flags
  'FLAG_BULL': {
    entryType: 'BREAKOUT_CLOSE',
    stopType: 'PATTERN_EXTREME',
    targetType: 'POLE_PROJECTION',
    timeoutBars: 25,
    requireVolumeConfirm: true,
  },
  'FLAG_BEAR': {
    entryType: 'BREAKOUT_CLOSE',
    stopType: 'PATTERN_EXTREME',
    targetType: 'POLE_PROJECTION',
    timeoutBars: 25,
    requireVolumeConfirm: true,
  },
  
  // Head & Shoulders
  'HNS': {
    entryType: 'BREAKOUT_CLOSE',
    stopType: 'STRUCTURE_LOW',
    targetType: 'NECKLINE_PROJECTION',
    timeoutBars: 50,
    requireCandleConfirm: true,
  },
  'IHNS': {
    entryType: 'BREAKOUT_CLOSE',
    stopType: 'STRUCTURE_LOW',
    targetType: 'NECKLINE_PROJECTION',
    timeoutBars: 50,
    requireCandleConfirm: true,
  },
  
  // Double/Triple
  'DOUBLE_TOP': {
    entryType: 'BREAKOUT_CLOSE',
    stopType: 'PATTERN_EXTREME',
    targetType: 'MEASURED_MOVE',
    timeoutBars: 40,
  },
  'DOUBLE_BOTTOM': {
    entryType: 'BREAKOUT_CLOSE',
    stopType: 'PATTERN_EXTREME',
    targetType: 'MEASURED_MOVE',
    timeoutBars: 40,
  },
  
  // Cup & Handle
  'CUP_HANDLE': {
    entryType: 'BREAKOUT_CLOSE',
    stopType: 'STRUCTURE_LOW',
    targetType: 'MEASURED_MOVE',
    timeoutBars: 60,
    requireVolumeConfirm: true,
  },
  
  // Harmonics
  'HARMONIC_GARTLEY_BULL': {
    entryType: 'LIMIT_ENTRY',
    stopType: 'PATTERN_EXTREME',
    targetType: 'HARMONIC_TARGET',
    timeoutBars: 35,
  },
  'HARMONIC_BAT_BULL': {
    entryType: 'LIMIT_ENTRY',
    stopType: 'PATTERN_EXTREME',
    targetType: 'HARMONIC_TARGET',
    timeoutBars: 30,
  },
  
  // Elliott
  'ELLIOTT_5_WAVE': {
    entryType: 'RETEST_REJECTION',
    stopType: 'STRUCTURE_LOW',
    targetType: 'FIB_EXTENSION',
    timeoutBars: 50,
  },
  'CORRECTION_ABC': {
    entryType: 'RETEST_REJECTION',
    stopType: 'PATTERN_EXTREME',
    targetType: 'FIB_EXTENSION',
    timeoutBars: 40,
  },
  
  // Channels
  'CHANNEL_UP': {
    entryType: 'RETEST_REJECTION',
    stopType: 'ATR_BASED',
    targetType: 'NEXT_LEVEL',
    timeoutBars: 20,
  },
  'CHANNEL_DOWN': {
    entryType: 'RETEST_REJECTION',
    stopType: 'ATR_BASED',
    targetType: 'NEXT_LEVEL',
    timeoutBars: 20,
  },
};

/**
 * Get default protocol for pattern type
 */
export function getDefaultProtocol(patternType: string): ScenarioProtocol {
  return DEFAULT_PROTOCOLS[patternType] || {
    entryType: 'BREAKOUT_CLOSE',
    stopType: 'ATR_BASED',
    targetType: 'MEASURED_MOVE',
    timeoutBars: 40,
  };
}
