/**
 * ML Evaluation Service (Block F5.4-F5.5)
 * 
 * Implements:
 * - F5.4: Shadow Evaluation Metrics (ML vs Rules)
 * - F5.5: Safety Gates + Kill Switch triggers
 */
import crypto from 'crypto';
import {
  MLEvaluationResultModel,
  ShadowPredictionModel,
  type IMLEvaluationResult,
} from './shadow_ml.models.js';
import { TrainingSampleModel } from './training_sample.model.js';
import { triggerKillSwitch } from './shadow_ml.service.js';

// ============================================================
// EVALUATION THRESHOLDS (F5.5 Safety Gates)
// ============================================================

const EVAL_THRESHOLDS = {
  // Minimum acceptable metrics
  minAccuracy: 0.45,
  minAuc: 0.55,
  maxCalibrationError: 0.25,
  maxLatencyP95: 100, // ms
  maxErrorRate: 0.05,
  
  // Stability thresholds
  maxPredictionVariance: 0.3,
  minOutputVariance: 0.01, // Detect constant outputs
  
  // Kill switch triggers
  killOnErrorRateAbove: 0.15,
  killOnConstantOutputs: true,
  killOnLatencyAbove: 500, // ms
};

// ============================================================
// EVALUATION METRICS CALCULATION
// ============================================================

interface EvaluationDataPoint {
  pSuccess: number;
  pFail: number;
  expectedDelta: number;
  actualOutcome: 'SUCCESS' | 'FLAT' | 'FAIL';
  actualDelta: number;
  bucket: 'BUY' | 'WATCH' | 'SELL';
  latencyMs: number;
  errorFlag: boolean;
}

/**
 * Calculate accuracy (correct bucket prediction)
 */
function calculateAccuracy(data: EvaluationDataPoint[]): number {
  if (data.length === 0) return 0;
  
  let correct = 0;
  for (const d of data) {
    // ML prediction: highest probability wins
    const mlPrediction = d.pSuccess > d.pFail ? 'SUCCESS' : d.pFail > 0.4 ? 'FAIL' : 'FLAT';
    if (mlPrediction === d.actualOutcome) correct++;
  }
  
  return correct / data.length;
}

/**
 * Calculate AUC for SUCCESS vs FAIL (binary classification)
 */
function calculateAUC(data: EvaluationDataPoint[]): number {
  // Filter to only SUCCESS and FAIL outcomes
  const filtered = data.filter(d => d.actualOutcome === 'SUCCESS' || d.actualOutcome === 'FAIL');
  if (filtered.length < 10) return 0.5;
  
  // Sort by pSuccess descending
  const sorted = [...filtered].sort((a, b) => b.pSuccess - a.pSuccess);
  
  // Calculate AUC using trapezoidal rule
  let positives = filtered.filter(d => d.actualOutcome === 'SUCCESS').length;
  let negatives = filtered.length - positives;
  
  if (positives === 0 || negatives === 0) return 0.5;
  
  let tp = 0, fp = 0;
  let auc = 0;
  let prevTpr = 0, prevFpr = 0;
  
  for (const d of sorted) {
    if (d.actualOutcome === 'SUCCESS') tp++;
    else fp++;
    
    const tpr = tp / positives;
    const fpr = fp / negatives;
    
    // Trapezoidal integration
    auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;
    
    prevTpr = tpr;
    prevFpr = fpr;
  }
  
  return Math.round(auc * 1000) / 1000;
}

/**
 * Calculate Expected Calibration Error (ECE)
 */
function calculateCalibrationECE(data: EvaluationDataPoint[]): number {
  if (data.length === 0) return 0;
  
  // Bin by confidence (pSuccess)
  const bins: { count: number; correct: number; confidence: number }[] = [];
  for (let i = 0; i < 10; i++) {
    bins.push({ count: 0, correct: 0, confidence: 0 });
  }
  
  for (const d of data) {
    const binIdx = Math.min(9, Math.floor(d.pSuccess * 10));
    bins[binIdx].count++;
    bins[binIdx].confidence += d.pSuccess;
    if (d.actualOutcome === 'SUCCESS') bins[binIdx].correct++;
  }
  
  // Calculate ECE
  let ece = 0;
  for (const bin of bins) {
    if (bin.count === 0) continue;
    const avgConf = bin.confidence / bin.count;
    const accuracy = bin.correct / bin.count;
    ece += (bin.count / data.length) * Math.abs(accuracy - avgConf);
  }
  
  return Math.round(ece * 1000) / 1000;
}

/**
 * Calculate Brier score
 */
function calculateBrierScore(data: EvaluationDataPoint[]): number {
  if (data.length === 0) return 0;
  
  let sum = 0;
  for (const d of data) {
    const target = d.actualOutcome === 'SUCCESS' ? 1 : 0;
    sum += Math.pow(d.pSuccess - target, 2);
  }
  
  return Math.round((sum / data.length) * 1000) / 1000;
}

/**
 * Calculate output stability (variance of predictions)
 */
function calculateStabilityVariance(data: EvaluationDataPoint[]): number {
  if (data.length < 2) return 0;
  
  const pSuccesses = data.map(d => d.pSuccess);
  const mean = pSuccesses.reduce((a, b) => a + b, 0) / pSuccesses.length;
  const variance = pSuccesses.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pSuccesses.length;
  
  return Math.round(Math.sqrt(variance) * 1000) / 1000;
}

/**
 * Calculate metrics by bucket
 */
function calculateBucketMetrics(data: EvaluationDataPoint[]): {
  bucket: 'BUY' | 'WATCH' | 'SELL';
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  sampleCount: number;
}[] {
  const buckets: ('BUY' | 'WATCH' | 'SELL')[] = ['BUY', 'WATCH', 'SELL'];
  
  return buckets.map(bucket => {
    const bucketData = data.filter(d => d.bucket === bucket);
    if (bucketData.length === 0) {
      return { bucket, accuracy: 0, precision: 0, recall: 0, f1: 0, sampleCount: 0 };
    }
    
    const accuracy = calculateAccuracy(bucketData);
    
    // Calculate precision/recall for SUCCESS prediction
    let tp = 0, fp = 0, fn = 0;
    for (const d of bucketData) {
      const predicted = d.pSuccess > 0.5;
      const actual = d.actualOutcome === 'SUCCESS';
      
      if (predicted && actual) tp++;
      else if (predicted && !actual) fp++;
      else if (!predicted && actual) fn++;
    }
    
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    
    return {
      bucket,
      accuracy: Math.round(accuracy * 100) / 100,
      precision: Math.round(precision * 100) / 100,
      recall: Math.round(recall * 100) / 100,
      f1: Math.round(f1 * 100) / 100,
      sampleCount: bucketData.length,
    };
  });
}

// ============================================================
// MAIN EVALUATION FUNCTION
// ============================================================

export async function runMLEvaluation(modelVersion?: string): Promise<IMLEvaluationResult> {
  const evalId = `eval-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const version = modelVersion || 'sim-v1.0';
  
  console.log(`[ML Eval] Starting evaluation ${evalId} for model ${version}`);
  
  try {
    // Get predictions with their corresponding outcomes
    const predictions = await ShadowPredictionModel.find({
      modelVersion: version,
    }).sort({ timestamp: -1 }).limit(1000).lean();
    
    if (predictions.length < 50) {
      throw new Error(`Insufficient predictions for evaluation: ${predictions.length} < 50`);
    }
    
    // Get training samples for actual outcomes
    const tokenAddresses = [...new Set(predictions.map(p => p.tokenAddress))];
    const samples = await TrainingSampleModel.find({
      tokenAddress: { $in: tokenAddresses },
    }).lean();
    
    // Create lookup map
    const sampleMap = new Map<string, any>();
    for (const s of samples) {
      const key = `${s.tokenAddress}-${s.windowHours}`;
      sampleMap.set(key, s);
    }
    
    // Prepare evaluation data
    const evalData: EvaluationDataPoint[] = [];
    
    for (const pred of predictions) {
      const windowHours = pred.windowType === '1h' ? 1 : pred.windowType === '6h' ? 6 : 24;
      const sample = sampleMap.get(`${pred.tokenAddress}-${windowHours}`);
      
      if (sample) {
        evalData.push({
          pSuccess: pred.pSuccess,
          pFail: pred.pFail,
          expectedDelta: pred.expectedDelta,
          actualOutcome: sample.outcomeLabel,
          actualDelta: sample.deltaPct,
          bucket: pred.rulesDecision.bucket,
          latencyMs: pred.latencyMs,
          errorFlag: pred.errorFlag,
        });
      }
    }
    
    if (evalData.length < 30) {
      throw new Error(`Insufficient matched data for evaluation: ${evalData.length} < 30`);
    }
    
    // Calculate metrics
    const accuracy = calculateAccuracy(evalData);
    const auc = calculateAUC(evalData);
    const ece = calculateCalibrationECE(evalData);
    const brier = calculateBrierScore(evalData);
    const stability = calculateStabilityVariance(evalData);
    
    const latencies = evalData.map(d => d.latencyMs).sort((a, b) => a - b);
    const latencyP95 = latencies[Math.floor(latencies.length * 0.95)] || latencies[latencies.length - 1];
    
    const bucketMetrics = calculateBucketMetrics(evalData);
    
    // Consistency metrics
    const errorRate = evalData.filter(d => d.errorFlag).length / evalData.length;
    const coverageRate = evalData.length / predictions.length;
    
    // Determine verdict
    const verdictReasons: string[] = [];
    let verdict: 'PASS' | 'NEEDS_REVIEW' | 'FAIL' = 'PASS';
    
    if (accuracy < EVAL_THRESHOLDS.minAccuracy) {
      verdict = 'FAIL';
      verdictReasons.push(`Accuracy ${(accuracy * 100).toFixed(1)}% below threshold ${(EVAL_THRESHOLDS.minAccuracy * 100)}%`);
    }
    
    if (auc < EVAL_THRESHOLDS.minAuc) {
      verdict = verdict === 'PASS' ? 'NEEDS_REVIEW' : verdict;
      verdictReasons.push(`AUC ${auc.toFixed(3)} below threshold ${EVAL_THRESHOLDS.minAuc}`);
    }
    
    if (ece > EVAL_THRESHOLDS.maxCalibrationError) {
      verdict = verdict === 'PASS' ? 'NEEDS_REVIEW' : verdict;
      verdictReasons.push(`Calibration error ${ece.toFixed(3)} above threshold ${EVAL_THRESHOLDS.maxCalibrationError}`);
    }
    
    if (stability < EVAL_THRESHOLDS.minOutputVariance) {
      verdict = 'FAIL';
      verdictReasons.push('Constant outputs detected (possible model collapse)');
    }
    
    if (errorRate > EVAL_THRESHOLDS.maxErrorRate) {
      verdict = verdict === 'PASS' ? 'NEEDS_REVIEW' : verdict;
      verdictReasons.push(`Error rate ${(errorRate * 100).toFixed(1)}% above threshold ${(EVAL_THRESHOLDS.maxErrorRate * 100)}%`);
    }
    
    if (verdictReasons.length === 0) {
      verdictReasons.push('All metrics within acceptable range');
    }
    
    // Promotion blockers
    const promotionBlockers: string[] = [];
    
    // Check for LIVE data
    const liveCount = predictions.filter(p => p.source !== 'simulated').length;
    if (liveCount < 100) {
      promotionBlockers.push(`Insufficient LIVE predictions (${liveCount}/100)`);
    }
    
    // Check BUY bucket
    const buyMetrics = bucketMetrics.find(b => b.bucket === 'BUY');
    if (!buyMetrics || buyMetrics.sampleCount < 10) {
      promotionBlockers.push('Insufficient BUY bucket samples');
    }
    
    if (verdict === 'FAIL') {
      promotionBlockers.push('Evaluation verdict is FAIL');
    }
    
    const canPromote = promotionBlockers.length === 0;
    
    // Get time range
    const timestamps = predictions.map(p => new Date(p.timestamp).getTime());
    const timeRange = {
      start: new Date(Math.min(...timestamps)),
      end: new Date(Math.max(...timestamps)),
    };
    
    // Determine dataset type
    const simCount = predictions.filter(p => p.source === 'simulated').length;
    let datasetType: 'sim' | 'live' | 'mixed' = 'mixed';
    if (simCount === predictions.length) datasetType = 'sim';
    else if (liveCount === predictions.length) datasetType = 'live';
    
    // Save evaluation result
    const evalResult = await MLEvaluationResultModel.create({
      evalId,
      modelVersion: version,
      datasetType,
      sampleCount: evalData.length,
      timeRange,
      offlineMetrics: {
        accuracy: Math.round(accuracy * 1000) / 1000,
        aucSuccessVsFail: auc,
        calibrationECE: ece,
        calibrationBrier: brier,
        stabilityVariance: stability,
        latencyP95,
      },
      bucketMetrics,
      consistencyMetrics: {
        predictionDriftDayToDay: stability, // Simplified
        coverageRate: Math.round(coverageRate * 100) / 100,
        errorRate: Math.round(errorRate * 1000) / 1000,
      },
      verdict,
      verdictReasons,
      canPromote,
      promotionBlockers,
    });
    
    console.log(`[ML Eval] Completed ${evalId}: ${verdict}`);
    
    // Check kill switch triggers (F5.5)
    if (errorRate > EVAL_THRESHOLDS.killOnErrorRateAbove) {
      await triggerKillSwitch(`High error rate: ${(errorRate * 100).toFixed(1)}%`);
    }
    
    if (EVAL_THRESHOLDS.killOnConstantOutputs && stability < EVAL_THRESHOLDS.minOutputVariance) {
      await triggerKillSwitch('Constant outputs detected - possible model collapse');
    }
    
    if (latencyP95 > EVAL_THRESHOLDS.killOnLatencyAbove) {
      await triggerKillSwitch(`High latency: p95=${latencyP95}ms`);
    }
    
    return evalResult.toObject();
    
  } catch (err: any) {
    console.error(`[ML Eval] Failed ${evalId}:`, err.message);
    throw err;
  }
}

/**
 * Get latest evaluation result
 */
export async function getLatestEvaluation(modelVersion?: string): Promise<IMLEvaluationResult | null> {
  const query: any = {};
  if (modelVersion) query.modelVersion = modelVersion;
  
  const result = await MLEvaluationResultModel.findOne(query)
    .sort({ createdAt: -1 })
    .lean();
  
  return result;
}

/**
 * Get evaluation history
 */
export async function getEvaluationHistory(limit: number = 10): Promise<IMLEvaluationResult[]> {
  const results = await MLEvaluationResultModel.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  
  return results;
}
