/**
 * FORECAST REPOSITORY — Database operations for forecasts
 * ========================================================
 * 
 * Handles:
 * - Fetching forecasts for chart display
 * - Getting pending forecasts for evaluation
 * - Calculating metrics
 */

import { getDb } from '../../../db/mongodb.js';
import {
  ForecastEvent,
  ForecastHorizon,
  ForecastPoint,
  ForecastMetrics,
} from './forecast.types.js';

const COLLECTION = 'exchange_forecasts';

// ═══════════════════════════════════════════════════════════════
// FETCH OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * List forecasts for a given asset and time range
 */
export async function listForecasts(
  asset: string,
  fromTs: number,
  toTs: number,
  horizon: ForecastHorizon = '1D'
): Promise<ForecastEvent[]> {
  const db = getDb();
  const assetNorm = asset.toUpperCase().replace('USDT', '');
  
  return db.collection(COLLECTION)
    .find({
      asset: assetNorm,
      horizon,
      createdAt: { $gte: fromTs, $lte: toTs },
    })
    .sort({ createdAt: 1 })
    .limit(500)
    .toArray() as unknown as Promise<ForecastEvent[]>;
}

/**
 * Get the latest pending (non-evaluated) forecast
 */
export async function getLatestPendingForecast(
  asset: string,
  horizon: ForecastHorizon = '1D'
): Promise<ForecastEvent | null> {
  const db = getDb();
  const assetNorm = asset.toUpperCase().replace('USDT', '');
  
  return db.collection(COLLECTION)
    .findOne({
      asset: assetNorm,
      horizon,
      evaluated: false,
    }, {
      sort: { createdAt: -1 },
    }) as Promise<ForecastEvent | null>;
}

/**
 * Get forecasts that need evaluation (past due)
 */
export async function getPendingEvaluations(
  limit: number = 100
): Promise<ForecastEvent[]> {
  const db = getDb();
  const now = Date.now();
  
  return db.collection(COLLECTION)
    .find({
      evaluated: false,
      evaluateAfter: { $lte: now },
    })
    .sort({ evaluateAfter: 1 })
    .limit(limit)
    .toArray() as unknown as Promise<ForecastEvent[]>;
}

/**
 * Get evaluated forecasts (for outcome markers on chart)
 */
export async function getEvaluatedForecasts(
  asset: string,
  fromTs: number,
  toTs: number,
  horizon: ForecastHorizon = '1D'
): Promise<ForecastEvent[]> {
  const db = getDb();
  const assetNorm = asset.toUpperCase().replace('USDT', '');
  
  return db.collection(COLLECTION)
    .find({
      asset: assetNorm,
      horizon,
      evaluated: true,
      createdAt: { $gte: fromTs, $lte: toTs },
    })
    .sort({ createdAt: 1 })
    .limit(300)
    .toArray() as unknown as Promise<ForecastEvent[]>;
}

// ═══════════════════════════════════════════════════════════════
// UPDATE OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Mark forecast as evaluated with outcome
 */
export async function updateForecastOutcome(
  forecastId: string,
  outcome: ForecastEvent['outcome']
): Promise<void> {
  const db = getDb();
  
  await db.collection(COLLECTION).updateOne(
    { id: forecastId },
    {
      $set: {
        evaluated: true,
        outcome,
      },
    }
  );
}

// ═══════════════════════════════════════════════════════════════
// METRICS CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate metrics for forecasts (Block 20: Model Health)
 * 
 * Calibration Score: Measures how well model's confidence matches real accuracy
 * - Perfect calibration = 100 (70% confidence → 70% accuracy)
 * - Overconfident = low score (high confidence, low accuracy)
 * - Underconfident = low score (low confidence, high accuracy)
 */
export async function calculateMetrics(
  asset: string,
  horizon: ForecastHorizon = '1D',
  lookbackDays: number = 30
): Promise<ForecastMetrics> {
  const db = getDb();
  const assetNorm = asset.toUpperCase().replace('USDT', '');
  const fromTs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  
  const forecasts = await db.collection(COLLECTION)
    .find({
      asset: assetNorm,
      horizon,
      evaluated: true,
      createdAt: { $gte: fromTs },
    })
    .toArray() as unknown as ForecastEvent[];
  
  const total = forecasts.length;
  
  if (total === 0) {
    return {
      horizon,
      sampleCount: 0,
      evaluatedCount: 0,
      directionMatchPct: 0,
      hitRatePct: 0,
      avgDeviationPct: 0,
      calibrationScore: 0,
      expectedCalibration: 0,
      modelScore: 0,
      breakdown: { tp: 0, fp: 0, fn: 0, weak: 0 },
    };
  }
  
  let directionMatches = 0;
  let hits = 0;
  let totalDeviation = 0;
  let totalConfidence = 0;
  const breakdown = { tp: 0, fp: 0, fn: 0, weak: 0 };
  
  // Confidence buckets for calibration: [0-50, 50-60, 60-70, 70-80, 80-90, 90-100]
  const confidenceBuckets: Record<string, { count: number; correct: number; confSum: number }> = {
    '0-50': { count: 0, correct: 0, confSum: 0 },
    '50-60': { count: 0, correct: 0, confSum: 0 },
    '60-70': { count: 0, correct: 0, confSum: 0 },
    '70-80': { count: 0, correct: 0, confSum: 0 },
    '80-90': { count: 0, correct: 0, confSum: 0 },
    '90-100': { count: 0, correct: 0, confSum: 0 },
  };
  
  for (const f of forecasts) {
    if (!f.outcome) continue;
    
    if (f.outcome.directionMatch) directionMatches++;
    if (f.outcome.hit) hits++;
    totalDeviation += Math.abs(f.outcome.deviationPct);
    totalConfidence += f.confidence;
    
    // Count by label
    const label = f.outcome.label.toLowerCase() as keyof typeof breakdown;
    if (label in breakdown) {
      breakdown[label]++;
    }
    
    // Bucket by confidence
    const confPct = f.confidence * 100;
    let bucket: string;
    if (confPct < 50) bucket = '0-50';
    else if (confPct < 60) bucket = '50-60';
    else if (confPct < 70) bucket = '60-70';
    else if (confPct < 80) bucket = '70-80';
    else if (confPct < 90) bucket = '80-90';
    else bucket = '90-100';
    
    confidenceBuckets[bucket].count++;
    confidenceBuckets[bucket].confSum += f.confidence;
    if (f.outcome.directionMatch) {
      confidenceBuckets[bucket].correct++;
    }
  }
  
  // Calculate calibration score (ECE - Expected Calibration Error, inverted to 0-100 scale)
  // Lower ECE = better calibration → higher score
  let calibrationError = 0;
  let calibrationWeightSum = 0;
  const bucketResults: ForecastMetrics['confidenceBuckets'] = [];
  
  for (const [range, data] of Object.entries(confidenceBuckets)) {
    if (data.count === 0) continue;
    
    const actualAccuracy = data.correct / data.count;
    const avgConfidence = data.confSum / data.count;
    
    // ECE component: |accuracy - confidence| weighted by bucket size
    const bucketError = Math.abs(actualAccuracy - avgConfidence);
    calibrationError += bucketError * data.count;
    calibrationWeightSum += data.count;
    
    // Parse range midpoint for expected accuracy
    const [low, high] = range.split('-').map(Number);
    const expectedAccuracy = (low + high) / 2 / 100;
    
    bucketResults.push({
      range: range + '%',
      count: data.count,
      accuracy: Math.round(actualAccuracy * 100),
      expectedAccuracy: Math.round(expectedAccuracy * 100),
    });
  }
  
  // Calibration score: 100 - (ECE * 100), clamped to 0-100
  const ece = calibrationWeightSum > 0 ? calibrationError / calibrationWeightSum : 0;
  const calibrationScore = Math.round(Math.max(0, Math.min(100, (1 - ece) * 100)));
  
  // Expected calibration based on average confidence
  const avgConfidence = totalConfidence / total;
  const expectedCalibration = Math.round(avgConfidence * 100);
  
  // Model Score: weighted combination of metrics
  // 40% direction accuracy + 30% hit rate + 30% calibration
  const directionMatchPct = Math.round((directionMatches / total) * 100);
  const hitRatePct = Math.round((hits / total) * 100);
  const modelScore = Math.round(
    directionMatchPct * 0.4 +
    hitRatePct * 0.3 +
    calibrationScore * 0.3
  );
  
  return {
    horizon,
    sampleCount: total,
    evaluatedCount: forecasts.filter(f => f.outcome).length,
    directionMatchPct,
    hitRatePct,
    avgDeviationPct: Math.round((totalDeviation / total) * 100) / 100,
    calibrationScore,
    expectedCalibration,
    modelScore,
    breakdown,
    confidenceBuckets: bucketResults.length > 0 ? bucketResults : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// CONVERSION HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Convert ForecastEvent to ForecastPoint (for API response)
 */
export function toForecastPoint(f: ForecastEvent): ForecastPoint {
  return {
    ts: f.createdAt,
    horizon: f.horizon,
    basePrice: f.basePrice,
    targetPrice: f.targetPrice,
    expectedMovePct: f.expectedMovePct,
    direction: f.direction,
    confidence: f.confidence,
    upperBand: f.upperBand,
    lowerBand: f.lowerBand,
    evaluated: f.evaluated,
    outcome: f.outcome ? {
      label: f.outcome.label,
      realPrice: f.outcome.realPrice,
      deviationPct: f.outcome.deviationPct,
      directionMatch: f.outcome.directionMatch,
    } : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// STATS FOR HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

export interface ForecastStats {
  total: number;
  pending: number;
  evaluated: number;
  byHorizon: Record<ForecastHorizon, number>;
  recentCount24h: number;
}

export async function getStats(): Promise<ForecastStats> {
  const db = getDb();
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  
  const [total, pending, evaluated, recent1D, recent7D, recent30D, recentCount] = await Promise.all([
    db.collection(COLLECTION).countDocuments(),
    db.collection(COLLECTION).countDocuments({ evaluated: false }),
    db.collection(COLLECTION).countDocuments({ evaluated: true }),
    db.collection(COLLECTION).countDocuments({ horizon: '1D' }),
    db.collection(COLLECTION).countDocuments({ horizon: '7D' }),
    db.collection(COLLECTION).countDocuments({ horizon: '30D' }),
    db.collection(COLLECTION).countDocuments({ createdAt: { $gte: oneDayAgo } }),
  ]);
  
  return {
    total,
    pending,
    evaluated,
    byHorizon: {
      '1D': recent1D,
      '7D': recent7D,
      '30D': recent30D,
    },
    recentCount24h: recentCount,
  };
}

console.log('[Forecast] Repository loaded');
