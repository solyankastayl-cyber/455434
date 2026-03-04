/**
 * Neural Training Service
 * 
 * Trains ML models from accumulated data (Settings-Controlled)
 */
import { NeuralModelModel, type INeuralModel } from './neural_model.model.js';
import { EngineDecisionLogModel } from '../ml_data/engine_decision_log.model.js';
import { PriceOutcomeModel } from '../ml_data/price_outcome.model.js';
import { EngineRuntimeConfigModel } from '../engine/engine_runtime_config.model.js';
import type { MLMode, ModelQuality, TrainingStatus } from './neural.types.js';

// Minimum samples required for training
const MIN_SAMPLES_CALIBRATION = 100;
const MIN_SAMPLES_OUTCOME = 200;
const MIN_SAMPLES_RANKING = 100;

/**
 * Check if training is allowed based on settings
 */
export async function isTrainingAllowed(): Promise<{ allowed: boolean; mode: MLMode; reason?: string }> {
  const config = await EngineRuntimeConfigModel.findOne().lean();
  
  if (!config) {
    return { allowed: false, mode: 'off', reason: 'No config found' };
  }
  
  const mode = (config.mlMode || 'off') as MLMode;
  
  if (mode === 'off') {
    return { allowed: false, mode, reason: 'ML Advisor is OFF' };
  }
  
  return { allowed: true, mode };
}

/**
 * Get training status
 */
export async function getTrainingStatus(): Promise<TrainingStatus> {
  const [decisionCount, labeledCount, activeModel] = await Promise.all([
    EngineDecisionLogModel.countDocuments(),
    PriceOutcomeModel.countDocuments({ 'horizons.label': { $exists: true } }),
    NeuralModelModel.findOne({ active: true }).lean(),
  ]);
  
  return {
    isTraining: false, // Would be managed by job state
    lastTrainedAt: activeModel?.trainedAt?.toISOString(),
    datasetSize: decisionCount,
    minRequiredSamples: MIN_SAMPLES_CALIBRATION,
    isReadyForTraining: labeledCount >= MIN_SAMPLES_CALIBRATION,
    quality: activeModel ? {
      accuracy: activeModel.metrics.accuracy || 0,
      macroF1: activeModel.metrics.macroF1 || 0,
      brierScore: activeModel.metrics.brierScore || 0,
      calibrationError: activeModel.metrics.calibrationError || 0,
      sampleCount: activeModel.datasetRange.sampleCount,
      lastEvaluatedAt: activeModel.trainedAt.toISOString(),
    } : undefined,
  };
}

/**
 * Train Confidence Calibration Model
 * 
 * Simple linear model: mlModifier = f(evidence, coverage, risk, penalties)
 * Goal: calibratedConfidence should match actual success rate
 */
export async function trainCalibrationModel(): Promise<INeuralModel | null> {
  const { allowed, reason } = await isTrainingAllowed();
  if (!allowed) {
    console.log(`[Neural] Training blocked: ${reason}`);
    return null;
  }
  
  // Get labeled samples
  const outcomes = await PriceOutcomeModel.find({
    'horizons.label': { $exists: true }
  })
    .populate('decisionLogId')
    .lean();
  
  if (outcomes.length < MIN_SAMPLES_CALIBRATION) {
    console.log(`[Neural] Not enough samples for calibration: ${outcomes.length} < ${MIN_SAMPLES_CALIBRATION}`);
    return null;
  }
  
  // Build training data
  const X: number[][] = [];
  const y: number[] = [];
  
  for (const outcome of outcomes) {
    const log = outcome.decisionLogId as any;
    if (!log?.scores) continue;
    
    const horizon24h = outcome.horizons.find(h => h.h === '24h');
    if (!horizon24h?.label) continue;
    
    // Features: evidence, coverage, risk, penalties, signals count
    const features = [
      log.scores.evidence || 0,
      log.scores.coverage || 0,
      log.scores.risk || 0,
      log.topSignals?.length || 0,
      log.health?.driftFlags?.length || 0,
    ];
    
    // Target: 1 if UP, 0 if DOWN/FLAT
    const target = horizon24h.label === 'UP' ? 1 : 0;
    
    X.push(features);
    y.push(target);
  }
  
  if (X.length < MIN_SAMPLES_CALIBRATION) {
    console.log(`[Neural] Not enough valid samples: ${X.length}`);
    return null;
  }
  
  // Simple logistic-like model (in production would use actual ML library)
  // For now, compute feature averages for UP vs DOWN
  const upSamples = X.filter((_, i) => y[i] === 1);
  const downSamples = X.filter((_, i) => y[i] === 0);
  
  const avgUp = upSamples.reduce((acc, x) => acc.map((v, i) => v + x[i] / upSamples.length), [0, 0, 0, 0, 0]);
  const avgDown = downSamples.length > 0 
    ? downSamples.reduce((acc, x) => acc.map((v, i) => v + x[i] / downSamples.length), [0, 0, 0, 0, 0])
    : [50, 30, 70, 2, 1];
  
  // Coefficients: difference normalized
  const coefficients = avgUp.map((v, i) => {
    const diff = v - avgDown[i];
    const range = Math.max(Math.abs(avgUp[i]), Math.abs(avgDown[i]), 1);
    return diff / range * 0.2; // Scale to ±0.2 contribution
  });
  
  // Calculate model accuracy (simple)
  let correct = 0;
  for (let i = 0; i < X.length; i++) {
    const score = X[i].reduce((s, x, j) => s + x * coefficients[j], 0);
    const pred = score > 0 ? 1 : 0;
    if (pred === y[i]) correct++;
  }
  const accuracy = correct / X.length;
  
  // Deactivate old models
  await NeuralModelModel.updateMany(
    { modelType: 'calibration', active: true },
    { $set: { active: false } }
  );
  
  // Create new model
  const version = `calibration-v${Date.now()}`;
  const model = await NeuralModelModel.create({
    modelType: 'calibration',
    version,
    trainedAt: new Date(),
    datasetRange: {
      from: outcomes[outcomes.length - 1]?.t0,
      to: outcomes[0]?.t0,
      sampleCount: X.length,
    },
    metrics: {
      accuracy,
      brierScore: 1 - accuracy, // Simplified
    },
    weights: {
      features: ['evidence', 'coverage', 'risk', 'signalsCount', 'driftCount'],
      coefficients,
      intercept: 1.0,
    },
    active: true,
    meta: {
      framework: 'simple-linear',
      notes: `Trained on ${X.length} samples, accuracy=${(accuracy * 100).toFixed(1)}%`,
    },
  });
  
  console.log(`[Neural] Calibration model trained: ${version}, accuracy=${(accuracy * 100).toFixed(1)}%`);
  return model;
}

/**
 * Train Outcome Prediction Model
 * 
 * Predicts UP/FLAT/DOWN probabilities
 */
export async function trainOutcomeModel(): Promise<INeuralModel | null> {
  const { allowed, reason } = await isTrainingAllowed();
  if (!allowed) {
    console.log(`[Neural] Training blocked: ${reason}`);
    return null;
  }
  
  // Get labeled samples
  const outcomes = await PriceOutcomeModel.find({
    'horizons.label': { $exists: true }
  })
    .populate('decisionLogId')
    .limit(1000)
    .lean();
  
  if (outcomes.length < MIN_SAMPLES_OUTCOME) {
    console.log(`[Neural] Not enough samples for outcome model: ${outcomes.length} < ${MIN_SAMPLES_OUTCOME}`);
    return null;
  }
  
  // Count label distribution
  const labelCounts = { UP: 0, DOWN: 0, FLAT: 0 };
  for (const outcome of outcomes) {
    const h24 = outcome.horizons.find(h => h.h === '24h');
    if (h24?.label) {
      labelCounts[h24.label as keyof typeof labelCounts]++;
    }
  }
  
  const total = labelCounts.UP + labelCounts.DOWN + labelCounts.FLAT;
  if (total === 0) return null;
  
  // Base probabilities (prior)
  const priors = {
    UP: labelCounts.UP / total,
    DOWN: labelCounts.DOWN / total,
    FLAT: labelCounts.FLAT / total,
  };
  
  // Deactivate old models
  await NeuralModelModel.updateMany(
    { modelType: 'outcome', active: true },
    { $set: { active: false } }
  );
  
  // Create model with prior probabilities
  const version = `outcome-v${Date.now()}`;
  const model = await NeuralModelModel.create({
    modelType: 'outcome',
    version,
    trainedAt: new Date(),
    datasetRange: {
      from: outcomes[outcomes.length - 1]?.t0,
      to: outcomes[0]?.t0,
      sampleCount: total,
    },
    metrics: {
      accuracy: Math.max(priors.UP, priors.DOWN, priors.FLAT), // Baseline accuracy
    },
    weights: {
      features: ['priorUp', 'priorDown', 'priorFlat'],
      coefficients: [priors.UP, priors.DOWN, priors.FLAT],
      intercept: 0,
      thresholds: {
        UP: 0.4,
        DOWN: 0.4,
      },
    },
    active: true,
    meta: {
      framework: 'prior-model',
      notes: `Prior probabilities: UP=${(priors.UP * 100).toFixed(1)}%, DOWN=${(priors.DOWN * 100).toFixed(1)}%, FLAT=${(priors.FLAT * 100).toFixed(1)}%`,
    },
  });
  
  console.log(`[Neural] Outcome model trained: ${version}`);
  return model;
}

/**
 * Get active models
 */
export async function getActiveModels(): Promise<{
  calibration?: INeuralModel;
  outcome?: INeuralModel;
  ranking?: INeuralModel;
}> {
  const models = await NeuralModelModel.find({ active: true }).lean();
  
  return {
    calibration: models.find(m => m.modelType === 'calibration'),
    outcome: models.find(m => m.modelType === 'outcome'),
    ranking: models.find(m => m.modelType === 'ranking'),
  };
}
