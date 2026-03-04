/**
 * Trend Validation Service
 * 
 * ETAP 3.2: Pure deterministic trend classification.
 * 
 * Rules-based classification:
 * - TREND_UP: return >= Rmin, drawdown <= Dmax, volume confirmed
 * - TREND_DOWN: return <= -Rmin, drawdown significant
 * - SIDEWAYS: return in [-Rnoise, +Rnoise], low volatility
 * - NOISE: everything else (high volatility, no confirmation)
 * 
 * Delay detection:
 * - INSTANT: trend visible in 1d
 * - DELAYED: no 1d trend, visible in 7d
 * - LATE: only visible in 30d
 * - NONE: no trend confirmed
 * 
 * NO ML - NO probabilities - NO side effects on Ranking/Engine.
 */
import { TrendValidationModel, type ITrendValidation } from '../models/trend_validation.model.js';
import { OutcomeObservationModel } from '../models/OutcomeObservation.model.js';
import { PredictionSnapshotModel } from '../models/PredictionSnapshot.model.js';
import {
  TREND_THRESHOLDS,
  type TrendLabel,
  type DelayLabel,
  type TrendHorizonResult,
  type TrendFinal,
  type TrendValidationInput,
} from '../types/trend.types.js';

// ==================== TYPES ====================

export interface ValidationResult {
  snapshotId: string;
  status: 'created' | 'updated' | 'skipped' | 'error';
  reason?: string;
}

export interface ValidationBatchResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  details: ValidationResult[];
}

type Horizon = '1d' | '7d' | '30d';
const HORIZONS: Horizon[] = ['1d', '7d', '30d'];

// ==================== CORE CLASSIFICATION LOGIC ====================

/**
 * Classify a single horizon's trend
 * Pure function - deterministic output for same input
 */
export function classifyHorizonTrend(
  horizon: Horizon,
  returnPct: number,
  maxDrawdownPct: number,
  volumeChangePct: number
): TrendHorizonResult {
  const thresholds = TREND_THRESHOLDS[horizon];
  const notes: string[] = [];
  
  // Count significance criteria met
  let significanceCriteriaMet = 0;
  
  // Criterion 1: Return significance
  const returnSignificant = Math.abs(returnPct) >= thresholds.Rmin;
  if (returnSignificant) {
    significanceCriteriaMet++;
    notes.push(`return ${returnPct.toFixed(2)}% exceeds Rmin=${thresholds.Rmin}%`);
  }
  
  // Criterion 2: Volume confirmation
  const volumeConfirmed = returnPct > 0 
    ? volumeChangePct >= thresholds.Vmin 
    : volumeChangePct <= -thresholds.Vmin;
  if (volumeConfirmed) {
    significanceCriteriaMet++;
    notes.push(`volume ${volumeChangePct.toFixed(2)}% confirms direction (Vmin=${thresholds.Vmin}%)`);
  }
  
  // Criterion 3: Drawdown check
  const drawdownOk = returnPct > 0 
    ? maxDrawdownPct <= thresholds.Dmax 
    : maxDrawdownPct >= thresholds.Dmax; // For downtrend, high drawdown is expected
  if (drawdownOk) {
    significanceCriteriaMet++;
    notes.push(`drawdown ${maxDrawdownPct.toFixed(2)}% within limits (Dmax=${thresholds.Dmax}%)`);
  }
  
  // Significance requires at least 2 of 3 criteria
  const isSignificant = significanceCriteriaMet >= 2;
  
  // Determine label
  let label: TrendLabel;
  let strength: number;
  
  if (returnPct >= thresholds.Rmin && isSignificant) {
    // TREND_UP
    label = 'TREND_UP';
    strength = Math.min(1, returnPct / (thresholds.Rmin * 3)); // Normalize to 0-1
    notes.push(`classified as TREND_UP (${significanceCriteriaMet}/3 criteria met)`);
    
  } else if (returnPct <= -thresholds.Rmin && isSignificant) {
    // TREND_DOWN
    label = 'TREND_DOWN';
    strength = Math.min(1, Math.abs(returnPct) / (thresholds.Rmin * 3));
    notes.push(`classified as TREND_DOWN (${significanceCriteriaMet}/3 criteria met)`);
    
  } else if (Math.abs(returnPct) <= thresholds.Rnoise && maxDrawdownPct <= thresholds.Dmax) {
    // SIDEWAYS - low return, low volatility
    label = 'SIDEWAYS';
    strength = 1 - (Math.abs(returnPct) / thresholds.Rnoise); // Higher strength for flatter
    notes.push(`classified as SIDEWAYS (return in ±${thresholds.Rnoise}% range)`);
    
  } else {
    // NOISE - inconsistent signals
    label = 'NOISE';
    strength = 0.5;
    notes.push(`classified as NOISE (inconsistent signals, ${significanceCriteriaMet}/3 criteria met)`);
  }
  
  return {
    returnPct,
    maxDrawdownPct,
    volumeChangePct,
    label,
    strength: Math.round(strength * 100) / 100,
    isSignificant,
    notes,
  };
}

/**
 * Determine delay type based on horizon results
 * Pure function - deterministic
 */
export function classifyDelay(
  h1d: TrendHorizonResult | undefined,
  h7d: TrendHorizonResult | undefined,
  h30d: TrendHorizonResult | undefined
): DelayLabel {
  const h1dTrend = h1d?.label === 'TREND_UP' || h1d?.label === 'TREND_DOWN';
  const h7dTrend = h7d?.label === 'TREND_UP' || h7d?.label === 'TREND_DOWN';
  const h30dTrend = h30d?.label === 'TREND_UP' || h30d?.label === 'TREND_DOWN';
  
  if (h1dTrend) {
    return 'INSTANT';
  } else if (!h1dTrend && h7dTrend) {
    return 'DELAYED';
  } else if (!h1dTrend && !h7dTrend && h30dTrend) {
    return 'LATE';
  } else {
    return 'NONE';
  }
}

/**
 * Compute final aggregated result from horizon results
 * Pure function - deterministic
 */
export function computeFinal(
  h1d: TrendHorizonResult | undefined,
  h7d: TrendHorizonResult | undefined,
  h30d: TrendHorizonResult | undefined
): TrendFinal {
  const delay = classifyDelay(h1d, h7d, h30d);
  
  // Determine dominant label (prioritize longer horizons for trend, shorter for noise)
  let label: TrendLabel = 'NOISE';
  let confidence = 0;
  let quality = 0;
  
  // Count available horizons for quality
  const availableHorizons = [h1d, h7d, h30d].filter(Boolean).length;
  quality = availableHorizons / 3;
  
  // Weight horizons: 30d > 7d > 1d for trend determination
  const horizonWeights = { '30d': 0.5, '7d': 0.35, '1d': 0.15 };
  const horizonResults: Record<string, TrendHorizonResult | undefined> = { '1d': h1d, '7d': h7d, '30d': h30d };
  
  // Count trends
  let upVotes = 0;
  let downVotes = 0;
  let sidewaysVotes = 0;
  let noiseVotes = 0;
  let totalWeight = 0;
  let strengthSum = 0;
  
  for (const [h, result] of Object.entries(horizonResults)) {
    if (!result) continue;
    
    const weight = horizonWeights[h as keyof typeof horizonWeights];
    totalWeight += weight;
    strengthSum += result.strength * weight;
    
    switch (result.label) {
      case 'TREND_UP':
        upVotes += weight;
        break;
      case 'TREND_DOWN':
        downVotes += weight;
        break;
      case 'SIDEWAYS':
        sidewaysVotes += weight;
        break;
      case 'NOISE':
        noiseVotes += weight;
        break;
    }
  }
  
  // Determine final label by weighted votes
  const maxVotes = Math.max(upVotes, downVotes, sidewaysVotes, noiseVotes);
  
  if (maxVotes === upVotes && upVotes > 0) {
    label = 'TREND_UP';
  } else if (maxVotes === downVotes && downVotes > 0) {
    label = 'TREND_DOWN';
  } else if (maxVotes === sidewaysVotes && sidewaysVotes > 0) {
    label = 'SIDEWAYS';
  } else {
    label = 'NOISE';
  }
  
  // Confidence based on agreement and strength
  if (totalWeight > 0) {
    const agreement = maxVotes / totalWeight; // How much horizons agree
    const avgStrength = strengthSum / totalWeight;
    confidence = Math.round(agreement * avgStrength * 100);
  }
  
  return {
    label,
    delay,
    confidence,
    quality: Math.round(quality * 100) / 100,
  };
}

// ==================== VALIDATION FUNCTIONS ====================

/**
 * Validate a single snapshot
 */
export async function validateSnapshot(snapshotId: string): Promise<ValidationResult> {
  try {
    // Get outcome observation
    const outcome = await OutcomeObservationModel.findOne({ snapshotId }).lean();
    
    if (!outcome) {
      return { snapshotId, status: 'skipped', reason: 'No outcome observation' };
    }
    
    // Get snapshot for token address
    const snapshot = await PredictionSnapshotModel.findOne({ snapshotId }).lean();
    if (!snapshot) {
      return { snapshotId, status: 'skipped', reason: 'Snapshot not found' };
    }
    
    // Check if we have at least one horizon
    const hasHorizons = outcome.horizons?.['1d'] || outcome.horizons?.['7d'] || outcome.horizons?.['30d'];
    if (!hasHorizons) {
      return { snapshotId, status: 'skipped', reason: 'No horizon data' };
    }
    
    // Classify each horizon
    const horizonResults: ITrendValidation['horizons'] = {};
    
    if (outcome.horizons?.['1d']) {
      horizonResults['1d'] = classifyHorizonTrend(
        '1d',
        outcome.horizons['1d'].returnPct,
        outcome.horizons['1d'].maxDrawdownPct,
        outcome.horizons['1d'].volumeChangePct
      );
    }
    
    if (outcome.horizons?.['7d']) {
      horizonResults['7d'] = classifyHorizonTrend(
        '7d',
        outcome.horizons['7d'].returnPct,
        outcome.horizons['7d'].maxDrawdownPct,
        outcome.horizons['7d'].volumeChangePct
      );
    }
    
    if (outcome.horizons?.['30d']) {
      horizonResults['30d'] = classifyHorizonTrend(
        '30d',
        outcome.horizons['30d'].returnPct,
        outcome.horizons['30d'].maxDrawdownPct,
        outcome.horizons['30d'].volumeChangePct
      );
    }
    
    // Compute final
    const final = computeFinal(
      horizonResults['1d'],
      horizonResults['7d'],
      horizonResults['30d']
    );
    
    // Upsert validation record
    const existing = await TrendValidationModel.findOne({ snapshotId });
    
    await TrendValidationModel.findOneAndUpdate(
      { snapshotId },
      {
        $set: {
          tokenAddress: snapshot.token.address.toLowerCase(),
          horizons: horizonResults,
          final,
          validatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    
    return {
      snapshotId,
      status: existing ? 'updated' : 'created',
    };
    
  } catch (error: any) {
    return { snapshotId, status: 'error', reason: error.message };
  }
}

/**
 * Validate batch of snapshots with outcomes but missing validations
 */
export async function validateBatch(
  limit: number = 100,
  onlyMissing: boolean = true
): Promise<ValidationBatchResult> {
  const result: ValidationBatchResult = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };
  
  try {
    // Find snapshots with outcomes
    const outcomes = await OutcomeObservationModel.find({
      $or: [
        { 'horizons.1d': { $exists: true } },
        { 'horizons.7d': { $exists: true } },
        { 'horizons.30d': { $exists: true } },
      ],
    })
      .select('snapshotId')
      .limit(limit * 2)
      .lean();
    
    if (outcomes.length === 0) {
      return result;
    }
    
    const snapshotIds = outcomes.map(o => o.snapshotId);
    
    // If onlyMissing, filter out already validated
    let toProcess = snapshotIds;
    if (onlyMissing) {
      const existing = await TrendValidationModel.find({
        snapshotId: { $in: snapshotIds },
      }).select('snapshotId').lean();
      
      const existingSet = new Set(existing.map(e => e.snapshotId));
      toProcess = snapshotIds.filter(id => !existingSet.has(id));
    }
    
    // Process limited batch
    const batch = toProcess.slice(0, limit);
    
    for (const snapshotId of batch) {
      const detail = await validateSnapshot(snapshotId);
      result.details.push(detail);
      result.processed++;
      
      switch (detail.status) {
        case 'created':
          result.created++;
          break;
        case 'updated':
          result.updated++;
          break;
        case 'skipped':
          result.skipped++;
          break;
        case 'error':
          result.errors++;
          break;
      }
    }
    
    return result;
    
  } catch (error: any) {
    console.error('[TrendValidation] Batch validation failed:', error);
    throw error;
  }
}

// ==================== QUERY FUNCTIONS ====================

/**
 * Get validation by snapshot ID
 */
export async function getValidationBySnapshotId(
  snapshotId: string
): Promise<ITrendValidation | null> {
  return TrendValidationModel.findOne({ snapshotId }).lean();
}

/**
 * Get validations by token
 */
export async function getValidationsByToken(
  tokenAddress: string,
  limit: number = 50
): Promise<ITrendValidation[]> {
  return TrendValidationModel.find({
    tokenAddress: tokenAddress.toLowerCase(),
  })
    .sort({ validatedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get validation statistics
 */
export async function getValidationStats(): Promise<{
  total: number;
  byLabel: Record<TrendLabel, number>;
  byDelay: Record<DelayLabel, number>;
  avgConfidence: number;
  avgQuality: number;
}> {
  const [
    total,
    labelCounts,
    delayCounts,
    avgStats,
  ] = await Promise.all([
    TrendValidationModel.countDocuments(),
    TrendValidationModel.aggregate([
      { $group: { _id: '$final.label', count: { $sum: 1 } } },
    ]),
    TrendValidationModel.aggregate([
      { $group: { _id: '$final.delay', count: { $sum: 1 } } },
    ]),
    TrendValidationModel.aggregate([
      {
        $group: {
          _id: null,
          avgConfidence: { $avg: '$final.confidence' },
          avgQuality: { $avg: '$final.quality' },
        },
      },
    ]),
  ]);
  
  const byLabel: Record<TrendLabel, number> = {
    NOISE: 0,
    SIDEWAYS: 0,
    TREND_UP: 0,
    TREND_DOWN: 0,
  };
  labelCounts.forEach(l => {
    if (l._id in byLabel) {
      byLabel[l._id as TrendLabel] = l.count;
    }
  });
  
  const byDelay: Record<DelayLabel, number> = {
    INSTANT: 0,
    DELAYED: 0,
    LATE: 0,
    NONE: 0,
  };
  delayCounts.forEach(d => {
    if (d._id in byDelay) {
      byDelay[d._id as DelayLabel] = d.count;
    }
  });
  
  const stats = avgStats[0] || {};
  
  return {
    total,
    byLabel,
    byDelay,
    avgConfidence: Math.round((stats.avgConfidence || 0) * 100) / 100,
    avgQuality: Math.round((stats.avgQuality || 0) * 100) / 100,
  };
}

/**
 * Get snapshots pending validation
 */
export async function getPendingValidation(limit: number = 100): Promise<string[]> {
  // Find outcomes
  const outcomes = await OutcomeObservationModel.find({
    $or: [
      { 'horizons.1d': { $exists: true } },
      { 'horizons.7d': { $exists: true } },
      { 'horizons.30d': { $exists: true } },
    ],
  })
    .select('snapshotId')
    .lean();
  
  const snapshotIds = outcomes.map(o => o.snapshotId);
  
  // Find already validated
  const validated = await TrendValidationModel.find({
    snapshotId: { $in: snapshotIds },
  }).select('snapshotId').lean();
  
  const validatedSet = new Set(validated.map(v => v.snapshotId));
  
  return snapshotIds
    .filter(id => !validatedSet.has(id))
    .slice(0, limit);
}
