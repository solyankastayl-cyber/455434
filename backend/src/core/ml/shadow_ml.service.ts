/**
 * Shadow ML Service (Block F5.1-F5.3)
 * 
 * Implements ML Shadow Mode:
 * - F5.1: Training Contract (features → targets → heads)
 * - F5.2: Model Scope (what ML can say)
 * - F5.3: Shadow Inference Flow
 */
import crypto from 'crypto';
import { 
  MLRuntimeStateModel, 
  ShadowPredictionModel,
  MLTrainingJobModel,
  type MLRuntimeMode,
  type IShadowPrediction,
  ML_MODE_REQUIREMENTS,
} from './shadow_ml.models.js';
import { TrainingSampleModel } from './training_sample.model.js';
import { getMLReadySummaryV2 } from './ml_ready_v2.service.js';

// ============================================================
// F5.1 - TRAINING CONTRACT
// ============================================================

/**
 * Feature vector for ML model
 * Based on TrainingSample + additional context
 */
export interface MLFeatures {
  // Token meta
  mcap: number;
  volume: number;
  momentum: number;
  liquidityChangePct: number;
  
  // Engine outputs
  engineScore: number;
  confidence: number;
  risk: number;
  coverageLevel: number; // 0=LOW, 1=MEDIUM, 2=HIGH
  
  // Actor signals
  dexNetFlowUSD: number;
  whaleNetFlowUSD: number;
  conflictScore: number;
  actorDensity: number;
  
  // Temporal
  signalFreshness: number; // 0=stale, 1=fresh, 2=realtime
  flipsLast7d: number;
  windowType: number; // 0=1h, 1=6h, 2=24h
}

/**
 * ML targets from outcome labeling
 */
export interface MLTargets {
  successLabel: 'SUCCESS' | 'FLAT' | 'FAIL';
  deltaPct: number;
  severity: number;
}

/**
 * ML prediction heads (F5.2 scope)
 */
export interface MLPrediction {
  pSuccess: number;       // Probability of SUCCESS (0-1)
  pFail: number;          // Probability of FAIL (0-1)
  expectedDelta: number;  // Expected % change
  
  // Calibration suggestions (not applied in SHADOW mode)
  confidenceCalibrationDelta: number;
  riskAdjustment: number;
}

// ============================================================
// FEATURE EXTRACTION
// ============================================================

/**
 * Extract ML features from a training sample or ranking
 */
export function extractFeatures(sample: any): MLFeatures {
  return {
    // Token meta (normalized)
    mcap: normalizeValue(sample.features?.coverage || 50, 0, 100),
    volume: normalizeValue(sample.features?.liquidity || 0.5, 0, 1),
    momentum: normalizeValue(sample.features?.momentum || 0, -1, 1),
    liquidityChangePct: normalizeValue(sample.deltaPct || 0, -50, 50),
    
    // Engine outputs
    engineScore: normalizeValue(sample.features?.confidence || 50, 0, 100),
    confidence: normalizeValue(sample.features?.confidence || 50, 0, 100),
    risk: normalizeValue(sample.features?.risk || 50, 0, 100),
    coverageLevel: encodeCoverageLevel(sample.coverageLevel || 'MEDIUM'),
    
    // Actor signals
    dexNetFlowUSD: normalizeValue(sample.features?.dexFlow || 0, -1, 1),
    whaleNetFlowUSD: normalizeValue(sample.features?.whale || 0, -1, 1),
    conflictScore: normalizeValue(Math.abs(sample.features?.conflict || 0), 0, 1),
    actorDensity: normalizeValue(sample.features?.liquidity || 0.5, 0, 1),
    
    // Temporal
    signalFreshness: encodeSignalFreshness(sample.signalFreshness || 'unknown'),
    flipsLast7d: normalizeValue(0, 0, 10), // Placeholder
    windowType: encodeWindowType(sample.windowHours || 24),
  };
}

function normalizeValue(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function encodeCoverageLevel(level: string): number {
  const map: Record<string, number> = { LOW: 0, MEDIUM: 0.5, HIGH: 1 };
  return map[level] ?? 0.5;
}

function encodeSignalFreshness(freshness: string): number {
  const map: Record<string, number> = { stale: 0, unknown: 0.5, fresh: 0.75, realtime: 1 };
  return map[freshness] ?? 0.5;
}

function encodeWindowType(hours: number): number {
  if (hours <= 1) return 0;
  if (hours <= 6) return 0.33;
  if (hours <= 24) return 0.66;
  return 1;
}

function hashFeatures(features: MLFeatures): string {
  const str = JSON.stringify(features);
  return crypto.createHash('md5').update(str).digest('hex').substring(0, 16);
}

// ============================================================
// SIMULATED ML MODEL (Rule-based until real ML is trained)
// ============================================================

/**
 * Simulated ML inference (rule-based for testing)
 * This will be replaced with actual trained model
 */
function simulatedMLInference(features: MLFeatures): MLPrediction {
  // Simple rule-based "prediction" for testing Shadow ML infrastructure
  const baseSuccess = 0.3 + 
    features.confidence * 0.3 +
    features.dexNetFlowUSD * 0.2 +
    features.whaleNetFlowUSD * 0.15 +
    (1 - features.risk) * 0.15 -
    features.conflictScore * 0.2;
  
  const baseFail = 0.2 +
    (1 - features.confidence) * 0.2 +
    features.risk * 0.25 +
    features.conflictScore * 0.3 -
    features.dexNetFlowUSD * 0.1 -
    features.whaleNetFlowUSD * 0.1;
  
  // Normalize probabilities
  const total = baseSuccess + baseFail + 0.3; // Add FLAT base
  const pSuccess = Math.max(0.05, Math.min(0.95, baseSuccess / total));
  const pFail = Math.max(0.05, Math.min(0.95, baseFail / total));
  
  // Expected delta based on probability imbalance
  const expectedDelta = (pSuccess - pFail) * 15; // ±15% max
  
  // Calibration suggestions
  const confidenceCalibrationDelta = (pSuccess - 0.5) * 10; // Suggest confidence adjustment
  const riskAdjustment = (pFail - 0.3) * 15; // Suggest risk adjustment
  
  return {
    pSuccess: Math.round(pSuccess * 1000) / 1000,
    pFail: Math.round(pFail * 1000) / 1000,
    expectedDelta: Math.round(expectedDelta * 100) / 100,
    confidenceCalibrationDelta: Math.round(confidenceCalibrationDelta * 10) / 10,
    riskAdjustment: Math.round(riskAdjustment * 10) / 10,
  };
}

// ============================================================
// F5.3 - SHADOW INFERENCE FLOW
// ============================================================

export interface ShadowInferenceInput {
  tokenAddress: string;
  symbol: string;
  windowType: '1h' | '6h' | '24h';
  rulesDecision: {
    bucket: 'BUY' | 'WATCH' | 'SELL';
    confidence: number;
    risk: number;
    compositeScore: number;
  };
  features: MLFeatures;
  source?: 'live' | 'simulated';
}

export interface ShadowInferenceResult {
  prediction: MLPrediction;
  inputHash: string;
  latencyMs: number;
  modelVersion: string;
  error?: string;
}

/**
 * Run shadow inference for a single token
 */
export async function runShadowInference(
  input: ShadowInferenceInput
): Promise<ShadowInferenceResult> {
  const startTime = Date.now();
  const modelVersion = 'sim-v1.0'; // Will be dynamic when real model is trained
  
  try {
    // Get current runtime state
    const state = await getOrCreateRuntimeState();
    
    // Check if shadow mode is enabled
    if (state.mode !== 'SHADOW' && state.mode !== 'ASSIST' && state.mode !== 'ADVISOR') {
      return {
        prediction: { pSuccess: 0, pFail: 0, expectedDelta: 0, confidenceCalibrationDelta: 0, riskAdjustment: 0 },
        inputHash: '',
        latencyMs: 0,
        modelVersion,
        error: 'ML mode is OFF',
      };
    }
    
    // Check kill switch
    if (state.killSwitchTriggered) {
      return {
        prediction: { pSuccess: 0, pFail: 0, expectedDelta: 0, confidenceCalibrationDelta: 0, riskAdjustment: 0 },
        inputHash: '',
        latencyMs: 0,
        modelVersion,
        error: `Kill switch triggered: ${state.killSwitchReason}`,
      };
    }
    
    // Run inference
    const prediction = simulatedMLInference(input.features);
    const inputHash = hashFeatures(input.features);
    const latencyMs = Date.now() - startTime;
    
    // Save prediction
    await ShadowPredictionModel.create({
      tokenAddress: input.tokenAddress,
      symbol: input.symbol,
      timestamp: new Date(),
      windowType: input.windowType,
      pSuccess: prediction.pSuccess,
      pFail: prediction.pFail,
      expectedDelta: prediction.expectedDelta,
      confidenceCalibrationDelta: prediction.confidenceCalibrationDelta,
      riskAdjustment: prediction.riskAdjustment,
      rulesDecision: input.rulesDecision,
      inputHash,
      featuresSnapshot: input.features as any,
      modelVersion,
      latencyMs,
      errorFlag: false,
      source: input.source || 'live',
    });
    
    return {
      prediction,
      inputHash,
      latencyMs,
      modelVersion,
    };
    
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    
    // Save failed prediction
    await ShadowPredictionModel.create({
      tokenAddress: input.tokenAddress,
      symbol: input.symbol,
      timestamp: new Date(),
      windowType: input.windowType,
      pSuccess: 0,
      pFail: 0,
      expectedDelta: 0,
      confidenceCalibrationDelta: 0,
      riskAdjustment: 0,
      rulesDecision: input.rulesDecision,
      inputHash: '',
      featuresSnapshot: input.features as any,
      modelVersion,
      latencyMs,
      errorFlag: true,
      errorMessage: err.message,
      source: input.source || 'live',
    });
    
    return {
      prediction: { pSuccess: 0, pFail: 0, expectedDelta: 0, confidenceCalibrationDelta: 0, riskAdjustment: 0 },
      inputHash: '',
      latencyMs,
      modelVersion,
      error: err.message,
    };
  }
}

/**
 * Run batch shadow inference for multiple tokens
 */
export async function runBatchShadowInference(
  inputs: ShadowInferenceInput[]
): Promise<ShadowInferenceResult[]> {
  const results: ShadowInferenceResult[] = [];
  
  for (const input of inputs) {
    const result = await runShadowInference(input);
    results.push(result);
  }
  
  // Update runtime state with metrics
  await updateRuntimeMetrics(results);
  
  return results;
}

// ============================================================
// RUNTIME STATE MANAGEMENT
// ============================================================

const RUNTIME_STATE_ID = 'singleton';

async function getOrCreateRuntimeState() {
  let state = await MLRuntimeStateModel.findOne();
  
  if (!state) {
    state = await MLRuntimeStateModel.create({
      mode: 'OFF',
      enabled: false,
      killSwitchTriggered: false,
      allowedModes: ['OFF', 'SHADOW'],
      blockedModes: [
        { mode: 'ASSIST', reason: 'Requires LIVE data (min 300 samples)' },
        { mode: 'ADVISOR', reason: 'Requires LIVE data (min 300 samples)' },
      ],
      inferenceErrorRate: 0,
      inferenceLatencyP95: 0,
      predictionDrift: 0,
    });
  }
  
  return state;
}

async function updateRuntimeMetrics(results: ShadowInferenceResult[]) {
  if (results.length === 0) return;
  
  const errorCount = results.filter(r => r.error).length;
  const errorRate = errorCount / results.length;
  
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const p95Index = Math.floor(latencies.length * 0.95);
  const latencyP95 = latencies[p95Index] || latencies[latencies.length - 1];
  
  await MLRuntimeStateModel.updateOne(
    {},
    {
      $set: {
        lastInferenceAt: new Date(),
        inferenceErrorRate: Math.round(errorRate * 100) / 100,
        inferenceLatencyP95: latencyP95,
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * Set ML runtime mode
 */
export async function setMLMode(mode: MLRuntimeMode, updatedBy: string = 'user'): Promise<{
  success: boolean;
  message: string;
  state?: any;
}> {
  const state = await getOrCreateRuntimeState();
  
  // Check if mode is allowed
  const isBlocked = state.blockedModes?.find(b => b.mode === mode);
  if (isBlocked) {
    return {
      success: false,
      message: `Mode ${mode} is blocked: ${isBlocked.reason}`,
    };
  }
  
  // Check kill switch for non-OFF modes
  if (mode !== 'OFF' && state.killSwitchTriggered) {
    return {
      success: false,
      message: `Cannot enable ${mode}: Kill switch is triggered (${state.killSwitchReason})`,
    };
  }
  
  // Verify requirements
  const requirements = ML_MODE_REQUIREMENTS[mode];
  const mlReady = await getMLReadySummaryV2();
  const liveSamples = mlReady.dataReadiness.samples.live;
  const hasBuy = mlReady.dataReadiness.buckets.BUY > 0;
  const driftStatus = mlReady.drift.status;
  
  if (liveSamples < requirements.minLiveSamples) {
    return {
      success: false,
      message: `Mode ${mode} requires at least ${requirements.minLiveSamples} LIVE samples (current: ${liveSamples})`,
    };
  }
  
  if (requirements.minBuyBucket && !hasBuy) {
    return {
      success: false,
      message: `Mode ${mode} requires BUY bucket samples to avoid bias`,
    };
  }
  
  if (!requirements.driftStatus.includes(driftStatus as any)) {
    return {
      success: false,
      message: `Mode ${mode} requires drift status to be ${requirements.driftStatus.join(' or ')} (current: ${driftStatus})`,
    };
  }
  
  // Update state
  await MLRuntimeStateModel.updateOne(
    {},
    {
      $set: {
        mode,
        enabled: mode !== 'OFF',
        updatedAt: new Date(),
        updatedBy,
      },
    }
  );
  
  const updatedState = await getOrCreateRuntimeState();
  
  return {
    success: true,
    message: `ML mode set to ${mode}`,
    state: {
      mode: updatedState.mode,
      enabled: updatedState.enabled,
      killSwitchTriggered: updatedState.killSwitchTriggered,
    },
  };
}

/**
 * Trigger kill switch
 */
export async function triggerKillSwitch(reason: string): Promise<void> {
  await MLRuntimeStateModel.updateOne(
    {},
    {
      $set: {
        mode: 'OFF',
        enabled: false,
        killSwitchTriggered: true,
        killSwitchReason: reason,
        killSwitchAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'system-kill-switch',
      },
    }
  );
  
  console.log(`[ML Kill Switch] Triggered: ${reason}`);
}

/**
 * Reset kill switch (manual recovery)
 */
export async function resetKillSwitch(updatedBy: string): Promise<void> {
  await MLRuntimeStateModel.updateOne(
    {},
    {
      $set: {
        killSwitchTriggered: false,
        killSwitchReason: null,
        killSwitchAt: null,
        updatedAt: new Date(),
        updatedBy,
      },
    }
  );
  
  console.log(`[ML Kill Switch] Reset by ${updatedBy}`);
}

/**
 * Get current ML runtime status
 */
export async function getMLRuntimeStatus(): Promise<{
  mode: MLRuntimeMode;
  enabled: boolean;
  killSwitch: {
    triggered: boolean;
    reason?: string;
    at?: Date;
  };
  model: {
    version?: string;
    trainedAt?: Date;
    datasetSize?: number;
  };
  health: {
    lastInference?: Date;
    errorRate: number;
    latencyP95: number;
    predictionDrift: number;
  };
  allowedModes: MLRuntimeMode[];
  blockedModes: { mode: MLRuntimeMode; reason: string }[];
}> {
  const state = await getOrCreateRuntimeState();
  
  return {
    mode: state.mode,
    enabled: state.enabled,
    killSwitch: {
      triggered: state.killSwitchTriggered,
      reason: state.killSwitchReason,
      at: state.killSwitchAt,
    },
    model: {
      version: state.modelVersion,
      trainedAt: state.modelTrainedAt,
      datasetSize: state.modelDatasetSize,
    },
    health: {
      lastInference: state.lastInferenceAt,
      errorRate: state.inferenceErrorRate,
      latencyP95: state.inferenceLatencyP95,
      predictionDrift: state.predictionDrift,
    },
    allowedModes: state.allowedModes as MLRuntimeMode[],
    blockedModes: state.blockedModes as any[],
  };
}

// ============================================================
// SHADOW PREDICTION STATS
// ============================================================

export async function getShadowPredictionStats(windowDays: number = 7): Promise<{
  total: number;
  errorRate: number;
  avgLatencyMs: number;
  byBucket: { bucket: string; count: number; avgPSuccess: number; avgPFail: number }[];
  outputDistribution: { pSuccess: { mean: number; std: number }; pFail: { mean: number; std: number } };
}> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  
  const predictions = await ShadowPredictionModel.find({
    timestamp: { $gte: cutoff },
  }).lean();
  
  if (predictions.length === 0) {
    return {
      total: 0,
      errorRate: 0,
      avgLatencyMs: 0,
      byBucket: [],
      outputDistribution: { pSuccess: { mean: 0, std: 0 }, pFail: { mean: 0, std: 0 } },
    };
  }
  
  const errorCount = predictions.filter(p => p.errorFlag).length;
  const errorRate = errorCount / predictions.length;
  
  const latencies = predictions.map(p => p.latencyMs);
  const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  
  // By bucket
  const bucketGroups: Record<string, any[]> = {};
  for (const p of predictions) {
    const bucket = p.rulesDecision?.bucket || 'UNKNOWN';
    if (!bucketGroups[bucket]) bucketGroups[bucket] = [];
    bucketGroups[bucket].push(p);
  }
  
  const byBucket = Object.entries(bucketGroups).map(([bucket, preds]) => ({
    bucket,
    count: preds.length,
    avgPSuccess: preds.reduce((sum, p) => sum + (p.pSuccess || 0), 0) / preds.length,
    avgPFail: preds.reduce((sum, p) => sum + (p.pFail || 0), 0) / preds.length,
  }));
  
  // Output distribution
  const pSuccesses = predictions.map(p => p.pSuccess || 0);
  const pFails = predictions.map(p => p.pFail || 0);
  
  const meanPSuccess = pSuccesses.reduce((a, b) => a + b, 0) / pSuccesses.length;
  const meanPFail = pFails.reduce((a, b) => a + b, 0) / pFails.length;
  
  const stdPSuccess = Math.sqrt(
    pSuccesses.reduce((sum, p) => sum + Math.pow(p - meanPSuccess, 2), 0) / pSuccesses.length
  );
  const stdPFail = Math.sqrt(
    pFails.reduce((sum, p) => sum + Math.pow(p - meanPFail, 2), 0) / pFails.length
  );
  
  return {
    total: predictions.length,
    errorRate: Math.round(errorRate * 100) / 100,
    avgLatencyMs: Math.round(avgLatencyMs),
    byBucket,
    outputDistribution: {
      pSuccess: { mean: Math.round(meanPSuccess * 1000) / 1000, std: Math.round(stdPSuccess * 1000) / 1000 },
      pFail: { mean: Math.round(meanPFail * 1000) / 1000, std: Math.round(stdPFail * 1000) / 1000 },
    },
  };
}
