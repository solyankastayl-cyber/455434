/**
 * Shadow ML Service
 * 
 * ETAP 4: Shadow ML integration service.
 * 
 * Responsibilities:
 * - Trigger training via ML service
 * - Run shadow inference on new snapshots
 * - Store predictions
 * - Calculate final calibrated confidence
 * 
 * NO INFLUENCE ON SCORE/BUCKET - confidence calibration only.
 */
import { ShadowPredictionModel, type IShadowPrediction } from './shadow_prediction.model.js';
import { LearningSampleModel } from '../dataset/learning_sample.model.js';
import { PredictionSnapshotModel } from '../models/PredictionSnapshot.model.js';
import {
  checkMLServiceHealth,
  getMLServiceStatus,
  trainShadowModel,
  getShadowPredictions,
  getEvaluation,
} from './shadow_ml.client.js';
import type { Horizon, DriftLevel } from '../learning.types.js';
import type {
  TrainResult,
  ShadowEvalReport,
  MLServiceStatus,
  ConfidenceCalibration,
} from './shadow_ml.types.js';

// ==================== DRIFT MODIFIERS ====================

const DRIFT_CONFIDENCE_MODIFIERS: Record<DriftLevel, number> = {
  LOW: 1.0,
  MEDIUM: 0.85,
  HIGH: 0.6,
  CRITICAL: 0.3,
};

// ==================== TYPES ====================

export interface InferenceResult {
  processed: number;
  stored: number;
  skipped: number;
  errors: number;
  details: Array<{
    snapshotId: string;
    status: 'stored' | 'skipped' | 'error';
    p_success?: number;
    reason?: string;
  }>;
}

// ==================== CORE FUNCTIONS ====================

/**
 * Check if ML service is available
 */
export async function isShadowMLAvailable(): Promise<boolean> {
  return checkMLServiceHealth();
}

/**
 * Get ML service status
 */
export async function getShadowMLStatus(): Promise<MLServiceStatus> {
  return getMLServiceStatus();
}

/**
 * Train shadow model for horizon
 */
export async function trainModel(
  horizon: Horizon,
  minSamples: number = 50,
  forceRetrain: boolean = false
): Promise<TrainResult> {
  console.log(`[ShadowML] Training model for ${horizon}...`);
  return trainShadowModel(horizon, minSamples, forceRetrain);
}

/**
 * Run shadow inference on samples
 */
export async function runInference(
  horizon: Horizon,
  limit: number = 100
): Promise<InferenceResult> {
  const result: InferenceResult = {
    processed: 0,
    stored: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };
  
  try {
    // Check ML service availability
    const available = await checkMLServiceHealth();
    if (!available) {
      throw new Error('ML service not available');
    }
    
    // Get samples that need prediction
    const existingPredictions = await ShadowPredictionModel.find({ horizon })
      .select('snapshotId')
      .lean();
    const predictedSet = new Set(existingPredictions.map(p => p.snapshotId));
    
    const samples = await LearningSampleModel.find({
      'quality.trainEligible': true,
    })
      .sort({ builtAt: -1 })
      .limit(limit * 2)
      .lean();
    
    // Filter out already predicted
    const toPredictSamples = samples.filter(s => !predictedSet.has(s.snapshotId));
    const batch = toPredictSamples.slice(0, limit);
    
    if (batch.length === 0) {
      return result;
    }
    
    // Get predictions from ML service
    const predictions = await getShadowPredictions(batch, horizon);
    
    // Store predictions
    for (const pred of predictions.predictions) {
      try {
        const sample = batch.find(s => s.snapshotId === pred.snapshotId);
        if (!sample) {
          result.skipped++;
          continue;
        }
        
        // Get snapshot for rules confidence
        const snapshot = await PredictionSnapshotModel.findOne({
          snapshotId: pred.snapshotId,
        }).lean();
        
        const rulesConfidence = snapshot?.decision?.confidence || 50;
        const driftModifier = DRIFT_CONFIDENCE_MODIFIERS[pred.drift_level as DriftLevel] || 1.0;
        
        // Calculate final confidence
        const finalConfidence = calculateFinalConfidence(
          rulesConfidence,
          driftModifier,
          pred.confidence_modifier
        );
        
        // Store prediction
        await ShadowPredictionModel.findOneAndUpdate(
          { snapshotId: pred.snapshotId, horizon },
          {
            $set: {
              tokenAddress: sample.tokenAddress,
              symbol: sample.symbol,
              horizon,
              p_success: pred.p_success,
              ml_confidence: pred.ml_confidence,
              confidence_modifier: pred.confidence_modifier,
              drift_level: pred.drift_level,
              bucket: sample.features.snapshot.bucket,
              rules_confidence: rulesConfidence,
              final_confidence: finalConfidence,
              model_id: predictions.model_id,
              predicted_at: new Date(),
            },
          },
          { upsert: true }
        );
        
        result.stored++;
        result.details.push({
          snapshotId: pred.snapshotId,
          status: 'stored',
          p_success: pred.p_success,
        });
        
      } catch (error: any) {
        result.errors++;
        result.details.push({
          snapshotId: pred.snapshotId,
          status: 'error',
          reason: error.message,
        });
      }
      
      result.processed++;
    }
    
    return result;
    
  } catch (error: any) {
    console.error('[ShadowML] Inference failed:', error);
    throw error;
  }
}

/**
 * Calculate final calibrated confidence
 * 
 * Formula: finalConfidence = rulesConfidence * driftModifier * mlModifier
 */
export function calculateFinalConfidence(
  rulesConfidence: number,
  driftModifier: number,
  mlModifier: number
): number {
  const final = rulesConfidence * driftModifier * mlModifier;
  return Math.round(Math.min(100, Math.max(0, final)));
}

/**
 * Get calibration for a snapshot
 */
export async function getCalibration(
  snapshotId: string,
  horizon: Horizon
): Promise<ConfidenceCalibration | null> {
  const prediction = await ShadowPredictionModel.findOne({
    snapshotId,
    horizon,
  }).lean();
  
  if (!prediction) return null;
  
  return {
    rules_confidence: prediction.rules_confidence,
    drift_modifier: DRIFT_CONFIDENCE_MODIFIERS[prediction.drift_level as DriftLevel] || 1.0,
    ml_modifier: prediction.confidence_modifier,
    final_confidence: prediction.final_confidence,
  };
}

/**
 * Get evaluation report
 */
export async function evaluate(horizon: Horizon): Promise<ShadowEvalReport> {
  return getEvaluation(horizon);
}

// ==================== QUERY FUNCTIONS ====================

/**
 * Get predictions by token
 */
export async function getPredictionsByToken(
  tokenAddress: string,
  horizon?: Horizon,
  limit: number = 50
): Promise<IShadowPrediction[]> {
  const query: any = { tokenAddress: tokenAddress.toLowerCase() };
  if (horizon) query.horizon = horizon;
  
  return ShadowPredictionModel.find(query)
    .sort({ predicted_at: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get prediction statistics
 */
export async function getPredictionStats(horizon?: Horizon): Promise<{
  total: number;
  avgPSuccess: number;
  avgConfidenceModifier: number;
  byBucket: Record<string, number>;
  byDriftLevel: Record<string, number>;
}> {
  const matchStage: any = {};
  if (horizon) matchStage.horizon = horizon;
  
  const [total, avgStats, bucketCounts, driftCounts] = await Promise.all([
    ShadowPredictionModel.countDocuments(matchStage),
    ShadowPredictionModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          avgPSuccess: { $avg: '$p_success' },
          avgConfidenceModifier: { $avg: '$confidence_modifier' },
        },
      },
    ]),
    ShadowPredictionModel.aggregate([
      { $match: matchStage },
      { $group: { _id: '$bucket', count: { $sum: 1 } } },
    ]),
    ShadowPredictionModel.aggregate([
      { $match: matchStage },
      { $group: { _id: '$drift_level', count: { $sum: 1 } } },
    ]),
  ]);
  
  const stats = avgStats[0] || {};
  
  const byBucket: Record<string, number> = {};
  bucketCounts.forEach(b => { byBucket[b._id] = b.count; });
  
  const byDriftLevel: Record<string, number> = {};
  driftCounts.forEach(d => { byDriftLevel[d._id] = d.count; });
  
  return {
    total,
    avgPSuccess: Math.round((stats.avgPSuccess || 0) * 1000) / 1000,
    avgConfidenceModifier: Math.round((stats.avgConfidenceModifier || 0) * 1000) / 1000,
    byBucket,
    byDriftLevel,
  };
}
