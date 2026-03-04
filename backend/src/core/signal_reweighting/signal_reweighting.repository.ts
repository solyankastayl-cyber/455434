/**
 * Signal Reweighting Repository
 * 
 * Database operations for signal weights using existing adaptive_weights model.
 * Extends adaptive system with scope='signal'.
 */
import { AdaptiveWeightModel, getWeightBounds, clampWeight, checkCumulativeDriftCap } from '../adaptive/adaptive_weights.model.js';
import { 
  SignalType, 
  SignalComponent, 
  SignalWeight,
  BASE_SIGNAL_TYPE_WEIGHTS,
  BASE_COMPONENT_WEIGHTS,
} from './signal_reweighting.types.js';
import { env } from '../../config/env.js';

/**
 * Initialize all signal weights
 * Called on startup or reset
 */
export async function initializeSignalWeights(): Promise<void> {
  console.log('[Signal Reweighting] Initializing signal weights...');
  
  const signalTypes: SignalType[] = [
    'DEX_FLOW',
    'WHALE_TRANSFER',
    'CONFLICT',
    'CORRIDOR_SPIKE',
    'BEHAVIOR_SHIFT',
  ];
  
  const components: SignalComponent[] = [
    'evidence',
    'direction',
    'risk',
    'confidence',
  ];
  
  // Initialize type-level weights
  for (const signalType of signalTypes) {
    const baseWeight = BASE_SIGNAL_TYPE_WEIGHTS[signalType];
    const bounds = getWeightBounds(baseWeight);
    
    await AdaptiveWeightModel.findOneAndUpdate(
      {
        scope: 'signal',
        scopeId: signalType.toLowerCase(),
        target: 'score',
        key: 'type_weight',
      },
      {
        $setOnInsert: {
          baseWeight,
          currentWeight: baseWeight,
          minWeight: bounds.min,
          maxWeight: bounds.max,
          evidenceCount: 0,
          totalPositive: 0,
          totalNegative: 0,
          driftFromBase: 0,
          cumulativeDrift: 1.0,
          driftDirection: 'stable',
          hitBoundaryCount: 0,
          frozen: false,
          lastAdjustment: 0,
          adjustmentHistory: [],
        },
      },
      { upsert: true }
    );
  }
  
  // Initialize component weights for each signal type
  for (const signalType of signalTypes) {
    for (const component of components) {
      const baseWeight = BASE_COMPONENT_WEIGHTS[component];
      const bounds = getWeightBounds(baseWeight);
      
      await AdaptiveWeightModel.findOneAndUpdate(
        {
          scope: 'signal',
          scopeId: signalType.toLowerCase(),
          target: 'component',
          key: component,
        },
        {
          $setOnInsert: {
            baseWeight,
            currentWeight: baseWeight,
            minWeight: bounds.min,
            maxWeight: bounds.max,
            evidenceCount: 0,
            totalPositive: 0,
            totalNegative: 0,
            driftFromBase: 0,
            cumulativeDrift: 1.0,
            driftDirection: 'stable',
            hitBoundaryCount: 0,
            frozen: false,
            lastAdjustment: 0,
            adjustmentHistory: [],
          },
        },
        { upsert: true }
      );
    }
  }
  
  console.log('[Signal Reweighting] Initialization complete');
}

/**
 * Get signal weight structure (two-level)
 */
export async function getSignalWeight(signalType: SignalType): Promise<SignalWeight | null> {
  const scopeId = signalType.toLowerCase();
  
  // Get type-level weight
  const typeWeightDoc = await AdaptiveWeightModel.findOne({
    scope: 'signal',
    scopeId,
    target: 'score',
    key: 'type_weight',
  }).lean();
  
  if (!typeWeightDoc) return null;
  
  // Get component weights
  const componentDocs = await AdaptiveWeightModel.find({
    scope: 'signal',
    scopeId,
    target: 'component',
  }).lean();
  
  const components: any = {};
  for (const doc of componentDocs) {
    components[doc.key] = {
      base: doc.baseWeight,
      current: doc.currentWeight,
      min: doc.minWeight,
      max: doc.maxWeight,
    };
  }
  
  return {
    signalType,
    typeWeight: {
      base: typeWeightDoc.baseWeight,
      current: typeWeightDoc.currentWeight,
      min: typeWeightDoc.minWeight,
      max: typeWeightDoc.maxWeight,
    },
    components,
  };
}

/**
 * Get all signal weights
 */
export async function getAllSignalWeights(): Promise<SignalWeight[]> {
  const signalTypes: SignalType[] = [
    'DEX_FLOW',
    'WHALE_TRANSFER',
    'CONFLICT',
    'CORRIDOR_SPIKE',
    'BEHAVIOR_SHIFT',
  ];
  
  const weights: SignalWeight[] = [];
  
  for (const signalType of signalTypes) {
    const weight = await getSignalWeight(signalType);
    if (weight) {
      weights.push(weight);
    }
  }
  
  return weights;
}

/**
 * Adjust signal weight based on feedback
 */
export async function adjustSignalWeight(
  signalType: SignalType,
  component: SignalComponent | 'type_weight',
  delta: number,
  reason: string,
  feedbackScore: number
): Promise<{
  weight: any | null;
  hitBoundary: boolean;
  frozen: boolean;
  reason?: string;
}> {
  const scopeId = signalType.toLowerCase();
  const target = component === 'type_weight' ? 'score' : 'component';
  const key = component === 'type_weight' ? 'type_weight' : component;
  
  const weightDoc = await AdaptiveWeightModel.findOne({
    scope: 'signal',
    scopeId,
    target,
    key,
  });
  
  if (!weightDoc) {
    return { weight: null, hitBoundary: false, frozen: false };
  }
  
  // Check if frozen
  if (weightDoc.frozen) {
    return {
      weight: null,
      hitBoundary: false,
      frozen: true,
      reason: weightDoc.frozenReason || 'Weight is frozen',
    };
  }
  
  // Calculate new weight
  const oldWeight = weightDoc.currentWeight;
  let newWeight = oldWeight + delta;
  
  // Clamp within bounds
  newWeight = clampWeight(newWeight, weightDoc.minWeight, weightDoc.maxWeight);
  
  const hitBoundary = (newWeight === weightDoc.minWeight || newWeight === weightDoc.maxWeight);
  
  // Check cumulative drift
  const driftCheck = checkCumulativeDriftCap(newWeight, weightDoc.baseWeight);
  
  if (driftCheck.shouldFreeze) {
    // Freeze this weight
    await AdaptiveWeightModel.updateOne(
      { _id: weightDoc._id },
      {
        $set: {
          frozen: true,
          frozenAt: new Date(),
          frozenReason: driftCheck.reason,
        },
      }
    );
    
    return {
      weight: null,
      hitBoundary: false,
      frozen: true,
      reason: driftCheck.reason,
    };
  }
  
  // Calculate drift metrics
  const driftFromBase = newWeight - weightDoc.baseWeight;
  const driftDirection = 
    Math.abs(driftFromBase) < 0.01 ? 'stable' :
    driftFromBase > 0 ? 'up' : 'down';
  
  // Update weight
  const updated = await AdaptiveWeightModel.findOneAndUpdate(
    { _id: weightDoc._id },
    {
      $set: {
        currentWeight: newWeight,
        driftFromBase,
        cumulativeDrift: driftCheck.cumulativeDrift,
        driftDirection,
        lastAdjustment: delta,
        lastAdjustmentAt: new Date(),
      },
      $inc: {
        evidenceCount: 1,
        totalPositive: feedbackScore > 0 ? feedbackScore : 0,
        totalNegative: feedbackScore < 0 ? Math.abs(feedbackScore) : 0,
        hitBoundaryCount: hitBoundary ? 1 : 0,
      },
      $push: {
        adjustmentHistory: {
          $each: [{
            timestamp: new Date(),
            oldWeight,
            newWeight,
            reason,
            feedbackScore,
            adaptiveVersion: env.ADAPTIVE_VERSION || '12A.1',
          }],
          $slice: -50, // Keep last 50 adjustments
        },
      },
    },
    { new: true }
  ).lean();
  
  return {
    weight: updated,
    hitBoundary,
    frozen: false,
  };
}

/**
 * Get signal weights statistics
 */
export async function getSignalWeightsStats() {
  const allWeights = await AdaptiveWeightModel.find({
    scope: 'signal',
  }).lean();
  
  const stats = {
    total: allWeights.length,
    frozen: allWeights.filter(w => w.frozen).length,
    drifted: allWeights.filter(w => Math.abs(w.driftFromBase) > 0.05).length,
    atBoundary: allWeights.filter(w => w.hitBoundaryCount > 5).length,
    bySignalType: {} as Record<string, any>,
  };
  
  // Group by signal type
  const signalTypes = [...new Set(allWeights.map(w => w.scopeId))];
  
  for (const signalType of signalTypes) {
    const weights = allWeights.filter(w => w.scopeId === signalType);
    
    stats.bySignalType[signalType] = {
      total: weights.length,
      frozen: weights.filter(w => w.frozen).length,
      avgDrift: weights.reduce((sum, w) => sum + w.driftFromBase, 0) / weights.length,
      avgEvidence: weights.reduce((sum, w) => sum + w.evidenceCount, 0) / weights.length,
    };
  }
  
  return stats;
}

/**
 * Reset signal weight to base
 */
export async function resetSignalWeight(
  signalType: SignalType,
  component: SignalComponent | 'type_weight'
): Promise<boolean> {
  const scopeId = signalType.toLowerCase();
  const target = component === 'type_weight' ? 'score' : 'component';
  const key = component === 'type_weight' ? 'type_weight' : component;
  
  const result = await AdaptiveWeightModel.updateOne(
    {
      scope: 'signal',
      scopeId,
      target,
      key,
    },
    {
      $set: {
        currentWeight: '$baseWeight',
        driftFromBase: 0,
        cumulativeDrift: 1.0,
        driftDirection: 'stable',
        frozen: false,
        frozenAt: null,
        frozenReason: null,
        lastAdjustment: 0,
      },
    }
  );
  
  return result.modifiedCount > 0;
}

/**
 * Get frozen signal weights
 */
export async function getFrozenSignalWeights() {
  return AdaptiveWeightModel.find({
    scope: 'signal',
    frozen: true,
  }).lean();
}
