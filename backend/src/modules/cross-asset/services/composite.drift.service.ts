/**
 * P5-B: Composite Drift Service
 * 
 * Calculates drift metrics for composite model.
 * 
 * Metrics:
 * - hitRate: percentage of correct direction predictions
 * - avgError: average signed error
 * - avgAbsError: average absolute error  
 * - p50/p90 absError: percentiles
 * - sampleCount: number of resolved outcomes
 */

import { getMongoDb } from '../../../db/mongoose.js';
import type { CompositeOutcomeDoc } from './composite.resolve.service.js';

async function getDb() {
  return getMongoDb();
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface DriftMetrics {
  hitRate: number;
  avgError: number;
  avgAbsError: number;
  p50AbsError: number;
  p90AbsError: number;
  sampleCount: number;
  hits: number;
  misses: number;
}

export interface DriftByVersion {
  versionId: string;
  metrics: DriftMetrics;
  parentVersions?: {
    BTC: string;
    SPX: string;
    DXY: string;
  };
  createdAt?: Date;
}

export interface DriftByHorizon {
  horizonDays: number;
  metrics: DriftMetrics;
}

export interface ComponentAttribution {
  asset: 'BTC' | 'SPX' | 'DXY';
  avgReturn: number;
  avgContribution: number;
  avgWeight: number;
  sampleCount: number;
}

export interface WeightsDiagnostics {
  avgWeights: { BTC: number; SPX: number; DXY: number };
  minWeights: { BTC: number; SPX: number; DXY: number };
  maxWeights: { BTC: number; SPX: number; DXY: number };
  clampedCount: { BTC: number; SPX: number; DXY: number };
  sampleCount: number;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function calculateMetrics(outcomes: CompositeOutcomeDoc[]): DriftMetrics {
  if (outcomes.length === 0) {
    return {
      hitRate: 0,
      avgError: 0,
      avgAbsError: 0,
      p50AbsError: 0,
      p90AbsError: 0,
      sampleCount: 0,
      hits: 0,
      misses: 0,
    };
  }
  
  const hits = outcomes.filter(o => o.directionHit).length;
  const misses = outcomes.length - hits;
  const hitRate = hits / outcomes.length;
  
  const errors = outcomes.map(o => o.errorPct);
  const absErrors = outcomes.map(o => o.absErrorPct).sort((a, b) => a - b);
  
  const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
  const avgAbsError = absErrors.reduce((a, b) => a + b, 0) / absErrors.length;
  
  return {
    hitRate: Math.round(hitRate * 10000) / 10000,
    avgError: Math.round(avgError * 100) / 100,
    avgAbsError: Math.round(avgAbsError * 100) / 100,
    p50AbsError: Math.round(percentile(absErrors, 50) * 100) / 100,
    p90AbsError: Math.round(percentile(absErrors, 90) * 100) / 100,
    sampleCount: outcomes.length,
    hits,
    misses,
  };
}

// ═══════════════════════════════════════════════════════════════
// DRIFT CALCULATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Get overall composite drift
 */
export async function getCompositeDrift(): Promise<DriftMetrics> {
  const db = await getDb();
  const outcomes = await db.collection('decision_outcomes')
    .find({ asset: 'CROSS_ASSET' })
    .toArray() as unknown as CompositeOutcomeDoc[];
  
  return calculateMetrics(outcomes);
}

/**
 * Get drift per version
 */
export async function getDriftByVersion(): Promise<DriftByVersion[]> {
  const db = await getDb();
  
  // Get all versions
  const versions = await db.collection('decision_outcomes').aggregate([
    { $match: { asset: 'CROSS_ASSET' } },
    { $group: { 
      _id: '$versionId',
      outcomes: { $push: '$$ROOT' },
      parentVersions: { $first: '$parentVersions' },
      createdAt: { $min: '$createdAt' }
    } },
    { $sort: { createdAt: -1 } }
  ]).toArray();
  
  return versions.map(v => ({
    versionId: v._id,
    metrics: calculateMetrics(v.outcomes as CompositeOutcomeDoc[]),
    parentVersions: v.parentVersions,
    createdAt: v.createdAt,
  }));
}

/**
 * Get drift per horizon
 */
export async function getDriftByHorizon(): Promise<DriftByHorizon[]> {
  const db = await getDb();
  
  const horizons = await db.collection('decision_outcomes').aggregate([
    { $match: { asset: 'CROSS_ASSET' } },
    { $group: { 
      _id: '$horizonDays',
      outcomes: { $push: '$$ROOT' }
    } },
    { $sort: { _id: 1 } }
  ]).toArray();
  
  return horizons.map(h => ({
    horizonDays: h._id,
    metrics: calculateMetrics(h.outcomes as CompositeOutcomeDoc[]),
  }));
}

/**
 * Get component attribution (how each parent contributes to outcomes)
 */
export async function getComponentAttribution(): Promise<ComponentAttribution[]> {
  const db = await getDb();
  const outcomes = await db.collection('decision_outcomes')
    .find({ asset: 'CROSS_ASSET' })
    .toArray() as unknown as CompositeOutcomeDoc[];
  
  if (outcomes.length === 0) {
    return [
      { asset: 'BTC', avgReturn: 0, avgContribution: 0, avgWeight: 0, sampleCount: 0 },
      { asset: 'SPX', avgReturn: 0, avgContribution: 0, avgWeight: 0, sampleCount: 0 },
      { asset: 'DXY', avgReturn: 0, avgContribution: 0, avgWeight: 0, sampleCount: 0 },
    ];
  }
  
  const result: ComponentAttribution[] = [];
  
  for (const asset of ['BTC', 'SPX', 'DXY'] as const) {
    const returns = outcomes.map(o => o.components?.[asset]?.returnPct || 0);
    const contributions = outcomes.map(o => o.components?.[asset]?.weightedContribution || 0);
    const weights = outcomes.map(o => o.weights?.[asset] || 0);
    
    result.push({
      asset,
      avgReturn: Math.round((returns.reduce((a, b) => a + b, 0) / returns.length) * 100) / 100,
      avgContribution: Math.round((contributions.reduce((a, b) => a + b, 0) / contributions.length) * 100) / 100,
      avgWeight: Math.round((weights.reduce((a, b) => a + b, 0) / weights.length) * 10000) / 10000,
      sampleCount: outcomes.length,
    });
  }
  
  return result;
}

/**
 * Get weights diagnostics
 */
export async function getWeightsDiagnostics(): Promise<WeightsDiagnostics> {
  const db = await getDb();
  const outcomes = await db.collection('decision_outcomes')
    .find({ asset: 'CROSS_ASSET' })
    .toArray() as unknown as CompositeOutcomeDoc[];
  
  if (outcomes.length === 0) {
    return {
      avgWeights: { BTC: 0, SPX: 0, DXY: 0 },
      minWeights: { BTC: 0, SPX: 0, DXY: 0 },
      maxWeights: { BTC: 0, SPX: 0, DXY: 0 },
      clampedCount: { BTC: 0, SPX: 0, DXY: 0 },
      sampleCount: 0,
    };
  }
  
  const MIN_BOUND = 0.05;
  const MAX_BOUND = 0.90;
  
  const btcWeights = outcomes.map(o => o.weights?.BTC || 0);
  const spxWeights = outcomes.map(o => o.weights?.SPX || 0);
  const dxyWeights = outcomes.map(o => o.weights?.DXY || 0);
  
  return {
    avgWeights: {
      BTC: Math.round((btcWeights.reduce((a, b) => a + b, 0) / btcWeights.length) * 10000) / 10000,
      SPX: Math.round((spxWeights.reduce((a, b) => a + b, 0) / spxWeights.length) * 10000) / 10000,
      DXY: Math.round((dxyWeights.reduce((a, b) => a + b, 0) / dxyWeights.length) * 10000) / 10000,
    },
    minWeights: {
      BTC: Math.min(...btcWeights),
      SPX: Math.min(...spxWeights),
      DXY: Math.min(...dxyWeights),
    },
    maxWeights: {
      BTC: Math.max(...btcWeights),
      SPX: Math.max(...spxWeights),
      DXY: Math.max(...dxyWeights),
    },
    clampedCount: {
      BTC: btcWeights.filter(w => w <= MIN_BOUND || w >= MAX_BOUND).length,
      SPX: spxWeights.filter(w => w <= MIN_BOUND || w >= MAX_BOUND).length,
      DXY: dxyWeights.filter(w => w <= MIN_BOUND || w >= MAX_BOUND).length,
    },
    sampleCount: outcomes.length,
  };
}

/**
 * Get worst performing snapshots (top errors)
 */
export async function getWorstSnapshots(limit: number = 10): Promise<CompositeOutcomeDoc[]> {
  const db = await getDb();
  return db.collection('decision_outcomes')
    .find({ asset: 'CROSS_ASSET' })
    .sort({ absErrorPct: -1 })
    .limit(limit)
    .toArray() as unknown as Promise<CompositeOutcomeDoc[]>;
}

/**
 * Get best performing snapshots (top hits with low error)
 */
export async function getBestSnapshots(limit: number = 10): Promise<CompositeOutcomeDoc[]> {
  const db = await getDb();
  return db.collection('decision_outcomes')
    .find({ asset: 'CROSS_ASSET', directionHit: true })
    .sort({ absErrorPct: 1 })
    .limit(limit)
    .toArray() as unknown as Promise<CompositeOutcomeDoc[]>;
}

export default {
  getCompositeDrift,
  getDriftByVersion,
  getDriftByHorizon,
  getComponentAttribution,
  getWeightsDiagnostics,
  getWorstSnapshots,
  getBestSnapshots,
};
