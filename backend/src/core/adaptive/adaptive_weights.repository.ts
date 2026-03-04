/**
 * Adaptive Weights Repository
 */
import {
  AdaptiveWeightModel,
  IAdaptiveWeight,
  WeightScope,
  WeightTarget,
  BASE_SCORE_WEIGHTS,
  BASE_DECISION_WEIGHTS,
  getWeightBounds,
  clampWeight,
  checkCumulativeDriftCap,
} from './adaptive_weights.model.js';
import { env, ADAPTIVE_VERSION } from '../../config/env.js';

/**
 * Initialize or get weight
 */
export async function getOrCreateWeight(
  scope: WeightScope,
  scopeId: string,
  target: WeightTarget,
  key: string,
  baseWeight: number
): Promise<IAdaptiveWeight> {
  const existing = await AdaptiveWeightModel.findOne({
    scope,
    scopeId: scopeId.toLowerCase(),
    target,
    key,
  });
  
  if (existing) return existing;
  
  const bounds = getWeightBounds(baseWeight);
  
  const weight = new AdaptiveWeightModel({
    scope,
    scopeId: scopeId.toLowerCase(),
    target,
    key,
    baseWeight,
    currentWeight: baseWeight,
    minWeight: bounds.min,
    maxWeight: bounds.max,
  });
  
  return weight.save();
}

/**
 * Get all weights for scope
 */
export async function getWeightsForScope(
  scope: WeightScope,
  scopeId: string
): Promise<IAdaptiveWeight[]> {
  return AdaptiveWeightModel
    .find({ scope, scopeId: scopeId.toLowerCase() })
    .lean() as unknown as Promise<IAdaptiveWeight[]>;
}

/**
 * Get weight by key
 */
export async function getWeight(
  scope: WeightScope,
  scopeId: string,
  target: WeightTarget,
  key: string
): Promise<IAdaptiveWeight | null> {
  return AdaptiveWeightModel.findOne({
    scope,
    scopeId: scopeId.toLowerCase(),
    target,
    key,
  }).lean() as unknown as Promise<IAdaptiveWeight | null>;
}

/**
 * Adjust weight based on feedback
 * Returns true if weight was at boundary
 */
export async function adjustWeight(
  scope: WeightScope,
  scopeId: string,
  target: WeightTarget,
  key: string,
  feedbackScore: number,  // -1 to +1
  reason: string
): Promise<{ weight: IAdaptiveWeight | null; hitBoundary: boolean; frozen: boolean }> {
  const weight = await AdaptiveWeightModel.findOne({
    scope,
    scopeId: scopeId.toLowerCase(),
    target,
    key,
  });
  
  if (!weight) {
    return { weight: null, hitBoundary: false, frozen: false };
  }
  
  // Check if frozen
  if (weight.frozen) {
    console.log(`[Adaptive Weights] Weight ${key} is frozen, skipping adjustment`);
    return { weight, hitBoundary: false, frozen: true };
  }
  
  const learningRate = env.ADAPTIVE_LEARNING_RATE;
  const delta = learningRate * feedbackScore;
  const oldWeight = weight.currentWeight;
  const newWeight = clampWeight(
    oldWeight + delta,
    weight.minWeight,
    weight.maxWeight
  );
  
  const hitBoundary = newWeight === weight.minWeight || newWeight === weight.maxWeight;
  
  // Check cumulative drift cap
  const driftCheck = checkCumulativeDriftCap(newWeight, weight.baseWeight);
  
  if (driftCheck.shouldFreeze) {
    console.log(`[Adaptive Weights] FREEZING weight ${key}: ${driftCheck.reason}`);
    weight.frozen = true;
    weight.frozenAt = new Date();
    weight.frozenReason = driftCheck.reason;
    await weight.save();
    return { weight, hitBoundary, frozen: true };
  }
  
  // Update counters
  if (feedbackScore > 0) {
    weight.totalPositive += feedbackScore;
  } else {
    weight.totalNegative += Math.abs(feedbackScore);
  }
  
  weight.currentWeight = newWeight;
  weight.evidenceCount += 1;
  weight.driftFromBase = newWeight - weight.baseWeight;
  weight.cumulativeDrift = driftCheck.cumulativeDrift;
  weight.driftDirection = newWeight > weight.baseWeight ? 'up' 
    : newWeight < weight.baseWeight ? 'down' 
    : 'stable';
  weight.lastAdjustment = delta;
  weight.lastAdjustmentAt = new Date();
  
  if (hitBoundary) {
    weight.hitBoundaryCount += 1;
  }
  
  // Add to history (keep last 50)
  weight.adjustmentHistory.push({
    timestamp: new Date(),
    oldWeight,
    newWeight,
    reason,
    feedbackScore,
    adaptiveVersion: ADAPTIVE_VERSION,
  });
  
  if (weight.adjustmentHistory.length > 50) {
    weight.adjustmentHistory = weight.adjustmentHistory.slice(-50);
  }
  
  await weight.save();
  
  return { weight, hitBoundary, frozen: false };
}

/**
 * Get all global weights
 */
export async function getGlobalWeights(): Promise<IAdaptiveWeight[]> {
  return AdaptiveWeightModel
    .find({ scope: 'global' })
    .lean() as unknown as Promise<IAdaptiveWeight[]>;
}

/**
 * Get weights with high drift
 */
export async function getHighDriftWeights(
  driftThreshold: number = 0.1
): Promise<IAdaptiveWeight[]> {
  return AdaptiveWeightModel
    .find({
      $or: [
        { driftFromBase: { $gte: driftThreshold } },
        { driftFromBase: { $lte: -driftThreshold } },
      ],
    })
    .sort({ driftFromBase: -1 })
    .lean() as unknown as Promise<IAdaptiveWeight[]>;
}

/**
 * Get weights at boundary
 */
export async function getBoundaryWeights(): Promise<IAdaptiveWeight[]> {
  return AdaptiveWeightModel
    .find({ hitBoundaryCount: { $gt: 5 } })
    .sort({ hitBoundaryCount: -1 })
    .lean() as unknown as Promise<IAdaptiveWeight[]>;
}

/**
 * Initialize global score weights
 */
export async function initializeGlobalScoreWeights(): Promise<void> {
  for (const [key, baseWeight] of Object.entries(BASE_SCORE_WEIGHTS)) {
    await getOrCreateWeight('global', 'global', 'score', key, baseWeight);
  }
}

/**
 * Initialize global decision weights
 */
export async function initializeGlobalDecisionWeights(): Promise<void> {
  for (const [key, baseWeight] of Object.entries(BASE_DECISION_WEIGHTS)) {
    await getOrCreateWeight('global', 'global', 'decision', key, baseWeight);
  }
}

/**
 * Get stats
 */
export async function getWeightsStats(): Promise<{
  total: number;
  byScope: Record<string, number>;
  byTarget: Record<string, number>;
  avgDrift: number;
  boundaryHits: number;
  totalEvidence: number;
}> {
  const [total, byScopeAgg, byTargetAgg, driftAgg, evidenceAgg] = await Promise.all([
    AdaptiveWeightModel.countDocuments(),
    AdaptiveWeightModel.aggregate([
      { $group: { _id: '$scope', count: { $sum: 1 } } },
    ]),
    AdaptiveWeightModel.aggregate([
      { $group: { _id: '$target', count: { $sum: 1 } } },
    ]),
    AdaptiveWeightModel.aggregate([
      { $group: { _id: null, avgDrift: { $avg: { $abs: '$driftFromBase' } } } },
    ]),
    AdaptiveWeightModel.aggregate([
      {
        $group: {
          _id: null,
          totalEvidence: { $sum: '$evidenceCount' },
          boundaryHits: { $sum: '$hitBoundaryCount' },
        },
      },
    ]),
  ]);
  
  const byScope: Record<string, number> = {};
  for (const item of byScopeAgg) byScope[item._id] = item.count;
  
  const byTarget: Record<string, number> = {};
  for (const item of byTargetAgg) byTarget[item._id] = item.count;
  
  return {
    total,
    byScope,
    byTarget,
    avgDrift: driftAgg[0]?.avgDrift || 0,
    boundaryHits: evidenceAgg[0]?.boundaryHits || 0,
    totalEvidence: evidenceAgg[0]?.totalEvidence || 0,
  };
}

// Re-export constants for service usage
export { BASE_SCORE_WEIGHTS, BASE_DECISION_WEIGHTS } from './adaptive_weights.model.js';
