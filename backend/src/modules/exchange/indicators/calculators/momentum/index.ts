/**
 * S10.6I.2 — Momentum Indicators
 * 
 * Measure acceleration / decay of movement.
 * NOT direction, NOT overbought/oversold, NOT signal.
 * 
 * Momentum = energy of movement, not its meaning.
 * 
 * 6 indicators:
 * 1. RSI (Normalized)
 * 2. Stochastic Oscillator
 * 3. MACD Histogram Delta
 * 4. Rate of Change (ROC)
 * 5. Momentum Decay Index (MDI)
 * 6. Directional Momentum Balance (DMB)
 */

import {
  IndicatorCalculator,
  IndicatorValue,
  IndicatorInput,
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
// 1. RSI (NORMALIZED)
// ═══════════════════════════════════════════════════════════════

const RSI_PERIOD = 14;

export const rsiCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.MOMENTUM.RSI,
    name: 'RSI (Normalized)',
    category: 'MOMENTUM',
    description: 'Position of current momentum within its range, normalized to -1..+1',
    formula: '(RSI - 50) / 50, where RSI = 100 - (100 / (1 + RS))',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Momentum shifted down',
      neutral: 'Neutral momentum',
      high: 'Momentum shifted up',
    },
    dependencies: [],
    parameters: { period: RSI_PERIOD },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const closes = input.candles.map(c => c.close);
    
    if (closes.length < RSI_PERIOD + 1) {
      return {
        id: INDICATOR_IDS.MOMENTUM.RSI,
        category: 'MOMENTUM',
        value: 0,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    // Calculate gains and losses
    const gains: number[] = [];
    const losses: number[] = [];
    
    for (let i = 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }
    
    const avgGain = calculateEMA(gains, RSI_PERIOD);
    const avgLoss = calculateEMA(losses, RSI_PERIOD);
    
    let rsi: number;
    if (avgLoss === 0) {
      rsi = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi = 100 - (100 / (1 + rs));
    }
    
    // Normalize to -1..+1
    const normalized = (rsi - 50) / 50;
    
    let interpretation = 'Neutral momentum';
    if (normalized > 0.4) interpretation = 'Momentum shifted up';
    else if (normalized < -0.4) interpretation = 'Momentum shifted down';
    
    return {
      id: INDICATOR_IDS.MOMENTUM.RSI,
      category: 'MOMENTUM',
      value: Math.max(-1, Math.min(1, normalized)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 2. STOCHASTIC OSCILLATOR
// ═══════════════════════════════════════════════════════════════

const STOCH_PERIOD = 14;

export const stochasticCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.MOMENTUM.STOCHASTIC,
    name: 'Stochastic',
    category: 'MOMENTUM',
    description: 'Local acceleration within range, normalized to -1..+1',
    formula: '((close - lowestLow) / (highestHigh - lowestLow) - 0.5) * 2',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Acceleration toward lower boundary',
      neutral: 'Balanced',
      high: 'Acceleration toward upper boundary',
    },
    dependencies: [],
    parameters: { period: STOCH_PERIOD },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const recentCandles = input.candles.slice(-STOCH_PERIOD);
    
    if (recentCandles.length < 2) {
      return {
        id: INDICATOR_IDS.MOMENTUM.STOCHASTIC,
        category: 'MOMENTUM',
        value: 0,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);
    
    const highestHigh = Math.max(...highs);
    const lowestLow = Math.min(...lows);
    const range = highestHigh - lowestLow;
    
    let stoch: number;
    if (range === 0) {
      stoch = 0.5;
    } else {
      stoch = (input.price - lowestLow) / range;
    }
    
    // Normalize to -1..+1
    const normalized = (stoch - 0.5) * 2;
    
    let interpretation = 'Balanced';
    if (normalized > 0.6) interpretation = 'Acceleration toward upper boundary';
    else if (normalized < -0.6) interpretation = 'Acceleration toward lower boundary';
    
    return {
      id: INDICATOR_IDS.MOMENTUM.STOCHASTIC,
      category: 'MOMENTUM',
      value: Math.max(-1, Math.min(1, normalized)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 3. MACD HISTOGRAM DELTA
// ═══════════════════════════════════════════════════════════════

const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;

export const macdDeltaCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.MOMENTUM.MACD_DELTA,
    name: 'MACD Histogram Delta',
    category: 'MOMENTUM',
    description: 'Change in MACD histogram (momentum acceleration/decay), normalized by ATR',
    formula: '(Histogram_t - Histogram_t-1) / ATR',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Momentum decaying',
      neutral: 'Momentum stable',
      high: 'Momentum accelerating',
    },
    dependencies: [],
    parameters: { fast: MACD_FAST, slow: MACD_SLOW, signal: MACD_SIGNAL },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const closes = input.candles.map(c => c.close);
    
    if (closes.length < MACD_SLOW + MACD_SIGNAL) {
      return {
        id: INDICATOR_IDS.MOMENTUM.MACD_DELTA,
        category: 'MOMENTUM',
        value: 0,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    // Calculate MACD line
    const emaFast = calculateEMA(closes, MACD_FAST);
    const emaSlow = calculateEMA(closes, MACD_SLOW);
    const macdLine = emaFast - emaSlow;
    
    // Calculate MACD history for signal line
    const macdHistory: number[] = [];
    for (let i = MACD_SLOW; i <= closes.length; i++) {
      const slice = closes.slice(0, i);
      const fast = calculateEMA(slice, MACD_FAST);
      const slow = calculateEMA(slice, MACD_SLOW);
      macdHistory.push(fast - slow);
    }
    
    const signalLine = calculateEMA(macdHistory, MACD_SIGNAL);
    const histogram = macdLine - signalLine;
    
    // Calculate previous histogram
    const prevCloses = closes.slice(0, -1);
    const prevEmaFast = calculateEMA(prevCloses, MACD_FAST);
    const prevEmaSlow = calculateEMA(prevCloses, MACD_SLOW);
    const prevMacdLine = prevEmaFast - prevEmaSlow;
    
    const prevMacdHistory: number[] = [];
    for (let i = MACD_SLOW; i <= prevCloses.length; i++) {
      const slice = prevCloses.slice(0, i);
      const fast = calculateEMA(slice, MACD_FAST);
      const slow = calculateEMA(slice, MACD_SLOW);
      prevMacdHistory.push(fast - slow);
    }
    
    const prevSignalLine = calculateEMA(prevMacdHistory, MACD_SIGNAL);
    const prevHistogram = prevMacdLine - prevSignalLine;
    
    // Delta
    const delta = histogram - prevHistogram;
    const atr = calculateATR(input.candles);
    
    const normalized = atr > 0 ? delta / atr : 0;
    
    let interpretation = 'Momentum stable';
    if (normalized > 0.05) interpretation = 'Momentum accelerating';
    else if (normalized < -0.05) interpretation = 'Momentum decaying';
    
    return {
      id: INDICATOR_IDS.MOMENTUM.MACD_DELTA,
      category: 'MOMENTUM',
      value: Math.max(-1, Math.min(1, normalized)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 4. RATE OF CHANGE (ROC)
// ═══════════════════════════════════════════════════════════════

const ROC_PERIOD = 10;

export const rocCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.MOMENTUM.ROC,
    name: 'Rate of Change',
    category: 'MOMENTUM',
    description: 'Speed of price change, normalized by ATR',
    formula: '(close_t - close_t-N) / (close_t-N * ATR)',
    range: { min: -2, max: 2 },
    normalized: true,
    interpretations: {
      low: 'Strong negative momentum',
      neutral: 'Weak momentum',
      high: 'Strong positive momentum',
    },
    dependencies: [],
    parameters: { period: ROC_PERIOD },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const closes = input.candles.map(c => c.close);
    
    if (closes.length < ROC_PERIOD + 1) {
      return {
        id: INDICATOR_IDS.MOMENTUM.ROC,
        category: 'MOMENTUM',
        value: 0,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    const currentClose = closes[closes.length - 1];
    const pastClose = closes[closes.length - 1 - ROC_PERIOD];
    
    const roc = pastClose > 0 ? (currentClose - pastClose) / pastClose : 0;
    const atr = calculateATR(input.candles);
    const avgPrice = closes.slice(-ROC_PERIOD).reduce((a, b) => a + b, 0) / ROC_PERIOD;
    
    // Normalize: ROC relative to ATR/price
    const normalizedAtr = avgPrice > 0 ? atr / avgPrice : 0;
    const normalized = normalizedAtr > 0 ? roc / normalizedAtr : 0;
    
    let interpretation = 'Weak momentum';
    if (Math.abs(normalized) > 0.5) {
      interpretation = normalized > 0 ? 'Strong positive momentum' : 'Strong negative momentum';
    }
    
    return {
      id: INDICATOR_IDS.MOMENTUM.ROC,
      category: 'MOMENTUM',
      value: Math.max(-2, Math.min(2, normalized)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 5. MOMENTUM DECAY INDEX (MDI)
// ═══════════════════════════════════════════════════════════════

const MDI_SHORT = 5;
const MDI_LONG = 20;

export const momentumDecayCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.MOMENTUM.MOMENTUM_DECAY,
    name: 'Momentum Decay Index',
    category: 'MOMENTUM',
    description: 'Is momentum accelerating or dying? (short ROC / long ROC)',
    formula: 'ROC_short / ROC_long',
    range: { min: 0, max: 3 },
    normalized: true,
    interpretations: {
      low: 'Momentum decaying (exhaustion)',
      neutral: 'Momentum stable',
      high: 'Momentum accelerating',
    },
    dependencies: [],
    parameters: { shortPeriod: MDI_SHORT, longPeriod: MDI_LONG },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const closes = input.candles.map(c => c.close);
    
    if (closes.length < MDI_LONG + 1) {
      return {
        id: INDICATOR_IDS.MOMENTUM.MOMENTUM_DECAY,
        category: 'MOMENTUM',
        value: 1,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    const currentClose = closes[closes.length - 1];
    const shortPastClose = closes[closes.length - 1 - MDI_SHORT];
    const longPastClose = closes[closes.length - 1 - MDI_LONG];
    
    const rocShort = shortPastClose > 0 ? Math.abs((currentClose - shortPastClose) / shortPastClose) : 0;
    const rocLong = longPastClose > 0 ? Math.abs((currentClose - longPastClose) / longPastClose) : 0;
    
    // Normalize long ROC to per-period basis
    const rocLongNormalized = rocLong / (MDI_LONG / MDI_SHORT);
    
    const mdi = rocLongNormalized > 0.0001 ? rocShort / rocLongNormalized : 1;
    
    let interpretation = 'Momentum stable';
    if (mdi > 1.5) interpretation = 'Momentum accelerating';
    else if (mdi < 0.6) interpretation = 'Momentum decaying (exhaustion)';
    
    return {
      id: INDICATOR_IDS.MOMENTUM.MOMENTUM_DECAY,
      category: 'MOMENTUM',
      value: Math.max(0, Math.min(3, mdi)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 6. DIRECTIONAL MOMENTUM BALANCE (DMB)
// ═══════════════════════════════════════════════════════════════

const DMB_PERIOD = 14;

export const directionalBalanceCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.MOMENTUM.DIRECTIONAL_BALANCE,
    name: 'Directional Momentum Balance',
    category: 'MOMENTUM',
    description: 'Symmetry of up vs down impulses',
    formula: '(Up_Momentum - Down_Momentum) / (Up_Momentum + Down_Momentum)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Down-energy dominates',
      neutral: 'Balanced energy',
      high: 'Up-energy dominates',
    },
    dependencies: [],
    parameters: { period: DMB_PERIOD },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const closes = input.candles.map(c => c.close);
    
    if (closes.length < DMB_PERIOD + 1) {
      return {
        id: INDICATOR_IDS.MOMENTUM.DIRECTIONAL_BALANCE,
        category: 'MOMENTUM',
        value: 0,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    // Calculate ROC for each period
    let upMomentum = 0;
    let downMomentum = 0;
    
    const recentCloses = closes.slice(-DMB_PERIOD - 1);
    
    for (let i = 1; i < recentCloses.length; i++) {
      const change = recentCloses[i] - recentCloses[i - 1];
      if (change > 0) {
        upMomentum += change;
      } else {
        downMomentum += Math.abs(change);
      }
    }
    
    const total = upMomentum + downMomentum;
    const dmb = total > 0 ? (upMomentum - downMomentum) / total : 0;
    
    let interpretation = 'Balanced energy';
    if (dmb > 0.3) interpretation = 'Up-energy dominates';
    else if (dmb < -0.3) interpretation = 'Down-energy dominates';
    
    return {
      id: INDICATOR_IDS.MOMENTUM.DIRECTIONAL_BALANCE,
      category: 'MOMENTUM',
      value: Math.max(-1, Math.min(1, dmb)),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// EXPORT ALL CALCULATORS
// ═══════════════════════════════════════════════════════════════

export const momentumCalculators: IndicatorCalculator[] = [
  rsiCalculator,
  stochasticCalculator,
  macdDeltaCalculator,
  rocCalculator,
  momentumDecayCalculator,
  directionalBalanceCalculator,
];

console.log(`[S10.6I.2] Momentum calculators loaded: ${momentumCalculators.length}`);
