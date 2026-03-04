/**
 * Neural Inference Service
 * 
 * Applies ML models for confidence calibration and outcome prediction
 * STRICTLY subordinate to Engine V2 and Settings
 */
import { EngineRuntimeConfigModel } from '../engine/engine_runtime_config.model.js';
import { getActiveModels, getTrainingStatus } from './neural_training.service.js';
import type { 
  MLMode, 
  MLStatus, 
  NeuralOutput, 
  ConfidenceCalibration,
  OutcomePrediction,
  RankingAssist,
  MLHealthStatus
} from './neural.types.js';

// Safety thresholds
const MIN_COVERAGE_FOR_ML = 30;
const MIN_MODEL_ACCURACY = 0.55;
const MAX_CONFIDENCE_MODIFIER = 1.2;
const MIN_CONFIDENCE_MODIFIER = 0.8;

/**
 * Get current ML mode from settings
 */
export async function getMLMode(): Promise<MLMode> {
  const config = await EngineRuntimeConfigModel.findOne().lean();
  return (config?.mlMode || 'off') as MLMode;
}

/**
 * Check ML health and safety gates
 */
export async function getMLHealth(): Promise<MLHealthStatus> {
  const mode = await getMLMode();
  const training = await getTrainingStatus();
  const models = await getActiveModels();
  
  const safetyGates = {
    coverageOk: true, // Will be checked per-prediction
    datasetOk: training.datasetSize >= training.minRequiredSamples,
    modelQualityOk: (models.calibration?.metrics?.accuracy || 0) >= MIN_MODEL_ACCURACY,
    driftOk: true, // Would check drift metrics
    shadowOk: true, // Would check shadow metrics
  };
  
  const blockReasons: string[] = [];
  
  if (mode === 'off') {
    blockReasons.push('ML Advisor is OFF');
  }
  if (!safetyGates.datasetOk) {
    blockReasons.push(`Insufficient data (${training.datasetSize} < ${training.minRequiredSamples})`);
  }
  if (!safetyGates.modelQualityOk && models.calibration) {
    blockReasons.push('Model quality below threshold');
  }
  
  let status: MLStatus = 'OK';
  if (mode === 'off') {
    status = 'DISABLED';
  } else if (!safetyGates.datasetOk) {
    status = 'NOT_READY';
  } else if (!safetyGates.modelQualityOk) {
    status = 'DEGRADED';
  }
  
  return {
    mode,
    status,
    training,
    safetyGates,
    blocked: blockReasons.length > 0,
    blockReasons,
  };
}

/**
 * Apply confidence calibration
 * 
 * CONSTRAINTS:
 * - Only adjusts confidence ±20%
 * - Only in ADVISOR or ASSIST mode
 * - Blocked if coverage too low
 */
export async function calibrateConfidence(params: {
  originalConfidence: number;
  evidence: number;
  coverage: number;
  risk: number;
  signalsCount: number;
  driftCount: number;
}): Promise<ConfidenceCalibration | null> {
  const mode = await getMLMode();
  
  if (mode === 'off') {
    return null;
  }
  
  // Safety: block if coverage too low
  if (params.coverage < MIN_COVERAGE_FOR_ML) {
    return {
      originalConfidence: params.originalConfidence,
      mlModifier: 1.0,
      calibratedConfidence: params.originalConfidence,
      notes: ['ML blocked: coverage too low'],
    };
  }
  
  const models = await getActiveModels();
  const calibrationModel = models.calibration;
  
  if (!calibrationModel) {
    return {
      originalConfidence: params.originalConfidence,
      mlModifier: 1.0,
      calibratedConfidence: params.originalConfidence,
      notes: ['No calibration model available'],
    };
  }
  
  // Apply model
  const features = [
    params.evidence,
    params.coverage,
    params.risk,
    params.signalsCount,
    params.driftCount,
  ];
  
  const coefficients = calibrationModel.weights.coefficients;
  const intercept = calibrationModel.weights.intercept || 1.0;
  
  // Calculate modifier
  let score = intercept;
  for (let i = 0; i < Math.min(features.length, coefficients.length); i++) {
    score += features[i] * coefficients[i];
  }
  
  // Clamp modifier to safe range
  const mlModifier = Math.max(
    MIN_CONFIDENCE_MODIFIER,
    Math.min(MAX_CONFIDENCE_MODIFIER, score)
  );
  
  const calibratedConfidence = Math.max(0, Math.min(100,
    params.originalConfidence * mlModifier
  ));
  
  const notes: string[] = [];
  if (mlModifier > 1.1) notes.push('ML increased confidence');
  if (mlModifier < 0.9) notes.push('ML decreased confidence');
  
  return {
    originalConfidence: params.originalConfidence,
    mlModifier: Number(mlModifier.toFixed(3)),
    calibratedConfidence: Math.round(calibratedConfidence),
    notes,
  };
}

/**
 * Predict outcome probabilities
 * 
 * CONSTRAINTS:
 * - Only in ADVISOR or ASSIST mode
 * - Does NOT change BUY/SELL decision
 */
export async function predictOutcome(params: {
  evidence: number;
  direction: number;
  coverage: number;
  risk: number;
}): Promise<OutcomePrediction | null> {
  const mode = await getMLMode();
  
  if (mode === 'off') {
    return null;
  }
  
  const models = await getActiveModels();
  const outcomeModel = models.outcome;
  
  if (!outcomeModel) {
    // Return uniform if no model
    return {
      probUp: 0.33,
      probFlat: 0.34,
      probDown: 0.33,
      expectedMovePct: 0,
      uncertainty: 1.0,
      horizon: '24h',
    };
  }
  
  // Use prior probabilities + direction adjustment
  const priors = outcomeModel.weights.coefficients;
  let probUp = priors[0] || 0.33;
  let probDown = priors[1] || 0.33;
  let probFlat = priors[2] || 0.34;
  
  // Adjust based on direction (-100 to +100)
  const directionAdjust = (params.direction / 100) * 0.2;
  probUp += directionAdjust;
  probDown -= directionAdjust;
  
  // Normalize
  const total = probUp + probDown + probFlat;
  probUp /= total;
  probDown /= total;
  probFlat /= total;
  
  // Calculate expected move
  const expectedMovePct = (probUp * 2.0) + (probDown * -2.0) + (probFlat * 0);
  
  // Calculate uncertainty (entropy)
  const entropy = -(
    (probUp > 0 ? probUp * Math.log2(probUp) : 0) +
    (probDown > 0 ? probDown * Math.log2(probDown) : 0) +
    (probFlat > 0 ? probFlat * Math.log2(probFlat) : 0)
  );
  const maxEntropy = Math.log2(3);
  const uncertainty = entropy / maxEntropy;
  
  return {
    probUp: Number(probUp.toFixed(3)),
    probFlat: Number(probFlat.toFixed(3)),
    probDown: Number(probDown.toFixed(3)),
    expectedMovePct: Number(expectedMovePct.toFixed(2)),
    uncertainty: Number(uncertainty.toFixed(3)),
    horizon: '24h',
  };
}

/**
 * Calculate ranking assist score
 * 
 * CONSTRAINTS:
 * - Only in ASSIST mode
 * - Only reorders within bucket, NEVER changes bucket
 */
export async function calculateRankingAssist(params: {
  originalRankScore: number;
  bucket: string;
  evidence: number;
  direction: number;
  confidence: number;
}): Promise<RankingAssist | null> {
  const mode = await getMLMode();
  
  if (mode !== 'assist') {
    return null; // Only in ASSIST mode
  }
  
  // Simple adjustment based on evidence + direction
  const adjustment = (params.evidence / 100) * (params.direction / 100) * 10;
  
  // Clamp to ±10
  const mlAdjustment = Math.max(-10, Math.min(10, adjustment));
  
  // Calculate assisted score (but don't cross bucket boundaries)
  let assistedRankScore = params.originalRankScore + mlAdjustment;
  
  // Enforce bucket boundaries
  if (params.bucket === 'BUY' && assistedRankScore < 70) {
    assistedRankScore = 70; // Keep in BUY zone
  }
  if (params.bucket === 'WATCH' && (assistedRankScore >= 70 || assistedRankScore < 40)) {
    assistedRankScore = params.originalRankScore; // Don't cross
  }
  if (params.bucket === 'SELL' && assistedRankScore >= 40) {
    assistedRankScore = 39; // Keep in SELL zone
  }
  
  return {
    originalRankScore: params.originalRankScore,
    mlAdjustment: Number(mlAdjustment.toFixed(2)),
    assistedRankScore: Number(assistedRankScore.toFixed(2)),
    withinBucketRank: 0, // Would be calculated after sorting
  };
}

/**
 * Get full neural output for a subject
 */
export async function getNeuralOutput(params: {
  subject: { kind: string; id: string };
  window: string;
  engineScores: {
    evidence: number;
    direction: number;
    coverage: number;
    risk: number;
    confidence: number;
  };
  rankScore?: number;
  bucket?: string;
  signalsCount?: number;
  driftCount?: number;
}): Promise<NeuralOutput> {
  const mode = await getMLMode();
  const health = await getMLHealth();
  const models = await getActiveModels();
  
  let calibration: ConfidenceCalibration | undefined;
  let prediction: OutcomePrediction | undefined;
  let ranking: RankingAssist | undefined;
  
  if (mode !== 'off' && !health.blocked) {
    // Calibration (ADVISOR or ASSIST)
    calibration = await calibrateConfidence({
      originalConfidence: params.engineScores.confidence,
      evidence: params.engineScores.evidence,
      coverage: params.engineScores.coverage,
      risk: params.engineScores.risk,
      signalsCount: params.signalsCount || 0,
      driftCount: params.driftCount || 0,
    }) || undefined;
    
    // Prediction (ADVISOR or ASSIST)
    prediction = await predictOutcome({
      evidence: params.engineScores.evidence,
      direction: params.engineScores.direction,
      coverage: params.engineScores.coverage,
      risk: params.engineScores.risk,
    }) || undefined;
    
    // Ranking assist (ASSIST only)
    if (mode === 'assist' && params.rankScore !== undefined && params.bucket) {
      ranking = await calculateRankingAssist({
        originalRankScore: params.rankScore,
        bucket: params.bucket,
        evidence: params.engineScores.evidence,
        direction: params.engineScores.direction,
        confidence: params.engineScores.confidence,
      }) || undefined;
    }
  }
  
  return {
    subject: params.subject,
    window: params.window,
    mlMode: mode,
    mlStatus: health.status,
    calibration,
    prediction,
    ranking,
    meta: {
      modelVersion: models.calibration?.version || 'none',
      datasetSize: health.training.datasetSize,
      lastTrainedAt: health.training.lastTrainedAt,
    },
  };
}
