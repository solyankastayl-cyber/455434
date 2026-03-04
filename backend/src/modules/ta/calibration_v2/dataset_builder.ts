/**
 * Phase I: Dataset Builder
 * 
 * Extracts calibration data from MongoDB audit trail
 */

import { Db } from 'mongodb';
import { CalibrationDataPoint, RegimeBucket } from './calibration_types.js';

/**
 * Build calibration dataset from ta_scenarios + ta_outcomes + ta_runs
 */
export async function buildCalibrationDataset(
  db: Db,
  params: {
    asset?: string;
    timeframe?: string;
    minDate?: Date;
    maxDate?: Date;
    limit?: number;
  } = {}
): Promise<CalibrationDataPoint[]> {
  const limit = params.limit ?? 10000;
  
  // Build query for outcomes (only resolved ones)
  const outcomeQuery: any = {
    status: { $in: ['WIN', 'LOSS'] },  // Exclude TIMEOUT and NO_ENTRY for calibration
  };
  if (params.asset) outcomeQuery.asset = params.asset;
  if (params.timeframe) outcomeQuery.timeframe = params.timeframe;
  if (params.minDate || params.maxDate) {
    outcomeQuery.createdAt = {};
    if (params.minDate) outcomeQuery.createdAt.$gte = params.minDate;
    if (params.maxDate) outcomeQuery.createdAt.$lte = params.maxDate;
  }
  
  // Fetch outcomes
  const outcomes = await db.collection('ta_outcomes')
    .find(outcomeQuery)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  
  const dataPoints: CalibrationDataPoint[] = [];
  
  for (const outcome of outcomes) {
    // Fetch corresponding scenario
    const scenario = await db.collection('ta_scenarios').findOne({
      runId: outcome.runId,
      scenarioId: outcome.scenarioId,
    });
    
    if (!scenario) continue;
    
    // Fetch run for regime info
    const run = await db.collection('ta_runs').findOne({ runId: outcome.runId });
    
    // Extract regime
    const marketRegime = run?.snapshot?.marketRegime || 'TRANSITION';
    const volRegime = run?.snapshot?.volRegime || 'NORMAL';
    const regime: RegimeBucket = `${marketRegime}_${volRegime}`;
    
    // Extract pattern types from components
    const patternTypes = (scenario.components || []).map((c: any) => c.type);
    
    dataPoints.push({
      runId: outcome.runId,
      scenarioId: outcome.scenarioId,
      rawScore: scenario.score || 0.5,
      outcome: outcome.status as 'WIN' | 'LOSS',
      regime,
      patternTypes,
      createdAt: new Date(outcome.createdAt),
    });
  }
  
  return dataPoints;
}

/**
 * Group data points by regime
 */
export function groupByRegime(
  data: CalibrationDataPoint[]
): Map<RegimeBucket, CalibrationDataPoint[]> {
  const groups = new Map<RegimeBucket, CalibrationDataPoint[]>();
  
  for (const point of data) {
    const existing = groups.get(point.regime) || [];
    existing.push(point);
    groups.set(point.regime, existing);
  }
  
  return groups;
}

/**
 * Get all unique regimes in dataset
 */
export function getUniqueRegimes(data: CalibrationDataPoint[]): RegimeBucket[] {
  return Array.from(new Set(data.map(d => d.regime)));
}

/**
 * Get statistics about the dataset
 */
export function getDatasetStats(data: CalibrationDataPoint[]): {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  regimeCounts: Record<string, number>;
  scoreRange: { min: number; max: number; avg: number };
} {
  const wins = data.filter(d => d.outcome === 'WIN').length;
  const losses = data.filter(d => d.outcome === 'LOSS').length;
  
  const regimeCounts: Record<string, number> = {};
  for (const d of data) {
    regimeCounts[d.regime] = (regimeCounts[d.regime] || 0) + 1;
  }
  
  const scores = data.map(d => d.rawScore);
  const scoreRange = scores.length > 0 ? {
    min: Math.min(...scores),
    max: Math.max(...scores),
    avg: scores.reduce((a, b) => a + b, 0) / scores.length,
  } : { min: 0, max: 0, avg: 0 };
  
  return {
    total: data.length,
    wins,
    losses,
    winRate: data.length > 0 ? wins / data.length : 0,
    regimeCounts,
    scoreRange,
  };
}
