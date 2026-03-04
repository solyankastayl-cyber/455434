/**
 * Adaptive Intelligence Service (Phase 12A)
 * 
 * Orchestrates adaptive weights, confidence calibration, and strategy reliability.
 * Makes the system self-improving based on feedback and outcomes.
 */
import * as weightsRepo from './adaptive_weights.repository.js';
import * as calibrationRepo from './confidence_calibration.repository.js';
import * as reliabilityRepo from './strategy_reliability.repository.js';
import { FeedbackModel } from '../feedback/feedback.model.js';
import { SimulationModel } from '../simulations/simulations.model.js';
import { DecisionModel } from '../decisions/decisions.model.js';
import { env, ADAPTIVE_VERSION } from '../../config/env.js';

// Re-export version
export { ADAPTIVE_VERSION };

// ========== INITIALIZATION ==========

/**
 * Initialize adaptive system
 * Called on startup
 */
export async function initializeAdaptiveSystem(): Promise<void> {
  console.log('[Adaptive] Initializing adaptive intelligence system...');
  
  // Initialize global weights
  await weightsRepo.initializeGlobalScoreWeights();
  await weightsRepo.initializeGlobalDecisionWeights();
  
  // Initialize strategy reliability
  await reliabilityRepo.initializeAllStrategies();
  
  // Initialize confidence calibration for decision types
  const decisionTypes = ['follow', 'copy', 'watch', 'ignore', 'reduce_exposure', 'increase_exposure'];
  for (const type of decisionTypes) {
    await calibrationRepo.getOrCreateCalibration('decision', type);
  }
  
  console.log('[Adaptive] Initialization complete');
}

// ========== WEIGHTS ==========

/**
 * Get current weights
 */
export async function getWeights(scope?: string) {
  if (scope) {
    return weightsRepo.getWeightsForScope(
      scope === 'global' ? 'global' : 'strategy',
      scope
    );
  }
  return weightsRepo.getGlobalWeights();
}

/**
 * Get effective weight for scoring
 */
export async function getEffectiveScoreWeight(key: string): Promise<number> {
  const weight = await weightsRepo.getWeight('global', 'global', 'score', key);
  return weight?.currentWeight ?? weightsRepo.BASE_SCORE_WEIGHTS[key] ?? 0;
}

/**
 * Get all effective score weights
 */
export async function getEffectiveScoreWeights(): Promise<Record<string, number>> {
  const weights = await weightsRepo.getGlobalWeights();
  const scoreWeights = weights.filter(w => w.target === 'score');
  
  const result: Record<string, number> = {};
  for (const w of scoreWeights) {
    result[w.key] = w.currentWeight;
  }
  
  return result;
}

/**
 * Process feedback and adjust weights
 */
export async function processFeedbackForWeights(
  feedbackId: string
): Promise<{ adjusted: string[]; boundaryHits: string[] }> {
  const feedback = await FeedbackModel.findById(feedbackId).lean();
  if (!feedback) return { adjusted: [], boundaryHits: [] };
  
  const adjusted: string[] = [];
  const boundaryHits: string[] = [];
  
  // Convert rating (1-5) to score (-1 to +1)
  const feedbackScore = feedback.rating 
    ? (feedback.rating - 3) / 2  // 1→-1, 3→0, 5→+1
    : 0;
  
  if (feedbackScore === 0) return { adjusted: [], boundaryHits: [] };
  
  // Adjust decision weights based on feedback
  if (feedback.context.decisionType) {
    const decisionType = feedback.context.decisionType;
    
    // Adjust accuracy weight
    const { weight, hitBoundary } = await weightsRepo.adjustWeight(
      'decision_type',
      decisionType,
      'decision',
      'accuracy',
      feedbackScore,
      `Feedback from ${feedbackId}`
    );
    
    if (weight) adjusted.push(`${decisionType}:accuracy`);
    if (hitBoundary) boundaryHits.push(`${decisionType}:accuracy`);
  }
  
  return { adjusted, boundaryHits };
}

// ========== CONFIDENCE CALIBRATION ==========

/**
 * Get calibration for address
 */
export async function getConfidenceCalibration(
  subjectType: 'decision' | 'strategy' | 'signal',
  subjectId: string
) {
  return calibrationRepo.getCalibration(subjectType, subjectId);
}

/**
 * Get calibrated confidence value
 */
export async function getCalibratedConfidence(
  subjectType: 'decision' | 'strategy' | 'signal',
  subjectId: string,
  rawConfidence: number
): Promise<number> {
  const calibration = await calibrationRepo.getCalibration(subjectType, subjectId);
  
  if (!calibration) return rawConfidence;
  
  // Apply calibration factor
  let calibrated = rawConfidence * calibration.calibrationFactor;
  
  // Clamp to [0, 1]
  calibrated = Math.max(0, Math.min(1, calibrated));
  
  return calibrated;
}

/**
 * Process simulation outcome for calibration
 */
export async function processSimulationForCalibration(
  simulationId: string
): Promise<boolean> {
  const simulation = await SimulationModel.findById(simulationId).lean();
  if (!simulation || simulation.status !== 'completed') return false;
  
  // Get the source decision
  const decision = await DecisionModel.findById(simulation.decisionId).lean();
  if (!decision) return false;
  
  const wasCorrect = simulation.performance.outcome === 'positive';
  const predictedConfidence = decision.confidence;
  
  // Update calibration for this decision type
  await calibrationRepo.addPredictionOutcome(
    'decision',
    decision.decisionType,
    predictedConfidence,
    wasCorrect
  );
  
  return true;
}

/**
 * Recalibrate all decision types
 */
export async function recalibrateAllDecisionTypes(): Promise<number> {
  const decisionTypes = ['follow', 'copy', 'watch', 'ignore', 'reduce_exposure', 'increase_exposure'];
  let updated = 0;
  
  for (const type of decisionTypes) {
    await calibrationRepo.recalculateCalibration('decision', type);
    updated++;
  }
  
  return updated;
}

// ========== STRATEGY RELIABILITY ==========

/**
 * Get strategy reliability
 */
export async function getStrategyReliability(strategyType: string) {
  return reliabilityRepo.getReliability(strategyType);
}

/**
 * Get all strategy reliabilities
 */
export async function getAllStrategyReliabilities() {
  return reliabilityRepo.getAllReliability();
}

/**
 * Process simulation for strategy reliability
 */
export async function processSimulationForReliability(
  simulationId: string
): Promise<boolean> {
  const simulation = await SimulationModel.findById(simulationId).lean();
  if (!simulation || simulation.status !== 'completed') return false;
  
  // Get the source decision
  const decision = await DecisionModel.findById(simulation.decisionId).lean();
  if (!decision || !decision.context.strategyType) return false;
  
  const strategyType = decision.context.strategyType;
  const outcome = simulation.performance.outcome as 'positive' | 'negative' | 'neutral';
  
  await reliabilityRepo.recordOutcome(
    strategyType,
    outcome,
    decision.confidence
  );
  
  return true;
}

/**
 * Recalculate all strategy reliabilities
 */
export async function recalculateAllStrategyReliabilities(): Promise<number> {
  const strategies = await reliabilityRepo.getAllReliability();
  let updated = 0;
  
  for (const strategy of strategies) {
    await reliabilityRepo.recalculateReliability(strategy.strategyType);
    updated++;
  }
  
  return updated;
}

// ========== EXPLANATION ==========

/**
 * Get adaptive explanation for address
 * Explains how adaptive system affects this address
 */
export async function getAdaptiveExplanation(address: string): Promise<{
  weightsApplied: Record<string, { base: number; current: number; drift: string }>;
  confidenceCalibration: { factor: number; trend: string } | null;
  strategyReliability: { score: number; trend: string; warnings: string[] } | null;
  recommendations: string[];
}> {
  const addr = address.toLowerCase();
  
  // Get global weights
  const weights = await weightsRepo.getGlobalWeights();
  const weightsApplied: Record<string, { base: number; current: number; drift: string }> = {};
  
  for (const w of weights) {
    weightsApplied[w.key] = {
      base: w.baseWeight,
      current: w.currentWeight,
      drift: w.driftDirection,
    };
  }
  
  // Try to find strategy-specific info
  const decision = await DecisionModel.findOne({
    scope: 'actor',
    refId: addr,
  }).sort({ createdAt: -1 }).lean();
  
  let confidenceCalibration = null;
  let strategyReliability = null;
  
  if (decision) {
    // Get calibration for this decision type
    const cal = await calibrationRepo.getCalibration('decision', decision.decisionType);
    if (cal) {
      confidenceCalibration = {
        factor: cal.calibrationFactor,
        trend: cal.trend,
      };
    }
    
    // Get strategy reliability if available
    if (decision.context.strategyType) {
      const rel = await reliabilityRepo.getReliability(decision.context.strategyType);
      if (rel) {
        strategyReliability = {
          score: rel.reliabilityScore,
          trend: rel.trend,
          warnings: rel.warningFlags,
        };
      }
    }
  }
  
  // Generate recommendations
  const recommendations: string[] = [];
  
  const highDrift = weights.filter(w => Math.abs(w.driftFromBase) > 0.05);
  if (highDrift.length > 0) {
    recommendations.push(
      `Weights have adapted: ${highDrift.map(w => w.key).join(', ')}`
    );
  }
  
  if (confidenceCalibration && confidenceCalibration.factor < 0.9) {
    recommendations.push(
      'System is overconfident for this decision type - consider adjusting expectations'
    );
  }
  
  if (strategyReliability && strategyReliability.warnings.length > 0) {
    recommendations.push(
      `Strategy warnings: ${strategyReliability.warnings.join(', ')}`
    );
  }
  
  return {
    weightsApplied,
    confidenceCalibration,
    strategyReliability,
    recommendations,
  };
}

// ========== RECOMPUTE ==========

/**
 * Force full recompute of adaptive system
 */
export async function forceRecompute(): Promise<{
  weightsUpdated: number;
  calibrationsUpdated: number;
  reliabilitiesUpdated: number;
  duration: number;
}> {
  const start = Date.now();
  
  // Process recent feedback for weights
  const recentFeedback = await FeedbackModel
    .find({ createdAt: { $gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } })
    .lean();
  
  let weightsUpdated = 0;
  for (const fb of recentFeedback) {
    const result = await processFeedbackForWeights(fb._id.toString());
    weightsUpdated += result.adjusted.length;
  }
  
  // Process recent simulations for calibration
  const recentSimulations = await SimulationModel
    .find({ 
      status: 'completed',
      updatedAt: { $gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    })
    .lean();
  
  for (const sim of recentSimulations) {
    await processSimulationForCalibration(sim._id.toString());
    await processSimulationForReliability(sim._id.toString());
  }
  
  // Recalibrate all
  const calibrationsUpdated = await recalibrateAllDecisionTypes();
  
  // Recalculate all reliabilities
  const reliabilitiesUpdated = await recalculateAllStrategyReliabilities();
  
  return {
    weightsUpdated,
    calibrationsUpdated,
    reliabilitiesUpdated,
    duration: Date.now() - start,
  };
}

// ========== STATS ==========

/**
 * Get combined adaptive stats
 */
export async function getAdaptiveStats() {
  const [weightsStats, calibrationStats, reliabilityStats] = await Promise.all([
    weightsRepo.getWeightsStats(),
    calibrationRepo.getCalibrationStats(),
    reliabilityRepo.getReliabilityStats(),
  ]);
  
  return {
    adaptiveVersion: ADAPTIVE_VERSION,
    weights: weightsStats,
    calibration: calibrationStats,
    reliability: reliabilityStats,
    config: {
      learningRate: env.ADAPTIVE_LEARNING_RATE,
      learningRateMin: env.ADAPTIVE_LEARNING_RATE_MIN,
      learningRateMax: env.ADAPTIVE_LEARNING_RATE_MAX,
      weightCorridor: env.ADAPTIVE_WEIGHT_CORRIDOR,
      cumulativeDriftCap: env.ADAPTIVE_CUMULATIVE_DRIFT_CAP,
      confidenceFloor: env.CONFIDENCE_FLOOR,
      confidenceSmoothingFactor: env.CONFIDENCE_SMOOTHING_FACTOR,
      legacyPythonEnabled: env.LEGACY_PYTHON_ENABLED,
    },
  };
}
