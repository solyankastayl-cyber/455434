/**
 * DXY MACRO VALIDATION SERVICE — D6.VAL1
 * 
 * Validates macro multiplier impact on fractal signal.
 * READ-ONLY: Does NOT write to DB.
 * 
 * Checks:
 * - Multiplier distribution and regime durations
 * - Sign flips and action changes caused by macro
 * - Per-layer contribution analysis
 */

import { DxyCandleModel } from '../../dxy/storage/dxy-candles.model.js';
import { FedFundsModel } from '../../dxy-macro/storage/fed-funds.model.js';
import { CpiPointModel } from '../../dxy-macro-cpi/storage/cpi.model.js';
import { UnratePointModel } from '../../dxy-macro-unrate/storage/unrate.model.js';
import { MACRO_CONFIG } from '../../dxy-macro/contracts/dxy-macro.contract.js';
import { CPI_CONFIG, CPI_SERIES } from '../../dxy-macro-cpi/contracts/cpi.contract.js';
import { UNRATE_CONFIG, UNRATE_SERIES } from '../../dxy-macro-unrate/unrate.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface DayResult {
  date: string;
  baseForecastReturn: number;
  baseSign: 'UP' | 'DOWN';
  baseAction: 'LONG' | 'HOLD' | 'SHORT';
  fedMult: number;
  cpiMult: number;
  unrateMult: number;
  macroMultTotal: number;
  macroForecastReturn: number;
  macroSign: 'UP' | 'DOWN';
  macroAction: 'LONG' | 'HOLD' | 'SHORT';
  actionChanged: boolean;
  signFlipped: boolean;
  absDeltaReturn: number;
}

interface ValidationResult {
  meta: {
    asset: string;
    focus: string;
    from: string;
    to: string;
    daysRequested: number;
    daysUsed: number;
    daysSkipped: number;
    skipReasons: {
      missingCandle: number;
      missingMacro: number;
      warmupInsufficient: number;
    };
    actionRule: {
      type: string;
      thresholdAbsReturn: number;
      labels: string[];
    };
  };
  multiplierTotal: any;
  impact: any;
  layers: any;
  sampleRows: DayResult[];
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const ACTION_THRESHOLD = 0.002; // 0.2% threshold for LONG/SHORT

// ═══════════════════════════════════════════════════════════════
// HELPER: Compute Fed Multiplier for a date
// ═══════════════════════════════════════════════════════════════

async function computeFedMultiplier(asOfDate: Date): Promise<number | null> {
  const points = await FedFundsModel
    .find({ date: { $lte: asOfDate } })
    .sort({ date: -1 })
    .limit(13)
    .lean();
  
  if (points.length < 13) return null;
  
  const current = points[0].value;
  const prev12m = points[12].value;
  const delta12m = current - prev12m;
  
  // Fed regime logic
  let multiplier = 1.0;
  if (delta12m > MACRO_CONFIG.TIGHTENING_THRESHOLD) {
    multiplier = MACRO_CONFIG.TIGHTENING_AMPLIFY;
  } else if (delta12m < MACRO_CONFIG.EASING_THRESHOLD) {
    multiplier = MACRO_CONFIG.EASING_DAMPEN;
  }
  
  return multiplier;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Compute CPI Multiplier for a date
// ═══════════════════════════════════════════════════════════════

async function computeCpiMultiplier(asOfDate: Date): Promise<number | null> {
  const points = await CpiPointModel
    .find({ seriesId: CPI_SERIES.CORE, date: { $lte: asOfDate } })
    .sort({ date: -1 })
    .limit(13)
    .lean();
  
  if (points.length < 13) return null;
  
  const current = points[0].value;
  const prev12m = points[12].value;
  const yoy = (current / prev12m) - 1;
  
  // Pressure calculation
  const pressureRaw = (yoy - CPI_CONFIG.TARGET_INFLATION) / CPI_CONFIG.PRESSURE_DIVISOR;
  const pressure = Math.max(-1, Math.min(1, pressureRaw));
  
  // Multiplier
  const score = CPI_CONFIG.CPI_SCORE_WEIGHT * pressure;
  const multiplier = Math.max(CPI_CONFIG.MIN_MULTIPLIER, Math.min(CPI_CONFIG.MAX_MULTIPLIER, 1 + score));
  
  return multiplier;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Compute UNRATE Multiplier for a date
// ═══════════════════════════════════════════════════════════════

async function computeUnrateMultiplier(asOfDate: Date): Promise<number | null> {
  const points = await UnratePointModel
    .find({ seriesId: UNRATE_SERIES, date: { $lte: asOfDate } })
    .sort({ date: -1 })
    .limit(13)
    .lean();
  
  if (points.length < 13) return null;
  
  const current = points[0].value;
  const prev12m = points[12].value;
  const delta12m = current - prev12m;
  
  // Pressure calculation
  const pressure = Math.max(-1, Math.min(1, delta12m / UNRATE_CONFIG.PRESSURE_SCALE));
  
  // Multiplier
  const rawMult = 1 + pressure * UNRATE_CONFIG.UNRATE_WEIGHT;
  const multiplier = Math.max(UNRATE_CONFIG.MIN_MULTIPLIER, Math.min(UNRATE_CONFIG.MAX_MULTIPLIER, rawMult));
  
  return multiplier;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Compute base forecast return (simplified proxy)
// ═══════════════════════════════════════════════════════════════

async function computeBaseForecastReturn(asOfDate: Date, windowLen: number = 120): Promise<number | null> {
  // Get DXY candles up to asOfDate
  const candles = await DxyCandleModel
    .find({ date: { $lte: asOfDate.toISOString().split('T')[0] } })
    .sort({ date: -1 })
    .limit(windowLen + 30)
    .lean();
  
  if (candles.length < windowLen + 30) return null;
  
  // Simple momentum proxy: 30-day return
  const recent = candles[0].close;
  const past30 = candles[30]?.close;
  
  if (!past30) return null;
  
  const return30d = (recent - past30) / past30;
  
  // Normalize to expected forecast range
  return Math.round(return30d * 10000) / 10000;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Determine action from return
// ═══════════════════════════════════════════════════════════════

function getAction(forecastReturn: number): 'LONG' | 'HOLD' | 'SHORT' {
  if (forecastReturn > ACTION_THRESHOLD) return 'LONG';
  if (forecastReturn < -ACTION_THRESHOLD) return 'SHORT';
  return 'HOLD';
}

function getSign(forecastReturn: number): 'UP' | 'DOWN' {
  return forecastReturn >= 0 ? 'UP' : 'DOWN';
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Statistics
// ═══════════════════════════════════════════════════════════════

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function median(arr: number[]): number {
  return percentile(arr, 0.5);
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Compute regime durations
// ═══════════════════════════════════════════════════════════════

function computeRegimeDurations(
  multipliers: number[],
  threshold: number,
  above: boolean
): { avg: number; median: number; p90: number } {
  const durations: number[] = [];
  let currentDuration = 0;
  
  for (const mult of multipliers) {
    const inRegime = above ? mult > threshold : mult < threshold;
    if (inRegime) {
      currentDuration++;
    } else if (currentDuration > 0) {
      durations.push(currentDuration);
      currentDuration = 0;
    }
  }
  if (currentDuration > 0) durations.push(currentDuration);
  
  if (durations.length === 0) {
    return { avg: 0, median: 0, p90: 0 };
  }
  
  return {
    avg: Math.round(mean(durations) * 10) / 10,
    median: Math.round(median(durations)),
    p90: Math.round(percentile(durations, 0.9)),
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Count threshold crossings
// ═══════════════════════════════════════════════════════════════

function countThresholdCrossings(multipliers: number[], threshold: number): number {
  let crossings = 0;
  for (let i = 1; i < multipliers.length; i++) {
    const prev = multipliers[i - 1];
    const curr = multipliers[i];
    
    // Cross from inside to outside or vice versa
    const prevOutside = prev > (1 + threshold) || prev < (1 - threshold);
    const currOutside = curr > (1 + threshold) || curr < (1 - threshold);
    
    if (prevOutside !== currOutside) crossings++;
  }
  return crossings;
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Run Validation
// ═══════════════════════════════════════════════════════════════

export async function runMacroValidation(
  from: string,
  to: string,
  focus: string = '30d'
): Promise<ValidationResult> {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  
  // Get all DXY candles in range
  const candles = await DxyCandleModel
    .find({
      date: { $gte: from, $lte: to }
    })
    .sort({ date: 1 })
    .lean();
  
  const daysRequested = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
  
  const results: DayResult[] = [];
  const skipReasons = {
    missingCandle: 0,
    missingMacro: 0,
    warmupInsufficient: 0,
  };
  
  // Process each day
  for (const candle of candles) {
    const candleDate = new Date(candle.date);
    
    // Get base forecast return
    const baseForecast = await computeBaseForecastReturn(candleDate);
    if (baseForecast === null) {
      skipReasons.warmupInsufficient++;
      continue;
    }
    
    // Get multipliers
    const fedMult = await computeFedMultiplier(candleDate);
    const cpiMult = await computeCpiMultiplier(candleDate);
    const unrateMult = await computeUnrateMultiplier(candleDate);
    
    if (fedMult === null || cpiMult === null || unrateMult === null) {
      skipReasons.missingMacro++;
      continue;
    }
    
    // Compute combined multiplier (clamped 0.70-1.30)
    const macroMultTotal = Math.max(0.70, Math.min(1.30, fedMult * cpiMult * unrateMult));
    
    // Compute macro-adjusted return
    const macroForecast = baseForecast * macroMultTotal;
    
    // Determine actions and signs
    const baseAction = getAction(baseForecast);
    const macroAction = getAction(macroForecast);
    const baseSign = getSign(baseForecast);
    const macroSign = getSign(macroForecast);
    
    results.push({
      date: candle.date,
      baseForecastReturn: Math.round(baseForecast * 10000) / 10000,
      baseSign,
      baseAction,
      fedMult: Math.round(fedMult * 10000) / 10000,
      cpiMult: Math.round(cpiMult * 10000) / 10000,
      unrateMult: Math.round(unrateMult * 10000) / 10000,
      macroMultTotal: Math.round(macroMultTotal * 10000) / 10000,
      macroForecastReturn: Math.round(macroForecast * 10000) / 10000,
      macroSign,
      macroAction,
      actionChanged: baseAction !== macroAction,
      signFlipped: baseSign !== macroSign,
      absDeltaReturn: Math.round(Math.abs(macroForecast - baseForecast) * 10000) / 10000,
    });
  }
  
  if (results.length === 0) {
    throw new Error('No valid days found in range');
  }
  
  // Extract arrays for stats
  const totalMults = results.map(r => r.macroMultTotal);
  const fedMults = results.map(r => r.fedMult);
  const cpiMults = results.map(r => r.cpiMult);
  const unrateMults = results.map(r => r.unrateMult);
  const deltaReturns = results.map(r => r.absDeltaReturn);
  
  const yearsInRange = results.length / 252; // Trading days per year
  
  // Compute stats for total multiplier
  const multiplierTotal = {
    mean: Math.round(mean(totalMults) * 10000) / 10000,
    median: Math.round(median(totalMults) * 10000) / 10000,
    std: Math.round(std(totalMults) * 10000) / 10000,
    min: Math.round(Math.min(...totalMults) * 10000) / 10000,
    max: Math.round(Math.max(...totalMults) * 10000) / 10000,
    p01: Math.round(percentile(totalMults, 0.01) * 10000) / 10000,
    p05: Math.round(percentile(totalMults, 0.05) * 10000) / 10000,
    p10: Math.round(percentile(totalMults, 0.10) * 10000) / 10000,
    p90: Math.round(percentile(totalMults, 0.90) * 10000) / 10000,
    p95: Math.round(percentile(totalMults, 0.95) * 10000) / 10000,
    p99: Math.round(percentile(totalMults, 0.99) * 10000) / 10000,
    
    pctOutside: {
      pct1: Math.round(totalMults.filter(m => m > 1.01 || m < 0.99).length / totalMults.length * 100) / 100,
      pct2: Math.round(totalMults.filter(m => m > 1.02 || m < 0.98).length / totalMults.length * 100) / 100,
      pct5: Math.round(totalMults.filter(m => m > 1.05 || m < 0.95).length / totalMults.length * 100) / 100,
    },
    
    regimeDurationsDays: {
      gt1p01: computeRegimeDurations(totalMults, 1.01, true),
      lt0p99: computeRegimeDurations(totalMults, 0.99, false),
      gt1p02: computeRegimeDurations(totalMults, 1.02, true),
      lt0p98: computeRegimeDurations(totalMults, 0.98, false),
    },
    
    thresholdCrossingsPerYear: {
      pct1: Math.round(countThresholdCrossings(totalMults, 0.01) / yearsInRange * 10) / 10,
      pct2: Math.round(countThresholdCrossings(totalMults, 0.02) / yearsInRange * 10) / 10,
      pct5: Math.round(countThresholdCrossings(totalMults, 0.05) / yearsInRange * 10) / 10,
    },
  };
  
  // Impact stats
  const signFlips = results.filter(r => r.signFlipped).length;
  const actionChanges = results.filter(r => r.actionChanged).length;
  const onlyScaling = results.filter(r => !r.actionChanged && !r.signFlipped).length;
  
  const impact = {
    pctSignFlips: Math.round(signFlips / results.length * 1000) / 1000,
    pctActionChanges: Math.round(actionChanges / results.length * 1000) / 1000,
    pctOnlyScaling: Math.round(onlyScaling / results.length * 1000) / 1000,
    
    scaleStats: {
      meanAbsDeltaReturn: Math.round(mean(deltaReturns) * 10000) / 10000,
      p90AbsDeltaReturn: Math.round(percentile(deltaReturns, 0.90) * 10000) / 10000,
      p99AbsDeltaReturn: Math.round(percentile(deltaReturns, 0.99) * 10000) / 10000,
    },
  };
  
  // Per-layer stats helper
  const computeLayerStats = (mults: number[]) => ({
    mean: Math.round(mean(mults) * 10000) / 10000,
    std: Math.round(std(mults) * 10000) / 10000,
    min: Math.round(Math.min(...mults) * 10000) / 10000,
    max: Math.round(Math.max(...mults) * 10000) / 10000,
    pctOutside: {
      pct1: Math.round(mults.filter(m => m > 1.01 || m < 0.99).length / mults.length * 100) / 100,
      pct2: Math.round(mults.filter(m => m > 1.02 || m < 0.98).length / mults.length * 100) / 100,
      pct5: Math.round(mults.filter(m => m > 1.05 || m < 0.95).length / mults.length * 100) / 100,
    },
    thresholdCrossingsPerYear: {
      pct1: Math.round(countThresholdCrossings(mults, 0.01) / yearsInRange * 10) / 10,
      pct2: Math.round(countThresholdCrossings(mults, 0.02) / yearsInRange * 10) / 10,
      pct5: Math.round(countThresholdCrossings(mults, 0.05) / yearsInRange * 10) / 10,
    },
  });
  
  const layers = {
    fed: computeLayerStats(fedMults),
    cpi: computeLayerStats(cpiMults),
    unrate: computeLayerStats(unrateMults),
  };
  
  // Select sample rows
  const sampleRows: DayResult[] = [];
  
  // 5 with largest absDeltaReturn
  const byDelta = [...results].sort((a, b) => b.absDeltaReturn - a.absDeltaReturn);
  sampleRows.push(...byDelta.slice(0, 5));
  
  // 5 with actionChanged=true
  const withActionChange = results.filter(r => r.actionChanged);
  sampleRows.push(...withActionChange.slice(0, 5));
  
  // 5 with signFlipped=true
  const withSignFlip = results.filter(r => r.signFlipped);
  sampleRows.push(...withSignFlip.slice(0, 5));
  
  // 5 random from middle (seeded by date)
  const midStart = Math.floor(results.length * 0.3);
  const midEnd = Math.floor(results.length * 0.7);
  const midResults = results.slice(midStart, midEnd);
  for (let i = 0; i < 5 && i < midResults.length; i++) {
    const idx = Math.floor(i * midResults.length / 5);
    sampleRows.push(midResults[idx]);
  }
  
  // Deduplicate by date
  const uniqueSamples = Array.from(new Map(sampleRows.map(r => [r.date, r])).values()).slice(0, 20);
  
  return {
    meta: {
      asset: 'DXY',
      focus,
      from,
      to,
      daysRequested,
      daysUsed: results.length,
      daysSkipped: skipReasons.missingCandle + skipReasons.missingMacro + skipReasons.warmupInsufficient,
      skipReasons,
      actionRule: {
        type: 'threshold',
        thresholdAbsReturn: ACTION_THRESHOLD,
        labels: ['LONG', 'HOLD', 'SHORT'],
      },
    },
    multiplierTotal,
    impact,
    layers,
    sampleRows: uniqueSamples,
  };
}
