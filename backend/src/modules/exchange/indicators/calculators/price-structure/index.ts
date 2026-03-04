/**
 * S10.6I.1 — Price Structure Indicators
 * 
 * Measure where price is relative to its own norm.
 * NOT direction, NOT prediction, NOT signal.
 * 
 * 6 indicators:
 * 1. EMA Distance (fast/mid/slow)
 * 2. VWAP Deviation
 * 3. Median Price Deviation
 * 4. ATR Normalized
 * 5. Trend Slope
 * 6. Range Compression Index
 */

import {
  IndicatorCalculator,
  IndicatorValue,
  IndicatorInput,
  IndicatorDefinition,
  OHLCVCandle,
  INDICATOR_IDS,
} from '../../indicator.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPER: Calculate EMA
// ═══════════════════════════════════════════════════════════════

function calculateEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) return values[values.length - 1];
  
  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Calculate ATR
// ═══════════════════════════════════════════════════════════════

function calculateATR(candles: OHLCVCandle[], period: number = 14): number {
  if (candles.length < 2) return 0;
  
  const trueRanges: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  if (trueRanges.length === 0) return 0;
  
  return calculateEMA(trueRanges, Math.min(period, trueRanges.length));
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Linear Regression Slope
// ═══════════════════════════════════════════════════════════════

function calculateSlope(values: number[]): number {
  if (values.length < 2) return 0;
  
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;
  
  return (n * sumXY - sumX * sumY) / denominator;
}

// ═══════════════════════════════════════════════════════════════
// 1. EMA DISTANCE (FAST)
// ═══════════════════════════════════════════════════════════════

const EMA_FAST_PERIOD = 9;

export const emaDistanceFastCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.PRICE_STRUCTURE.EMA_DISTANCE_FAST,
    name: 'EMA Distance (Fast)',
    category: 'PRICE_STRUCTURE',
    description: 'Distance from price to fast EMA, normalized by ATR',
    formula: '(close - EMA_9) / ATR',
    range: { min: -3, max: 3 },
    normalized: true,
    interpretations: {
      low: 'Price significantly below fast EMA',
      neutral: 'Price near fast EMA',
      high: 'Price significantly above fast EMA',
    },
    dependencies: [],
    parameters: { period: EMA_FAST_PERIOD },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const closes = input.candles.map(c => c.close);
    const ema = calculateEMA(closes, EMA_FAST_PERIOD);
    const atr = calculateATR(input.candles);
    
    const distance = atr > 0 ? (input.price - ema) / atr : 0;
    
    let interpretation = 'Price near fast EMA';
    if (distance > 1) interpretation = 'Price stretched above fast EMA';
    else if (distance < -1) interpretation = 'Price stretched below fast EMA';
    
    return {
      id: INDICATOR_IDS.PRICE_STRUCTURE.EMA_DISTANCE_FAST,
      category: 'PRICE_STRUCTURE',
      value: Math.max(-3, Math.min(3, distance)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 2. EMA DISTANCE (MID)
// ═══════════════════════════════════════════════════════════════

const EMA_MID_PERIOD = 21;

export const emaDistanceMidCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.PRICE_STRUCTURE.EMA_DISTANCE_MID,
    name: 'EMA Distance (Mid)',
    category: 'PRICE_STRUCTURE',
    description: 'Distance from price to mid EMA, normalized by ATR',
    formula: '(close - EMA_21) / ATR',
    range: { min: -3, max: 3 },
    normalized: true,
    interpretations: {
      low: 'Price significantly below mid EMA',
      neutral: 'Price near mid EMA',
      high: 'Price significantly above mid EMA',
    },
    dependencies: [],
    parameters: { period: EMA_MID_PERIOD },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const closes = input.candles.map(c => c.close);
    const ema = calculateEMA(closes, EMA_MID_PERIOD);
    const atr = calculateATR(input.candles);
    
    const distance = atr > 0 ? (input.price - ema) / atr : 0;
    
    let interpretation = 'Price near mid EMA';
    if (distance > 1.5) interpretation = 'Price stretched above mid EMA';
    else if (distance < -1.5) interpretation = 'Price stretched below mid EMA';
    
    return {
      id: INDICATOR_IDS.PRICE_STRUCTURE.EMA_DISTANCE_MID,
      category: 'PRICE_STRUCTURE',
      value: Math.max(-3, Math.min(3, distance)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 3. EMA DISTANCE (SLOW)
// ═══════════════════════════════════════════════════════════════

const EMA_SLOW_PERIOD = 50;

export const emaDistanceSlowCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.PRICE_STRUCTURE.EMA_DISTANCE_SLOW,
    name: 'EMA Distance (Slow)',
    category: 'PRICE_STRUCTURE',
    description: 'Distance from price to slow EMA, normalized by ATR',
    formula: '(close - EMA_50) / ATR',
    range: { min: -5, max: 5 },
    normalized: true,
    interpretations: {
      low: 'Price significantly below slow EMA',
      neutral: 'Price near slow EMA',
      high: 'Price significantly above slow EMA',
    },
    dependencies: [],
    parameters: { period: EMA_SLOW_PERIOD },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const closes = input.candles.map(c => c.close);
    const ema = calculateEMA(closes, EMA_SLOW_PERIOD);
    const atr = calculateATR(input.candles);
    
    const distance = atr > 0 ? (input.price - ema) / atr : 0;
    
    let interpretation = 'Price near slow EMA';
    if (distance > 2) interpretation = 'Price far above slow EMA (extended)';
    else if (distance < -2) interpretation = 'Price far below slow EMA (extended)';
    
    return {
      id: INDICATOR_IDS.PRICE_STRUCTURE.EMA_DISTANCE_SLOW,
      category: 'PRICE_STRUCTURE',
      value: Math.max(-5, Math.min(5, distance)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 4. VWAP DEVIATION
// ═══════════════════════════════════════════════════════════════

export const vwapDeviationCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.PRICE_STRUCTURE.VWAP_DEVIATION,
    name: 'VWAP Deviation',
    category: 'PRICE_STRUCTURE',
    description: 'Distance from price to VWAP (volume-weighted average price), normalized by ATR',
    formula: '(close - VWAP) / ATR',
    range: { min: -3, max: 3 },
    normalized: true,
    interpretations: {
      low: 'Price trading at discount to fair value',
      neutral: 'Price near fair value',
      high: 'Price trading at premium to fair value',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    // Calculate VWAP
    let sumPriceVolume = 0;
    let sumVolume = 0;
    
    for (const candle of input.candles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      sumPriceVolume += typicalPrice * candle.volume;
      sumVolume += candle.volume;
    }
    
    const vwap = sumVolume > 0 ? sumPriceVolume / sumVolume : input.price;
    const atr = calculateATR(input.candles);
    
    const deviation = atr > 0 ? (input.price - vwap) / atr : 0;
    
    let interpretation = 'Price near VWAP (fair value)';
    if (deviation > 1) interpretation = 'Price at premium to VWAP';
    else if (deviation < -1) interpretation = 'Price at discount to VWAP';
    
    return {
      id: INDICATOR_IDS.PRICE_STRUCTURE.VWAP_DEVIATION,
      category: 'PRICE_STRUCTURE',
      value: Math.max(-3, Math.min(3, deviation)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 5. MEDIAN PRICE DEVIATION
// ═══════════════════════════════════════════════════════════════

export const medianPriceDeviationCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.PRICE_STRUCTURE.MEDIAN_PRICE_DEVIATION,
    name: 'Median Price Deviation',
    category: 'PRICE_STRUCTURE',
    description: 'Where close is relative to session median (H+L)/2, normalized by ATR',
    formula: '(close - median) / ATR, median = (high + low) / 2',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Close near session low',
      neutral: 'Close at session midpoint',
      high: 'Close near session high',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    if (input.candles.length === 0) {
      return {
        id: INDICATOR_IDS.PRICE_STRUCTURE.MEDIAN_PRICE_DEVIATION,
        category: 'PRICE_STRUCTURE',
        value: 0,
        normalized: true,
        interpretation: 'No data',
        timestamp: Date.now(),
      };
    }
    
    // Use recent candle
    const recent = input.candles[input.candles.length - 1];
    const medianPrice = (recent.high + recent.low) / 2;
    const range = recent.high - recent.low;
    
    // Normalize to -1..1 based on position in range
    const deviation = range > 0 
      ? (input.price - medianPrice) / (range / 2)
      : 0;
    
    let interpretation = 'Close at session midpoint';
    if (deviation > 0.5) interpretation = 'Close near session high';
    else if (deviation < -0.5) interpretation = 'Close near session low';
    
    return {
      id: INDICATOR_IDS.PRICE_STRUCTURE.MEDIAN_PRICE_DEVIATION,
      category: 'PRICE_STRUCTURE',
      value: Math.max(-1, Math.min(1, deviation)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 6. ATR NORMALIZED (Volatility Stretch)
// ═══════════════════════════════════════════════════════════════

const ATR_SHORT_PERIOD = 14;
const ATR_LONG_PERIOD = 50;

export const atrNormalizedCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.PRICE_STRUCTURE.ATR_NORMALIZED,
    name: 'ATR Normalized',
    category: 'PRICE_STRUCTURE',
    description: 'Current ATR relative to historical average (volatility stretch)',
    formula: 'ATR_current / EMA(ATR, long_period)',
    range: { min: 0, max: 3 },
    normalized: true,
    interpretations: {
      low: 'Volatility compressed (squeeze)',
      neutral: 'Normal volatility',
      high: 'Volatility expanded (breakout)',
    },
    dependencies: [],
    parameters: { shortPeriod: ATR_SHORT_PERIOD, longPeriod: ATR_LONG_PERIOD },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    // Calculate ATR history
    const trueRanges: number[] = [];
    
    for (let i = 1; i < input.candles.length; i++) {
      const high = input.candles[i].high;
      const low = input.candles[i].low;
      const prevClose = input.candles[i - 1].close;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }
    
    if (trueRanges.length < ATR_SHORT_PERIOD) {
      return {
        id: INDICATOR_IDS.PRICE_STRUCTURE.ATR_NORMALIZED,
        category: 'PRICE_STRUCTURE',
        value: 1,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    const atrCurrent = calculateEMA(trueRanges, ATR_SHORT_PERIOD);
    const atrMean = calculateEMA(trueRanges, Math.min(ATR_LONG_PERIOD, trueRanges.length));
    
    const ratio = atrMean > 0 ? atrCurrent / atrMean : 1;
    
    let interpretation = 'Normal volatility';
    if (ratio > 1.5) interpretation = 'Volatility expanded (high energy)';
    else if (ratio < 0.7) interpretation = 'Volatility compressed (squeeze forming)';
    
    return {
      id: INDICATOR_IDS.PRICE_STRUCTURE.ATR_NORMALIZED,
      category: 'PRICE_STRUCTURE',
      value: Math.max(0, Math.min(3, ratio)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 7. TREND SLOPE
// ═══════════════════════════════════════════════════════════════

const SLOPE_PERIOD = 20;

export const trendSlopeCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.PRICE_STRUCTURE.TREND_SLOPE,
    name: 'Trend Slope',
    category: 'PRICE_STRUCTURE',
    description: 'Linear regression slope of price, normalized by ATR',
    formula: 'linreg_slope(close, N) / ATR',
    range: { min: -2, max: 2 },
    normalized: true,
    interpretations: {
      low: 'Strong downtrend',
      neutral: 'Flat / no trend',
      high: 'Strong uptrend',
    },
    dependencies: [],
    parameters: { period: SLOPE_PERIOD },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const closes = input.candles.slice(-SLOPE_PERIOD).map(c => c.close);
    const slope = calculateSlope(closes);
    const atr = calculateATR(input.candles);
    
    const normalizedSlope = atr > 0 ? slope / atr : 0;
    
    let interpretation = 'Flat / no trend';
    if (normalizedSlope > 0.1) interpretation = 'Uptrend detected';
    else if (normalizedSlope < -0.1) interpretation = 'Downtrend detected';
    if (Math.abs(normalizedSlope) > 0.3) {
      interpretation = normalizedSlope > 0 ? 'Strong uptrend' : 'Strong downtrend';
    }
    
    return {
      id: INDICATOR_IDS.PRICE_STRUCTURE.TREND_SLOPE,
      category: 'PRICE_STRUCTURE',
      value: Math.max(-2, Math.min(2, normalizedSlope)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 8. RANGE COMPRESSION INDEX
// ═══════════════════════════════════════════════════════════════

const RCI_SHORT_PERIOD = 5;
const RCI_LONG_PERIOD = 20;

export const rangeCompressionCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.PRICE_STRUCTURE.RANGE_COMPRESSION,
    name: 'Range Compression Index',
    category: 'PRICE_STRUCTURE',
    description: 'Current range vs historical average (compression vs expansion)',
    formula: 'range_current / EMA(range, long_period)',
    range: { min: 0, max: 3 },
    normalized: true,
    interpretations: {
      low: 'Range compressed (breakout potential)',
      neutral: 'Normal range',
      high: 'Range expanded',
    },
    dependencies: [],
    parameters: { shortPeriod: RCI_SHORT_PERIOD, longPeriod: RCI_LONG_PERIOD },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const ranges = input.candles.map(c => c.high - c.low);
    
    if (ranges.length < RCI_SHORT_PERIOD) {
      return {
        id: INDICATOR_IDS.PRICE_STRUCTURE.RANGE_COMPRESSION,
        category: 'PRICE_STRUCTURE',
        value: 1,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    const rangeCurrent = calculateEMA(ranges.slice(-RCI_SHORT_PERIOD), RCI_SHORT_PERIOD);
    const rangeMean = calculateEMA(ranges, Math.min(RCI_LONG_PERIOD, ranges.length));
    
    const rci = rangeMean > 0 ? rangeCurrent / rangeMean : 1;
    
    let interpretation = 'Normal range';
    if (rci < 0.6) interpretation = 'Range compressed (pre-breakout)';
    else if (rci > 1.5) interpretation = 'Range expanded (high volatility)';
    
    return {
      id: INDICATOR_IDS.PRICE_STRUCTURE.RANGE_COMPRESSION,
      category: 'PRICE_STRUCTURE',
      value: Math.max(0, Math.min(3, rci)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// EXPORT ALL CALCULATORS
// ═══════════════════════════════════════════════════════════════

export const priceStructureCalculators: IndicatorCalculator[] = [
  emaDistanceFastCalculator,
  emaDistanceMidCalculator,
  emaDistanceSlowCalculator,
  vwapDeviationCalculator,
  medianPriceDeviationCalculator,
  atrNormalizedCalculator,
  trendSlopeCalculator,
  rangeCompressionCalculator,
];

console.log(`[S10.6I.1] Price Structure calculators loaded: ${priceStructureCalculators.length}`);
