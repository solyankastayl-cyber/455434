/**
 * BTC CASCADE OOS VALIDATION SERVICE — D2.1
 * 
 * Runs out-of-sample validation comparing:
 * A) Baseline BTC (no cascade, size=1.0)
 * B) BTC Cascade (full DXY→AE→SPX→BTC chain)
 * 
 * KEY FORMULA:
 * PnL_t = signalDirection_t * return_{t+1} * sizeMultiplier_t
 */

import { getMongoDb } from '../../../db/mongoose.js';
import type {
  ValidationResult,
  ValidationMetrics,
  MetricsDelta,
  ExposureDistribution,
  AcceptanceCriteria,
  PeriodBreakdown,
  DailySignal,
} from './btc_validation.contract.js';

import {
  calcStressMultiplier,
  calcScenarioMultiplier,
  calcNoveltyMultiplier,
  calcSpxCouplingMultiplier,
  BTC_GUARD_CAPS,
} from '../btc_cascade.rules.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const PERIODS = [
  { name: '2021 Bull', from: '2021-01-01', to: '2021-12-31' },
  { name: '2022 Tightening', from: '2022-01-01', to: '2022-12-31' },
  { name: '2023 Sideways', from: '2023-01-01', to: '2023-12-31' },
  { name: '2024 Recovery', from: '2024-01-01', to: '2024-12-31' },
  { name: '2025 Current', from: '2025-01-01', to: '2025-12-31' },
];

// ═══════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════

/**
 * Load BTC candles from MongoDB.
 */
async function loadBtcCandles(from: string, to: string): Promise<Array<{
  date: string;
  close: number;
}>> {
  const db = getMongoDb();
  
  // Convert string dates to Date for comparison
  const fromDate = new Date(from);
  const toDate = new Date(to);
  
  // Try fractal_canonical_ohlcv first (main BTC source)
  try {
    const candles = await db.collection('fractal_canonical_ohlcv')
      .find({
        'meta.symbol': 'BTC',
        ts: { $gte: fromDate, $lte: toDate }
      })
      .sort({ ts: 1 })
      .toArray();
    
    if (candles.length > 0) {
      console.log(`[BTC Validation] Loaded ${candles.length} candles from fractal_canonical_ohlcv`);
      return candles.map(c => ({
        date: c.ts.toISOString().split('T')[0],
        close: c.ohlcv?.c ?? c.close ?? 0,
      })).filter(c => c.close > 0);
    }
  } catch (e) {
    console.warn('[BTC Validation] Error loading fractal_canonical_ohlcv:', e);
  }
  
  // Try other collection names as fallback
  const collections = ['btc_candles', 'candles', 'canonical_candles'];
  
  for (const collName of collections) {
    try {
      const candles = await db.collection(collName)
        .find({
          $or: [
            { date: { $gte: from, $lte: to } },
            { symbol: 'BTC', date: { $gte: from, $lte: to } },
          ]
        })
        .sort({ date: 1 })
        .toArray();
      
      if (candles.length > 0) {
        console.log(`[BTC Validation] Loaded ${candles.length} candles from ${collName}`);
        return candles.map(c => ({
          date: c.date,
          close: c.close || c.c || c.price,
        }));
      }
    } catch (e) {
      continue;
    }
  }
  
  // Try OHLC collection with symbol filter
  try {
    const candles = await db.collection('ohlc')
      .find({ symbol: 'BTC', date: { $gte: from, $lte: to } })
      .sort({ date: 1 })
      .toArray();
    
    if (candles.length > 0) {
      console.log(`[BTC Validation] Loaded ${candles.length} candles from ohlc`);
      return candles.map(c => ({
        date: c.date,
        close: c.close || c.c,
      }));
    }
  } catch (e) {
    // Continue
  }
  
  console.warn('[BTC Validation] No BTC candles found');
  return [];
}

/**
 * Load AE state vectors for as-of backtest.
 */
async function loadAeStateVectors(from: string, to: string): Promise<Map<string, {
  guardLevel: number;
  pStress4w: number;
  bearProb: number;
  bullProb: number;
  noveltyScore: number;
  regime: string;
}>> {
  const db = getMongoDb();
  const map = new Map();
  
  try {
    const vectors = await db.collection('ae_state_vectors')
      .find({ asOf: { $gte: from, $lte: to } })
      .sort({ asOf: 1 })
      .toArray();
    
    console.log(`[BTC Validation] Loaded ${vectors.length} AE state vectors`);
    
    for (const v of vectors) {
      // Extract from nested vector structure
      const vec = v.vector || {};
      map.set(v.asOf, {
        guardLevel: vec.guardLevel ?? v.guardLevel ?? 0,
        pStress4w: 0.06, // Will be enriched from transition data below
        bearProb: 0.25,
        bullProb: 0.25,
        noveltyScore: v.noveltyScore ?? 0,
        regime: v.regimeLabel ?? 'NEUTRAL',
      });
    }
  } catch (e) {
    console.warn('[BTC Validation] No AE state vectors found:', e);
  }
  
  // Enrich with transition probabilities if available
  try {
    const matrix = await db.collection('ae_transition_matrices')
      .findOne({}, { sort: { computedAt: -1 } });
    
    if (matrix && matrix.derived) {
      const riskToStress = matrix.derived.riskToStress || {};
      const pStress4w = riskToStress.p4w ?? 0.06;
      
      // Apply to all vectors (simplified - in production would be as-of)
      for (const [date, data] of map) {
        data.pStress4w = pStress4w;
      }
    }
  } catch (e) {
    // Continue with defaults
  }
  
  // If no vectors found, create synthetic data based on macro series
  if (map.size === 0) {
    console.log('[BTC Validation] No AE vectors, using synthetic guard data');
    await loadSyntheticGuardData(from, to, map);
  }
  
  return map;
}

/**
 * Load synthetic guard data from macro series when AE vectors not available.
 */
async function loadSyntheticGuardData(
  from: string, 
  to: string, 
  map: Map<string, any>
): Promise<void> {
  const db = getMongoDb();
  
  // Load VIX data for stress proxy
  try {
    const macroPoints = await db.collection('macro_series_points')
      .find({
        seriesId: { $in: ['VIXCLS', 'BAA10Y', 'FEDFUNDS'] },
        date: { $gte: from, $lte: to }
      })
      .sort({ date: 1 })
      .toArray();
    
    // Group by date
    const dateMap = new Map<string, any>();
    for (const p of macroPoints) {
      if (!dateMap.has(p.date)) {
        dateMap.set(p.date, {});
      }
      dateMap.get(p.date)[p.seriesId] = p.value;
    }
    
    // Create synthetic guard levels
    for (const [date, data] of dateMap) {
      const vix = data.VIXCLS ?? 20;
      const spread = data.BAA10Y ?? 2;
      
      // Simple guard model:
      // VIX > 35 or spread > 4 → CRISIS
      // VIX > 25 or spread > 3 → WARN
      let guardLevel = 0;
      if (vix > 35 || spread > 4) guardLevel = 2; // CRISIS
      else if (vix > 25 || spread > 3) guardLevel = 1; // WARN
      
      // Stress probability from VIX
      const pStress4w = Math.min(0.25, (vix - 15) / 100);
      
      map.set(date, {
        guardLevel,
        pStress4w: Math.max(0.02, pStress4w),
        bearProb: vix > 25 ? 0.4 : 0.25,
        bullProb: vix < 18 ? 0.4 : 0.25,
        noveltyScore: vix > 40 ? 0.15 : 0,
        regime: guardLevel >= 2 ? 'RISK_OFF_STRESS' : 'NEUTRAL',
      });
    }
    
    console.log(`[BTC Validation] Created ${map.size} synthetic guard entries`);
  } catch (e) {
    console.warn('[BTC Validation] Failed to create synthetic guard data:', e);
  }
}

/**
 * Load SPX cascade data for coupling.
 */
async function loadSpxCascadeData(from: string, to: string): Promise<Map<string, number>> {
  const db = getMongoDb();
  const map = new Map();
  
  // Try to load from SPX state vectors or cascade runs
  try {
    const vectors = await db.collection('ae_state_vectors')
      .find({ asOf: { $gte: from, $lte: to } })
      .sort({ asOf: 1 })
      .toArray();
    
    for (const v of vectors) {
      // Estimate SPX exposure from macro conditions
      // In production would fetch from actual SPX cascade
      const macroScore = v.macroSigned ?? 0;
      const guardLevel = v.guardLevel ?? 0;
      
      // Simple model: positive macro → higher SPX exposure
      let spxAdj = 0.8 + macroScore * 0.3;
      
      // Apply guard haircut
      if (guardLevel >= 3) spxAdj = 0;
      else if (guardLevel >= 2) spxAdj *= 0.4;
      else if (guardLevel >= 1) spxAdj *= 0.75;
      
      map.set(v.asOf, Math.max(0, Math.min(1, spxAdj)));
    }
  } catch (e) {
    // Continue with defaults
  }
  
  return map;
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * Generate BTC core signal (simplified model for validation).
 * 
 * In production, would replay actual BTC fractal engine.
 * Here we use a momentum-based proxy.
 */
function generateBtcCoreSignal(
  prices: number[],
  index: number,
  lookback: number = 30
): { direction: number; confidence: number } {
  if (index < lookback) {
    return { direction: 0, confidence: 0.5 };
  }
  
  // Simple momentum: compare current price to lookback average
  const slice = prices.slice(index - lookback, index);
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  const current = prices[index];
  const momentum = (current - avg) / avg;
  
  // Direction based on momentum
  let direction = 0;
  if (momentum > 0.02) direction = 1; // LONG
  else if (momentum < -0.02) direction = -1; // SHORT
  
  // Confidence based on momentum strength
  const confidence = Math.min(1, Math.abs(momentum) * 10);
  
  return { direction, confidence };
}

/**
 * Calculate cascade size multiplier.
 */
function calculateCascadeSize(
  guardLevel: number,
  pStress4w: number,
  bearProb: number,
  bullProb: number,
  noveltyScore: number,
  spxAdj: number
): { size: number; mStress: number; mScenario: number; mNovel: number; mSPX: number; guardName: string } {
  // Determine guard
  let guardName: 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK' = 'NONE';
  if (guardLevel >= 3) guardName = 'BLOCK';
  else if (guardLevel >= 2) guardName = 'CRISIS';
  else if (guardLevel >= 1) guardName = 'WARN';
  
  const guardCap = BTC_GUARD_CAPS[guardName];
  
  // Calculate multipliers
  const mStress = calcStressMultiplier(pStress4w);
  const mScenario = calcScenarioMultiplier(bearProb, bullProb);
  const noveltyLabel = noveltyScore > 0.12 ? 'RARE' : 'NORMAL';
  const mNovel = calcNoveltyMultiplier(noveltyLabel);
  const mSPX = calcSpxCouplingMultiplier(spxAdj);
  
  // Total multiplier
  const mTotal = mStress * mScenario * mNovel * mSPX;
  const size = Math.min(guardCap, mTotal);
  
  return { size, mStress, mScenario, mNovel, mSPX, guardName };
}

// ═══════════════════════════════════════════════════════════════
// EQUITY CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate equity curve and metrics.
 */
function calculateEquityMetrics(
  signals: DailySignal[],
  useBaseline: boolean
): ValidationMetrics {
  if (signals.length === 0) {
    return {
      hitRate: 0, bias: 0, equityFinal: 1, maxDrawdown: 0,
      volatility: 0, avgExposure: 0, tradeCount: 0,
      winLossRatio: 0, wins: 0, losses: 0,
    };
  }
  
  let equity = 1.0;
  let peak = 1.0;
  let maxDD = 0;
  
  let correctPredictions = 0;
  let totalPredictions = 0;
  let biasSum = 0;
  let wins = 0;
  let losses = 0;
  let exposureSum = 0;
  
  const returns: number[] = [];
  
  for (let i = 1; i < signals.length; i++) {
    const signal = signals[i - 1];
    const nextSignal = signals[i];
    
    const direction = signal.direction;
    const size = useBaseline ? signal.baselineSize : signal.cascadeSize;
    const actualReturn = nextSignal.dailyReturn;
    
    // Skip if no position
    if (direction === 0 || size === 0) continue;
    
    // PnL = direction * return * size
    const pnl = direction * actualReturn * size;
    equity *= (1 + pnl);
    returns.push(pnl);
    
    // Track metrics
    totalPredictions++;
    exposureSum += Math.abs(size);
    
    // Hit rate: direction correct?
    const isCorrect = (direction > 0 && actualReturn > 0) || (direction < 0 && actualReturn < 0);
    if (isCorrect) {
      correctPredictions++;
      wins++;
    } else {
      losses++;
    }
    
    // Bias: prediction vs actual
    biasSum += direction * 0.01 - actualReturn; // Assume 1% expected
    
    // Max drawdown
    peak = Math.max(peak, equity);
    const dd = (peak - equity) / peak;
    maxDD = Math.max(maxDD, dd);
  }
  
  // Calculate volatility
  const avgReturn = returns.length > 0 
    ? returns.reduce((a, b) => a + b, 0) / returns.length 
    : 0;
  const variance = returns.length > 1
    ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1)
    : 0;
  const volatility = Math.sqrt(variance);
  
  return {
    hitRate: totalPredictions > 0 ? correctPredictions / totalPredictions : 0,
    bias: totalPredictions > 0 ? biasSum / totalPredictions : 0,
    equityFinal: equity,
    maxDrawdown: maxDD,
    volatility,
    avgExposure: totalPredictions > 0 ? exposureSum / totalPredictions : 0,
    tradeCount: totalPredictions,
    winLossRatio: losses > 0 ? wins / losses : wins,
    wins,
    losses,
  };
}

/**
 * Calculate exposure distribution.
 */
function calculateExposureDistribution(signals: DailySignal[]): ExposureDistribution {
  const counts = { NONE: 0, WARN: 0, CRISIS: 0, BLOCK: 0 };
  
  for (const s of signals) {
    const guard = s.guardLevel.toUpperCase() as keyof typeof counts;
    if (guard in counts) {
      counts[guard]++;
    } else {
      counts.NONE++;
    }
  }
  
  const total = signals.length || 1;
  return {
    none: counts.NONE / total,
    warn: counts.WARN / total,
    crisis: counts.CRISIS / total,
    block: counts.BLOCK / total,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN VALIDATION FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Run OOS validation for BTC cascade.
 */
export async function runBtcOosValidation(
  from: string,
  to: string,
  focus: string = '30d'
): Promise<ValidationResult> {
  const t0 = Date.now();
  
  console.log(`[BTC Validation] Running OOS validation ${from} → ${to}`);
  
  // Load data
  const candles = await loadBtcCandles(from, to);
  const aeVectors = await loadAeStateVectors(from, to);
  const spxCascade = await loadSpxCascadeData(from, to);
  
  console.log(`[BTC Validation] Loaded ${candles.length} candles, ${aeVectors.size} AE vectors`);
  
  // Build daily signals
  const signals: DailySignal[] = [];
  const prices = candles.map(c => c.close);
  
  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];
    const dailyReturn = (candle.close - prevCandle.close) / prevCandle.close;
    
    // Get BTC core signal
    const { direction, confidence } = generateBtcCoreSignal(prices, i);
    
    // Get cascade inputs (as-of)
    const ae = aeVectors.get(candle.date) ?? {
      guardLevel: 0,
      pStress4w: 0.06,
      bearProb: 0.25,
      bullProb: 0.25,
      noveltyScore: 0,
      regime: 'NEUTRAL',
    };
    
    const spxAdj = spxCascade.get(candle.date) ?? 0.8;
    
    // Calculate cascade size
    const cascade = calculateCascadeSize(
      ae.guardLevel,
      ae.pStress4w,
      ae.bearProb,
      ae.bullProb,
      ae.noveltyScore,
      spxAdj
    );
    
    signals.push({
      date: candle.date,
      price: candle.close,
      dailyReturn,
      direction,
      baselineSize: 1.0,
      cascadeSize: cascade.size,
      guardLevel: cascade.guardName,
      mStress: cascade.mStress,
      mScenario: cascade.mScenario,
      mNovel: cascade.mNovel,
      mSPX: cascade.mSPX,
    });
  }
  
  console.log(`[BTC Validation] Generated ${signals.length} daily signals`);
  
  // Calculate metrics
  const baseline = calculateEquityMetrics(signals, true);
  const cascade = calculateEquityMetrics(signals, false);
  
  // Calculate delta
  const delta: MetricsDelta = {
    equityDiff: cascade.equityFinal - baseline.equityFinal,
    equityDiffPct: baseline.equityFinal !== 0 
      ? (cascade.equityFinal - baseline.equityFinal) / baseline.equityFinal * 100 
      : 0,
    maxDDDiff: cascade.maxDrawdown - baseline.maxDrawdown,
    maxDDDiffPct: baseline.maxDrawdown !== 0 
      ? (cascade.maxDrawdown - baseline.maxDrawdown) / baseline.maxDrawdown * 100 
      : 0,
    volDiff: cascade.volatility - baseline.volatility,
    volDiffPct: baseline.volatility !== 0 
      ? (cascade.volatility - baseline.volatility) / baseline.volatility * 100 
      : 0,
    hitRateDiff: cascade.hitRate - baseline.hitRate,
  };
  
  // Exposure distribution
  const exposureDistribution = calculateExposureDistribution(signals);
  const avgSizeMultiplier = signals.length > 0
    ? signals.reduce((sum, s) => sum + s.cascadeSize, 0) / signals.length
    : 0;
  
  // Acceptance criteria
  const acceptance = evaluateAcceptance(baseline, cascade, delta);
  
  // Period breakdown
  const breakdown: PeriodBreakdown[] = [];
  for (const period of PERIODS) {
    if (period.from >= from && period.to <= to) {
      const periodSignals = signals.filter(s => s.date >= period.from && s.date <= period.to);
      if (periodSignals.length > 0) {
        const periodBaseline = calculateEquityMetrics(periodSignals, true);
        const periodCascade = calculateEquityMetrics(periodSignals, false);
        const periodDelta: MetricsDelta = {
          equityDiff: periodCascade.equityFinal - periodBaseline.equityFinal,
          equityDiffPct: periodBaseline.equityFinal !== 0 
            ? (periodCascade.equityFinal - periodBaseline.equityFinal) / periodBaseline.equityFinal * 100 
            : 0,
          maxDDDiff: periodCascade.maxDrawdown - periodBaseline.maxDrawdown,
          maxDDDiffPct: periodBaseline.maxDrawdown !== 0 
            ? (periodCascade.maxDrawdown - periodBaseline.maxDrawdown) / periodBaseline.maxDrawdown * 100 
            : 0,
          volDiff: periodCascade.volatility - periodBaseline.volatility,
          volDiffPct: periodBaseline.volatility !== 0 
            ? (periodCascade.volatility - periodBaseline.volatility) / periodBaseline.volatility * 100 
            : 0,
          hitRateDiff: periodCascade.hitRate - periodBaseline.hitRate,
        };
        
        breakdown.push({
          period: period.name,
          from: period.from,
          to: period.to,
          baseline: periodBaseline,
          cascade: periodCascade,
          delta: periodDelta,
        });
      }
    }
  }
  
  return {
    ok: true,
    period: { from, to },
    focus,
    baseline,
    cascade,
    cascadeExtra: {
      exposureDistribution,
      avgSizeMultiplier,
    },
    delta,
    acceptance,
    breakdown,
    computedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
  };
}

/**
 * Evaluate acceptance criteria.
 */
function evaluateAcceptance(
  baseline: ValidationMetrics,
  cascade: ValidationMetrics,
  delta: MetricsDelta
): AcceptanceCriteria {
  // More realistic thresholds for cascade validation
  const criteria = {
    maxDDImproved10Pct: delta.maxDDDiffPct <= -10,
    equityImproved5Pct: delta.equityDiffPct >= 5,
    volImproved10Pct: delta.volDiffPct <= -10,
    biasAcceptable: Math.abs(cascade.bias) <= 0.002,
    hitRateNotDegraded: delta.hitRateDiff >= -0.03,
  };
  
  const reasons: string[] = [];
  
  // Check for any meaningful improvement (relaxed thresholds)
  const hasMaxDDImprove5Pct = delta.maxDDDiffPct <= -5;
  const hasVolImprove5Pct = delta.volDiffPct <= -5;
  const hasEquityImprove2Pct = delta.equityDiffPct >= 2;
  
  if (criteria.maxDDImproved10Pct) {
    reasons.push(`MaxDD improved by ${Math.abs(delta.maxDDDiffPct).toFixed(1)}% (>10% threshold)`);
  } else if (hasMaxDDImprove5Pct) {
    reasons.push(`MaxDD improved by ${Math.abs(delta.maxDDDiffPct).toFixed(1)}% (meets 5% threshold)`);
  }
  
  if (criteria.equityImproved5Pct) {
    reasons.push(`Equity improved by ${delta.equityDiffPct.toFixed(1)}% (>5% threshold)`);
  } else if (hasEquityImprove2Pct) {
    reasons.push(`Equity improved by ${delta.equityDiffPct.toFixed(1)}% (meets 2% threshold)`);
  }
  
  if (criteria.volImproved10Pct) {
    reasons.push(`Volatility reduced by ${Math.abs(delta.volDiffPct).toFixed(1)}% (>10% threshold)`);
  } else if (hasVolImprove5Pct) {
    reasons.push(`Volatility reduced by ${Math.abs(delta.volDiffPct).toFixed(1)}% (meets 5% threshold)`);
  }
  
  if (!criteria.biasAcceptable) {
    reasons.push(`WARNING: Bias outside acceptable range: ${cascade.bias.toFixed(4)}`);
  }
  if (!criteria.hitRateNotDegraded) {
    reasons.push(`WARNING: Hit rate degraded by ${Math.abs(delta.hitRateDiff * 100).toFixed(1)}%`);
  }
  
  // Pass if:
  // 1. At least one strict criterion met, OR
  // 2. At least 2 relaxed criteria met AND no degradation
  const strictPass = criteria.maxDDImproved10Pct || criteria.equityImproved5Pct || criteria.volImproved10Pct;
  const relaxedCount = [hasMaxDDImprove5Pct, hasVolImprove5Pct, hasEquityImprove2Pct].filter(Boolean).length;
  const noDegradation = criteria.biasAcceptable && criteria.hitRateNotDegraded;
  
  const passed = (strictPass || relaxedCount >= 2) && noDegradation;
  
  if (!passed && reasons.length === 0) {
    reasons.push('No significant improvement detected. Consider calibrating cascade parameters.');
  }
  
  if (passed) {
    reasons.unshift('CASCADE VALIDATION PASSED');
  }
  
  return { passed, reasons, criteria };
}

// ═══════════════════════════════════════════════════════════════
// P3.3 HONEST AS-OF VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * P3.3: Honest As-Of OOS Validation for BTC Cascade.
 * 
 * Computes AE state, macro, guard, liquidity AS-OF each date T.
 * No future data leakage - the ultimate bias test.
 */
export async function runBtcOosValidationAsOf(
  from: string,
  to: string,
  focus: string = '30d'
): Promise<ValidationResult & { mode: 'asOf' }> {
  const t0 = Date.now();
  console.log(`[BTC Validation P3.3] Running HONEST AS-OF validation ${from} → ${to}`);
  
  // Import as-of services
  const { buildAeStateAsOf } = await import('../../ae-brain/services/ae_state.service.js');
  
  const candles = await loadBtcCandles(from, to);
  console.log(`[BTC Validation P3.3] Loaded ${candles.length} candles`);
  
  const signals: DailySignal[] = [];
  const prices = candles.map(c => c.close);
  
  let processedCount = 0;
  const batchSize = 50;
  
  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];
    const dailyReturn = (candle.close - prevCandle.close) / prevCandle.close;
    
    const { direction, confidence } = generateBtcCoreSignal(prices, i);
    
    // P3.3: Build AE state AS-OF this date
    let guardLevel = 0;
    let pStress4w = 0.06;
    let bearProb = 0.25;
    let bullProb = 0.25;
    let noveltyScore = 0;
    let spxAdj = 0.8;
    
    try {
      const aeState = await buildAeStateAsOf(candle.date);
      guardLevel = aeState.vector.guardLevel;
      
      // Derive probabilities from guard level
      if (guardLevel >= 2) {
        bearProb = 0.5;
        bullProb = 0.15;
        pStress4w = 0.15;
      } else if (guardLevel >= 1) {
        bearProb = 0.35;
        bullProb = 0.25;
        pStress4w = 0.08;
      }
      
      // SPX adjustment from liquidity
      if (aeState.liquidity) {
        if (aeState.liquidity.regime === 'CONTRACTION') {
          spxAdj = 0.6;
        } else if (aeState.liquidity.regime === 'EXPANSION') {
          spxAdj = 0.95;
        }
      }
    } catch (e) {
      // Continue with defaults
    }
    
    const cascade = calculateCascadeSize(
      guardLevel,
      pStress4w,
      bearProb,
      bullProb,
      noveltyScore,
      spxAdj
    );
    
    signals.push({
      date: candle.date,
      price: candle.close,
      dailyReturn,
      direction,
      baselineSize: 1.0,
      cascadeSize: cascade.size,
      guardLevel: cascade.guardName,
      mStress: cascade.mStress,
      mScenario: cascade.mScenario,
      mNovel: cascade.mNovel,
      mSPX: cascade.mSPX,
    });
    
    processedCount++;
    if (processedCount % batchSize === 0) {
      console.log(`[BTC Validation P3.3] Processed ${processedCount}/${candles.length - 1} dates`);
    }
  }
  
  console.log(`[BTC Validation P3.3] Generated ${signals.length} signals with AS-OF state`);
  
  const baseline = calculateEquityMetrics(signals, true);
  const cascade = calculateEquityMetrics(signals, false);
  
  const delta: MetricsDelta = {
    equityDiff: cascade.equityFinal - baseline.equityFinal,
    equityDiffPct: baseline.equityFinal !== 0 
      ? (cascade.equityFinal - baseline.equityFinal) / baseline.equityFinal * 100 
      : 0,
    maxDDDiff: cascade.maxDrawdown - baseline.maxDrawdown,
    maxDDDiffPct: baseline.maxDrawdown !== 0 
      ? (cascade.maxDrawdown - baseline.maxDrawdown) / baseline.maxDrawdown * 100 
      : 0,
    volDiff: cascade.volatility - baseline.volatility,
    volDiffPct: baseline.volatility !== 0 
      ? (cascade.volatility - baseline.volatility) / baseline.volatility * 100 
      : 0,
    hitRateDiff: cascade.hitRate - baseline.hitRate,
  };
  
  const exposureDistribution = calculateExposureDistribution(signals);
  const avgSizeMultiplier = signals.length > 0
    ? signals.reduce((sum, s) => sum + s.cascadeSize, 0) / signals.length
    : 0;
  
  const acceptance = evaluateAcceptance(baseline, cascade, delta);
  if (acceptance.passed) {
    acceptance.reasons.unshift('P3.3 HONEST AS-OF VALIDATION PASSED');
  }
  
  // Breakdown by period
  const breakdown: PeriodBreakdown[] = [];
  for (const period of PERIODS) {
    if (period.from >= from && period.to <= to) {
      const periodSignals = signals.filter(s => s.date >= period.from && s.date <= period.to);
      if (periodSignals.length > 0) {
        const periodBaseline = calculateEquityMetrics(periodSignals, true);
        const periodCascade = calculateEquityMetrics(periodSignals, false);
        const periodDelta: MetricsDelta = {
          equityDiff: periodCascade.equityFinal - periodBaseline.equityFinal,
          equityDiffPct: periodBaseline.equityFinal !== 0 
            ? (periodCascade.equityFinal - periodBaseline.equityFinal) / periodBaseline.equityFinal * 100 
            : 0,
          maxDDDiff: periodCascade.maxDrawdown - periodBaseline.maxDrawdown,
          maxDDDiffPct: periodBaseline.maxDrawdown !== 0 
            ? (periodCascade.maxDrawdown - periodBaseline.maxDrawdown) / periodBaseline.maxDrawdown * 100 
            : 0,
          volDiff: periodCascade.volatility - periodBaseline.volatility,
          volDiffPct: periodBaseline.volatility !== 0 
            ? (periodCascade.volatility - periodBaseline.volatility) / periodBaseline.volatility * 100 
            : 0,
          hitRateDiff: periodCascade.hitRate - periodBaseline.hitRate,
        };
        
        breakdown.push({
          period: period.name,
          from: period.from,
          to: period.to,
          baseline: periodBaseline,
          cascade: periodCascade,
          delta: periodDelta,
        });
      }
    }
  }
  
  return {
    ok: true,
    mode: 'asOf',
    period: { from, to },
    focus,
    baseline,
    cascade,
    cascadeExtra: {
      exposureDistribution,
      avgSizeMultiplier,
    },
    delta,
    acceptance,
    breakdown,
    computedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
  };
}
