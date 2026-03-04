/**
 * Phase AD: Timeframe Specification
 * 
 * Enables TA Engine to work on any timeframe with proper scaling:
 * - Pattern windows scale with timeframe
 * - Projection speed adjusts
 * - ATR multipliers normalize volatility
 */

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME SPEC TYPE
// ═══════════════════════════════════════════════════════════════

export type TimeframeSpec = {
  id: string;
  label: string;
  
  // Time
  candleSeconds: number;
  candleMs: number;
  
  // Pattern detection windows
  minPatternCandles: number;
  maxPatternCandles: number;
  defaultLookback: number;
  
  // Scaling factors
  atrMultiplier: number;       // Scale ATR-based thresholds
  projectionSpeed: number;     // Scale projection path duration
  noiseThreshold: number;      // Minimum % move to consider significant
  
  // Behavior
  typicalPatternDuration: number;  // Avg bars for pattern to complete
  defaultTimeout: number;          // Bars before scenario expires
};

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME REGISTRY
// ═══════════════════════════════════════════════════════════════

export const TIMEFRAME_SPECS: Record<string, TimeframeSpec> = {
  '1m': {
    id: '1m',
    label: '1 Minute',
    candleSeconds: 60,
    candleMs: 60_000,
    minPatternCandles: 30,
    maxPatternCandles: 200,
    defaultLookback: 500,
    atrMultiplier: 0.6,
    projectionSpeed: 0.5,
    noiseThreshold: 0.1,
    typicalPatternDuration: 50,
    defaultTimeout: 100,
  },
  
  '5m': {
    id: '5m',
    label: '5 Minutes',
    candleSeconds: 300,
    candleMs: 300_000,
    minPatternCandles: 25,
    maxPatternCandles: 180,
    defaultLookback: 400,
    atrMultiplier: 0.7,
    projectionSpeed: 0.6,
    noiseThreshold: 0.15,
    typicalPatternDuration: 45,
    defaultTimeout: 90,
  },
  
  '15m': {
    id: '15m',
    label: '15 Minutes',
    candleSeconds: 900,
    candleMs: 900_000,
    minPatternCandles: 22,
    maxPatternCandles: 150,
    defaultLookback: 350,
    atrMultiplier: 0.8,
    projectionSpeed: 0.7,
    noiseThreshold: 0.2,
    typicalPatternDuration: 40,
    defaultTimeout: 80,
  },
  
  '1h': {
    id: '1h',
    label: '1 Hour',
    candleSeconds: 3600,
    candleMs: 3_600_000,
    minPatternCandles: 20,
    maxPatternCandles: 120,
    defaultLookback: 300,
    atrMultiplier: 1.0,
    projectionSpeed: 1.0,
    noiseThreshold: 0.3,
    typicalPatternDuration: 30,
    defaultTimeout: 60,
  },
  
  '4h': {
    id: '4h',
    label: '4 Hours',
    candleSeconds: 14400,
    candleMs: 14_400_000,
    minPatternCandles: 20,
    maxPatternCandles: 120,
    defaultLookback: 300,
    atrMultiplier: 1.2,
    projectionSpeed: 1.1,
    noiseThreshold: 0.4,
    typicalPatternDuration: 25,
    defaultTimeout: 50,
  },
  
  '1d': {
    id: '1d',
    label: '1 Day',
    candleSeconds: 86400,
    candleMs: 86_400_000,
    minPatternCandles: 30,
    maxPatternCandles: 200,
    defaultLookback: 400,
    atrMultiplier: 1.4,
    projectionSpeed: 1.2,
    noiseThreshold: 0.5,
    typicalPatternDuration: 20,
    defaultTimeout: 40,
  },
  
  '1w': {
    id: '1w',
    label: '1 Week',
    candleSeconds: 604800,
    candleMs: 604_800_000,
    minPatternCandles: 15,
    maxPatternCandles: 100,
    defaultLookback: 200,
    atrMultiplier: 1.6,
    projectionSpeed: 1.3,
    noiseThreshold: 1.0,
    typicalPatternDuration: 12,
    defaultTimeout: 25,
  },
  
  '1M': {
    id: '1M',
    label: '1 Month',
    candleSeconds: 2592000,
    candleMs: 2_592_000_000,
    minPatternCandles: 10,
    maxPatternCandles: 60,
    defaultLookback: 120,
    atrMultiplier: 1.8,
    projectionSpeed: 1.5,
    noiseThreshold: 2.0,
    typicalPatternDuration: 8,
    defaultTimeout: 15,
  },
};

// Aliases
TIMEFRAME_SPECS['1D'] = TIMEFRAME_SPECS['1d'];
TIMEFRAME_SPECS['4H'] = TIMEFRAME_SPECS['4h'];
TIMEFRAME_SPECS['1H'] = TIMEFRAME_SPECS['1h'];
TIMEFRAME_SPECS['1W'] = TIMEFRAME_SPECS['1w'];

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Get timeframe spec with fallback to 1D
 */
export function getTimeframeSpec(tf: string): TimeframeSpec {
  const normalized = tf.toLowerCase();
  return TIMEFRAME_SPECS[normalized] || TIMEFRAME_SPECS[tf] || TIMEFRAME_SPECS['1d'];
}

/**
 * Get all supported timeframes
 */
export function getSupportedTimeframes(): string[] {
  return ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];
}

/**
 * Check if timeframe is valid
 */
export function isValidTimeframe(tf: string): boolean {
  const normalized = tf.toLowerCase();
  return normalized in TIMEFRAME_SPECS || tf in TIMEFRAME_SPECS;
}

/**
 * Scale a value by timeframe ATR multiplier
 */
export function scaleByTimeframe(value: number, tf: string): number {
  const spec = getTimeframeSpec(tf);
  return value * spec.atrMultiplier;
}

/**
 * Get pattern window for timeframe
 */
export function getPatternWindow(tf: string): { min: number; max: number } {
  const spec = getTimeframeSpec(tf);
  return {
    min: spec.minPatternCandles,
    max: spec.maxPatternCandles,
  };
}

/**
 * Get projection duration scaled by timeframe
 */
export function getProjectionDuration(baseDuration: number, tf: string): number {
  const spec = getTimeframeSpec(tf);
  return Math.round(baseDuration * spec.projectionSpeed);
}

/**
 * Get default timeout for scenarios
 */
export function getDefaultTimeout(tf: string): number {
  const spec = getTimeframeSpec(tf);
  return spec.defaultTimeout;
}

/**
 * Convert bars to time duration string
 */
export function barsToTimeString(bars: number, tf: string): string {
  const spec = getTimeframeSpec(tf);
  const totalSeconds = bars * spec.candleSeconds;
  
  if (totalSeconds < 3600) {
    return `${Math.round(totalSeconds / 60)}m`;
  } else if (totalSeconds < 86400) {
    return `${Math.round(totalSeconds / 3600)}h`;
  } else if (totalSeconds < 604800) {
    return `${Math.round(totalSeconds / 86400)}d`;
  } else {
    return `${Math.round(totalSeconds / 604800)}w`;
  }
}

/**
 * Normalize threshold by timeframe
 * Lower timeframes need tighter thresholds
 */
export function normalizeThreshold(threshold: number, tf: string): number {
  const spec = getTimeframeSpec(tf);
  return threshold * spec.noiseThreshold / 0.5; // Normalized to 1D as baseline
}
