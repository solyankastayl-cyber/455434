/**
 * S10.6I.3 — Volume / Participation Indicators
 * 
 * Measure market participation.
 * Is there real money behind the move, or is it noise?
 * 
 * NOT about direction.
 * NOT about signals.
 * ABOUT the fact of presence/absence of interest.
 * 
 * 6 indicators:
 * 13. Total Volume Index (TVI)
 * 14. Volume Delta
 * 15. Buy / Sell Ratio (BSR)
 * 16. Volume vs Price Response (VPR)
 * 17. Relative Volume Index (RVI)
 * 18. Participation Intensity (PI)
 */

import {
  IndicatorCalculator,
  IndicatorValue,
  IndicatorInput,
  OHLCVCandle,
  INDICATOR_IDS,
} from '../../indicator.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPER: Simple Moving Average
// ═══════════════════════════════════════════════════════════════

function calculateSMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Median
// ═══════════════════════════════════════════════════════════════

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Percentile Rank
// ═══════════════════════════════════════════════════════════════

function percentileRank(value: number, history: number[]): number {
  if (history.length === 0) return 0.5;
  const belowCount = history.filter(v => v < value).length;
  return belowCount / history.length;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Clamp
// ═══════════════════════════════════════════════════════════════

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Extract volume data from candles
// ═══════════════════════════════════════════════════════════════

function extractVolumeData(candles: OHLCVCandle[]) {
  const volumes = candles.map(c => c.volume);
  const totalVolume = volumes.reduce((a, b) => a + b, 0);
  const currentVolume = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
  
  // Simulate buy/sell split based on candle direction
  // In production, this would come from trade data
  let buyVolume = 0;
  let sellVolume = 0;
  
  for (const candle of candles) {
    const isBullish = candle.close >= candle.open;
    if (isBullish) {
      buyVolume += candle.volume * 0.6;  // 60% buy on green candle
      sellVolume += candle.volume * 0.4;
    } else {
      buyVolume += candle.volume * 0.4;
      sellVolume += candle.volume * 0.6;  // 60% sell on red candle
    }
  }
  
  return {
    volumes,
    totalVolume,
    currentVolume,
    buyVolume,
    sellVolume,
  };
}

// ═══════════════════════════════════════════════════════════════
// 13. TOTAL VOLUME INDEX (TVI)
// ═══════════════════════════════════════════════════════════════

const TVI_PERIOD = 20;

export const totalVolumeIndexCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.VOLUME.VOLUME_INDEX,
    name: 'Total Volume Index',
    category: 'VOLUME',
    description: 'Current volume relative to its moving average norm',
    formula: 'TVI = currentVolume / SMA(volume, N); normalized = clamp(TVI - 1, -1, +1)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Market is empty / low participation',
      neutral: 'Normal market activity',
      high: 'Participation spike',
    },
    dependencies: [],
    parameters: { period: TVI_PERIOD },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const { volumes, currentVolume } = extractVolumeData(input.candles);
    
    if (volumes.length < TVI_PERIOD) {
      return {
        id: INDICATOR_IDS.VOLUME.VOLUME_INDEX,
        category: 'VOLUME',
        value: 0,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    const sma = calculateSMA(volumes, TVI_PERIOD);
    const tvi = sma > 0 ? currentVolume / sma : 1;
    const normalized = clamp(tvi - 1, -1, 1);
    
    let interpretation = 'Normal market activity';
    if (normalized > 0.5) interpretation = 'Participation spike';
    else if (normalized < -0.5) interpretation = 'Market is empty / low participation';
    
    return {
      id: INDICATOR_IDS.VOLUME.VOLUME_INDEX,
      category: 'VOLUME',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 14. VOLUME DELTA
// ═══════════════════════════════════════════════════════════════

export const volumeDeltaCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.VOLUME.VOLUME_DELTA,
    name: 'Volume Delta',
    category: 'VOLUME',
    description: 'Aggressive buyers vs sellers (buy - sell normalized by total)',
    formula: 'delta = buyVolume - sellVolume; normalized = delta / totalVolume',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Seller pressure dominates',
      neutral: 'Balanced pressure',
      high: 'Buyer pressure dominates',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const { totalVolume, buyVolume, sellVolume } = extractVolumeData(input.candles);
    
    if (totalVolume === 0) {
      return {
        id: INDICATOR_IDS.VOLUME.VOLUME_DELTA,
        category: 'VOLUME',
        value: 0,
        normalized: true,
        interpretation: 'No volume data',
        timestamp: Date.now(),
      };
    }
    
    const delta = buyVolume - sellVolume;
    const normalized = clamp(delta / totalVolume, -1, 1);
    
    let interpretation = 'Balanced pressure';
    if (normalized > 0.2) interpretation = 'Buyer pressure dominates';
    else if (normalized < -0.2) interpretation = 'Seller pressure dominates';
    
    return {
      id: INDICATOR_IDS.VOLUME.VOLUME_DELTA,
      category: 'VOLUME',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 15. BUY / SELL RATIO (BSR)
// ═══════════════════════════════════════════════════════════════

export const buySellRatioCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.VOLUME.BUY_SELL_RATIO,
    name: 'Buy / Sell Ratio',
    category: 'VOLUME',
    description: 'Activity skew between buyers and sellers (log normalized)',
    formula: 'BSR = buyVolume / max(sellVolume, ε); normalized = clamp(log(BSR), -1, +1)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Skewed toward selling',
      neutral: 'Balanced activity',
      high: 'Skewed toward buying',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const { buyVolume, sellVolume } = extractVolumeData(input.candles);
    
    const epsilon = 0.0001;
    const bsr = buyVolume / Math.max(sellVolume, epsilon);
    
    // Log normalize: log(1) = 0, log(2) ≈ 0.69, log(0.5) ≈ -0.69
    const logBsr = Math.log(bsr);
    const normalized = clamp(logBsr, -1, 1);
    
    let interpretation = 'Balanced activity';
    if (normalized > 0.4) interpretation = 'Skewed toward buying';
    else if (normalized < -0.4) interpretation = 'Skewed toward selling';
    
    return {
      id: INDICATOR_IDS.VOLUME.BUY_SELL_RATIO,
      category: 'VOLUME',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 16. VOLUME VS PRICE RESPONSE (VPR)
// ═══════════════════════════════════════════════════════════════

export const volumePriceResponseCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.VOLUME.VOLUME_PRICE_RESPONSE,
    name: 'Volume vs Price Response',
    category: 'VOLUME',
    description: 'Does price move when money enters? (percentile ranked)',
    formula: 'VPR = abs(priceChange) / max(volume, ε); normalized = percentileRank(VPR, history)',
    range: { min: 0, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Absorption (volume without price move)',
      neutral: 'Normal response',
      high: 'Sensitive market (price moves easily)',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const candles = input.candles;
    
    if (candles.length < 10) {
      return {
        id: INDICATOR_IDS.VOLUME.VOLUME_PRICE_RESPONSE,
        category: 'VOLUME',
        value: 0.5,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    // Calculate VPR history
    const vprHistory: number[] = [];
    const epsilon = 0.0001;
    
    for (let i = 1; i < candles.length; i++) {
      const priceChange = Math.abs(candles[i].close - candles[i - 1].close);
      const volume = Math.max(candles[i].volume, epsilon);
      vprHistory.push(priceChange / volume);
    }
    
    // Current VPR
    const currentCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const currentPriceChange = Math.abs(currentCandle.close - prevCandle.close);
    const currentVPR = currentPriceChange / Math.max(currentCandle.volume, epsilon);
    
    // Percentile rank
    const normalized = percentileRank(currentVPR, vprHistory);
    
    let interpretation = 'Normal response';
    if (normalized < 0.3) interpretation = 'Absorption (volume without price move)';
    else if (normalized > 0.7) interpretation = 'Sensitive market (price moves easily)';
    
    return {
      id: INDICATOR_IDS.VOLUME.VOLUME_PRICE_RESPONSE,
      category: 'VOLUME',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 17. RELATIVE VOLUME INDEX (RVI)
// ═══════════════════════════════════════════════════════════════

export const relativeVolumeIndexCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.VOLUME.RELATIVE_VOLUME,
    name: 'Relative Volume Index',
    category: 'VOLUME',
    description: 'Current volume vs median — is this noise or an event?',
    formula: 'RVI = currentVolume / median(volumeHistory); normalized = clamp((RVI - 1) / 2, -1, +1)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Routine / quiet market',
      neutral: 'Typical activity',
      high: 'Elevated interest / potential event',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const { volumes, currentVolume } = extractVolumeData(input.candles);
    
    if (volumes.length < 10) {
      return {
        id: INDICATOR_IDS.VOLUME.RELATIVE_VOLUME,
        category: 'VOLUME',
        value: 0,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    const median = calculateMedian(volumes.slice(0, -1)); // Exclude current
    const rvi = median > 0 ? currentVolume / median : 1;
    const normalized = clamp((rvi - 1) / 2, -1, 1);
    
    let interpretation = 'Typical activity';
    if (normalized < -0.3) interpretation = 'Routine / quiet market';
    else if (normalized > 0.5) interpretation = 'Elevated interest / potential event';
    
    return {
      id: INDICATOR_IDS.VOLUME.RELATIVE_VOLUME,
      category: 'VOLUME',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 18. PARTICIPATION INTENSITY (PI)
// ═══════════════════════════════════════════════════════════════

export const participationIntensityCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.VOLUME.PARTICIPATION_INTENSITY,
    name: 'Participation Intensity',
    category: 'VOLUME',
    description: 'Is the market alive or thin? (trade density)',
    formula: 'PI = (tradesCount * volume) / timeWindow; normalized = percentileRank(PI, history)',
    range: { min: 0, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Thin market / low density',
      neutral: 'Normal participation',
      high: 'Dense participation / high activity',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const candles = input.candles;
    
    if (candles.length < 10) {
      return {
        id: INDICATOR_IDS.VOLUME.PARTICIPATION_INTENSITY,
        category: 'VOLUME',
        value: 0.5,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    // Estimate trades count from volume & price range (proxy)
    // In production, this would come from actual trade data
    const piHistory: number[] = [];
    
    for (const candle of candles) {
      const range = candle.high - candle.low;
      const avgPrice = (candle.high + candle.low) / 2;
      const estimatedTrades = avgPrice > 0 ? candle.volume / avgPrice * 100 : 0;
      const intensity = estimatedTrades * candle.volume;
      piHistory.push(intensity);
    }
    
    const currentPI = piHistory[piHistory.length - 1];
    const normalized = percentileRank(currentPI, piHistory.slice(0, -1));
    
    let interpretation = 'Normal participation';
    if (normalized < 0.3) interpretation = 'Thin market / low density';
    else if (normalized > 0.7) interpretation = 'Dense participation / high activity';
    
    return {
      id: INDICATOR_IDS.VOLUME.PARTICIPATION_INTENSITY,
      category: 'VOLUME',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// EXPORT ALL CALCULATORS
// ═══════════════════════════════════════════════════════════════

export const volumeCalculators: IndicatorCalculator[] = [
  totalVolumeIndexCalculator,
  volumeDeltaCalculator,
  buySellRatioCalculator,
  volumePriceResponseCalculator,
  relativeVolumeIndexCalculator,
  participationIntensityCalculator,
];

console.log(`[S10.6I.3] Volume / Participation calculators loaded: ${volumeCalculators.length}`);
