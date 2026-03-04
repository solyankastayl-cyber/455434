/**
 * S10.6I.5 — Positioning / Derivatives Indicators
 * 
 * Measure how participants are positioned and how crowded the market is.
 * NOT "where price will go", but how DANGEROUS the current position configuration is.
 * 
 * This is RISK ASSESSMENT, not DIRECTION.
 * 
 * 6 indicators:
 * 25. Open Interest Level (OIL)
 * 26. Open Interest Delta (OID)
 * 27. OI / Volume Ratio (OVR)
 * 28. Funding Rate Pressure (FRP)
 * 29. Long / Short Ratio (LSR)
 * 30. Position Crowding Index (PCI)
 */

import {
  IndicatorCalculator,
  IndicatorValue,
  IndicatorInput,
  OHLCVCandle,
  INDICATOR_IDS,
} from '../../indicator.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPER: Clamp
// ═══════════════════════════════════════════════════════════════

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ═══════════════════════════════════════════════════════════════
// HELPER: SMA
// ═══════════════════════════════════════════════════════════════

function calculateSMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Percentile
// ═══════════════════════════════════════════════════════════════

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Derivatives Data Structure
// ═══════════════════════════════════════════════════════════════

interface DerivativesSnapshot {
  openInterest: number;
  openInterestPrev: number;
  openInterestHistory: number[];
  fundingRate: number;
  fundingRateAvg: number;
  longPositions: number;
  shortPositions: number;
  volume: number;
}

function extractDerivativesData(input: IndicatorInput): DerivativesSnapshot {
  const candles = input.candles;
  const seed = input.symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
  // Base values from candles
  const totalVolume = candles.reduce((sum, c) => sum + c.volume, 0);
  const avgVolume = totalVolume / Math.max(1, candles.length);
  const price = input.price;
  
  // Generate synthetic OI based on volume patterns
  // In production, this would come from exchange API
  const oiHistory: number[] = [];
  let baseOI = avgVolume * 50; // OI typically much larger than single-candle volume
  
  for (let i = 0; i < candles.length; i++) {
    const volumeRatio = candles[i].volume / Math.max(1, avgVolume);
    const change = (Math.sin(seed + i * 0.1) * 0.03 + (volumeRatio - 1) * 0.01) * baseOI;
    baseOI += change;
    oiHistory.push(Math.max(0, baseOI));
  }
  
  const currentOI = oiHistory.length > 0 ? oiHistory[oiHistory.length - 1] : baseOI;
  const prevOI = oiHistory.length > 1 ? oiHistory[oiHistory.length - 2] : currentOI;
  
  // Use real OI data if provided
  const realOI = input.openInterest;
  const openInterest = realOI?.value ?? currentOI;
  const openInterestPrev = prevOI;
  
  // Funding rate simulation based on price momentum
  const recentCandles = candles.slice(-20);
  const priceChange = recentCandles.length > 1 
    ? (recentCandles[recentCandles.length - 1].close - recentCandles[0].close) / recentCandles[0].close
    : 0;
  
  // Funding rate: positive when longs pay shorts (bullish crowding)
  const fundingRate = input.fundingRate ?? (priceChange * 0.001 + Math.sin(seed) * 0.0005);
  const fundingRateAvg = Math.abs(fundingRate) * 0.8; // Historical avg slightly lower
  
  // Long/Short ratio based on price action
  // Green candles increase longs estimate, red candles increase shorts
  let longWeight = 0;
  let shortWeight = 0;
  
  for (const candle of recentCandles) {
    const isBullish = candle.close >= candle.open;
    if (isBullish) {
      longWeight += candle.volume * 1.2;
      shortWeight += candle.volume * 0.8;
    } else {
      longWeight += candle.volume * 0.8;
      shortWeight += candle.volume * 1.2;
    }
  }
  
  return {
    openInterest,
    openInterestPrev,
    openInterestHistory: oiHistory,
    fundingRate,
    fundingRateAvg,
    longPositions: longWeight,
    shortPositions: shortWeight,
    volume: totalVolume,
  };
}

// ═══════════════════════════════════════════════════════════════
// 25. OPEN INTEREST LEVEL (OIL)
// ═══════════════════════════════════════════════════════════════

const OIL_PERIOD = 20;

export const openInterestLevelCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.POSITIONING.OI_LEVEL,
    name: 'Open Interest Level',
    category: 'POSITIONING',
    description: 'How loaded is the market with positions relative to norm',
    formula: 'OIL = currentOI / SMA(OI, N); normalized = clamp(OIL - 1, -1, +1)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Market emptying (positions closing)',
      neutral: 'Normal position levels',
      high: 'Market overloaded with positions',
    },
    dependencies: [],
    parameters: { period: OIL_PERIOD },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const data = extractDerivativesData(input);
    
    if (data.openInterestHistory.length < OIL_PERIOD) {
      return {
        id: INDICATOR_IDS.POSITIONING.OI_LEVEL,
        category: 'POSITIONING',
        value: 0,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    const smaOI = calculateSMA(data.openInterestHistory, OIL_PERIOD);
    const oil = smaOI > 0 ? data.openInterest / smaOI : 1;
    const normalized = clamp(oil - 1, -1, 1);
    
    let interpretation = 'Normal position levels';
    if (normalized > 0.3) interpretation = 'Market overloaded with positions';
    else if (normalized < -0.3) interpretation = 'Market emptying (positions closing)';
    
    return {
      id: INDICATOR_IDS.POSITIONING.OI_LEVEL,
      category: 'POSITIONING',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 26. OPEN INTEREST DELTA (OID)
// ═══════════════════════════════════════════════════════════════

const OID_SENSITIVITY = 10; // k factor for tanh

export const openInterestDeltaCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.POSITIONING.OI_DELTA,
    name: 'Open Interest Delta',
    category: 'POSITIONING',
    description: 'Inflow or outflow of positions',
    formula: 'OID = (OI_t - OI_t-1) / OI_t-1; normalized = tanh(OID * k)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Position exodus / capitulation',
      neutral: 'Stable positioning',
      high: 'New positions entering',
    },
    dependencies: [],
    parameters: { sensitivity: OID_SENSITIVITY },
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const data = extractDerivativesData(input);
    
    if (data.openInterestPrev === 0) {
      return {
        id: INDICATOR_IDS.POSITIONING.OI_DELTA,
        category: 'POSITIONING',
        value: 0,
        normalized: true,
        interpretation: 'No previous OI data',
        timestamp: Date.now(),
      };
    }
    
    const delta = (data.openInterest - data.openInterestPrev) / data.openInterestPrev;
    const normalized = Math.tanh(delta * OID_SENSITIVITY);
    
    let interpretation = 'Stable positioning';
    if (normalized > 0.3) interpretation = 'New positions entering';
    else if (normalized < -0.3) interpretation = 'Position exodus / capitulation';
    
    return {
      id: INDICATOR_IDS.POSITIONING.OI_DELTA,
      category: 'POSITIONING',
      value: clamp(normalized, -1, 1),
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 27. OI / VOLUME RATIO (OVR)
// ═══════════════════════════════════════════════════════════════

export const oiVolumeRatioCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.POSITIONING.OI_VOLUME_RATIO,
    name: 'OI / Volume Ratio',
    category: 'POSITIONING',
    description: 'New positions or just turnover?',
    formula: 'OVR = OI_delta / volume; normalized = clamp(OVR / p95, -1, +1)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Speculative churn (no new positions)',
      neutral: 'Mixed activity',
      high: 'Position accumulation',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const data = extractDerivativesData(input);
    
    if (data.volume === 0 || data.openInterestPrev === 0) {
      return {
        id: INDICATOR_IDS.POSITIONING.OI_VOLUME_RATIO,
        category: 'POSITIONING',
        value: 0,
        normalized: true,
        interpretation: 'Insufficient data',
        timestamp: Date.now(),
      };
    }
    
    const oiDelta = data.openInterest - data.openInterestPrev;
    const ovr = oiDelta / data.volume;
    
    // Calculate historical OVR for percentile normalization
    const ovrHistory: number[] = [];
    for (let i = 1; i < data.openInterestHistory.length; i++) {
      const delta = data.openInterestHistory[i] - data.openInterestHistory[i - 1];
      const candle = input.candles[i];
      if (candle && candle.volume > 0) {
        ovrHistory.push(delta / candle.volume);
      }
    }
    
    const p95 = Math.max(0.0001, percentile(ovrHistory.map(Math.abs), 95));
    const normalized = clamp(ovr / p95, -1, 1);
    
    let interpretation = 'Mixed activity';
    if (normalized > 0.3) interpretation = 'Position accumulation';
    else if (normalized < -0.3) interpretation = 'Speculative churn (no new positions)';
    
    return {
      id: INDICATOR_IDS.POSITIONING.OI_VOLUME_RATIO,
      category: 'POSITIONING',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 28. FUNDING RATE PRESSURE (FRP)
// ═══════════════════════════════════════════════════════════════

export const fundingRatePressureCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.POSITIONING.FUNDING_PRESSURE,
    name: 'Funding Rate Pressure',
    category: 'POSITIONING',
    description: 'Which side is being punished by funding',
    formula: 'FRP = currentFunding / avgFunding; normalized = clamp(FRP, -1, +1)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Shorts overcrowded (paying longs)',
      neutral: 'Balanced funding',
      high: 'Longs overcrowded (paying shorts)',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const data = extractDerivativesData(input);
    
    if (data.fundingRateAvg === 0) {
      return {
        id: INDICATOR_IDS.POSITIONING.FUNDING_PRESSURE,
        category: 'POSITIONING',
        value: 0,
        normalized: true,
        interpretation: 'No funding data',
        timestamp: Date.now(),
      };
    }
    
    // Positive funding = longs pay shorts (bullish overcrowding)
    // Negative funding = shorts pay longs (bearish overcrowding)
    const frp = data.fundingRate / data.fundingRateAvg;
    const normalized = clamp(frp, -1, 1);
    
    let interpretation = 'Balanced funding';
    if (normalized > 0.5) interpretation = 'Longs overcrowded (paying shorts)';
    else if (normalized < -0.5) interpretation = 'Shorts overcrowded (paying longs)';
    
    return {
      id: INDICATOR_IDS.POSITIONING.FUNDING_PRESSURE,
      category: 'POSITIONING',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 29. LONG / SHORT RATIO (LSR)
// ═══════════════════════════════════════════════════════════════

export const longShortRatioCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.POSITIONING.LONG_SHORT_RATIO,
    name: 'Long / Short Ratio',
    category: 'POSITIONING',
    description: 'Crowd skew between longs and shorts',
    formula: 'LSR = longPositions / shortPositions; normalized = clamp(log(LSR), -1, +1)',
    range: { min: -1, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Crowd is short',
      neutral: 'Balanced positioning',
      high: 'Crowd is long',
    },
    dependencies: [],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    const data = extractDerivativesData(input);
    
    const epsilon = 0.0001;
    const lsr = data.longPositions / Math.max(data.shortPositions, epsilon);
    
    // Log normalize: log(1) = 0, log(2) ≈ 0.69, log(0.5) ≈ -0.69
    const logLsr = Math.log(lsr);
    const normalized = clamp(logLsr, -1, 1);
    
    let interpretation = 'Balanced positioning';
    if (normalized > 0.3) interpretation = 'Crowd is long';
    else if (normalized < -0.3) interpretation = 'Crowd is short';
    
    return {
      id: INDICATOR_IDS.POSITIONING.LONG_SHORT_RATIO,
      category: 'POSITIONING',
      value: normalized,
      normalized: true,
      interpretation,
      timestamp: Date.now(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 30. POSITION CROWDING INDEX (PCI)
// ═══════════════════════════════════════════════════════════════

export const positionCrowdingIndexCalculator: IndicatorCalculator = {
  definition: {
    id: INDICATOR_IDS.POSITIONING.POSITION_CROWDING,
    name: 'Position Crowding Index',
    category: 'POSITIONING',
    description: 'How vulnerable is the market to squeeze/flush',
    formula: 'PCI = weighted_mean(|OIL|, |LSR|, |FRP|, |OID|); normalized = clamp(PCI, 0, 1)',
    range: { min: 0, max: 1 },
    normalized: true,
    interpretations: {
      low: 'Room for movement (uncrowded)',
      neutral: 'Moderate crowding',
      high: 'Market overcrowded (squeeze/flush risk)',
    },
    dependencies: [
      INDICATOR_IDS.POSITIONING.OI_LEVEL,
      INDICATOR_IDS.POSITIONING.OI_DELTA,
      INDICATOR_IDS.POSITIONING.FUNDING_PRESSURE,
      INDICATOR_IDS.POSITIONING.LONG_SHORT_RATIO,
    ],
    parameters: {},
  },
  
  calculate(input: IndicatorInput): IndicatorValue {
    // Calculate component indicators
    const oilValue = openInterestLevelCalculator.calculate(input);
    const oidValue = openInterestDeltaCalculator.calculate(input);
    const frpValue = fundingRatePressureCalculator.calculate(input);
    const lsrValue = longShortRatioCalculator.calculate(input);
    
    // Weighted mean of absolute values
    // Higher weights for more reliable signals
    const weights = {
      oil: 0.3,  // Position load
      lsr: 0.3,  // Crowd skew
      frp: 0.25, // Funding pressure
      oid: 0.15, // Delta (more noisy)
    };
    
    const pci = 
      weights.oil * Math.abs(oilValue.value) +
      weights.lsr * Math.abs(lsrValue.value) +
      weights.frp * Math.abs(frpValue.value) +
      weights.oid * Math.abs(oidValue.value);
    
    const normalized = clamp(pci, 0, 1);
    
    let interpretation = 'Moderate crowding';
    if (normalized > 0.7) interpretation = 'Market overcrowded (squeeze/flush risk)';
    else if (normalized < 0.3) interpretation = 'Room for movement (uncrowded)';
    
    return {
      id: INDICATOR_IDS.POSITIONING.POSITION_CROWDING,
      category: 'POSITIONING',
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

export const positioningCalculators: IndicatorCalculator[] = [
  openInterestLevelCalculator,
  openInterestDeltaCalculator,
  oiVolumeRatioCalculator,
  fundingRatePressureCalculator,
  longShortRatioCalculator,
  positionCrowdingIndexCalculator,
];

console.log(`[S10.6I.5] Positioning / Derivatives calculators loaded: ${positioningCalculators.length}`);
