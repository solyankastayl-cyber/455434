/**
 * Model Evaluator Service (ETAP 5.4)
 * 
 * Computes metrics on eval set.
 * 
 * CRITICAL:
 * - ONLY computes facts, NO decisions
 * - Compares vs rules baseline and active model
 * - Deterministic metrics calculation
 * - NO promotion logic
 */
import axios from 'axios';
import { MLModelVersionModel } from './ml_model_version.model.js';
import { 
  ModelEvaluationReportModel,
  generateEvaluationId,
} from './model_evaluation_report.model.js';
import { loadTrainingDataset } from './training_dataset.service.js';
import { logSelfLearningEvent } from './audit_helpers.js';
import { env } from '../../config/env.js';

export interface EvaluationMetrics {
  samples: number;
  
  // Classification metrics
  precision: number;
  recall: number;
  f1: number;
  
  // Ranking metrics (primary for imbalanced classes)
  prAuc: number;
  rocAuc?: number;
  
  // Error rates
  falsePositiveRate: number;
  falseNegativeRate: number;
  
  // Calibration
  calibrationError: number; // ECE or Brier
  avgConfidence: number;
  
  // Lift
  liftVsRules: number;
  liftVsActive?: number;
  
  // Coverage
  coverage: number; // % of predictions above threshold
}

export interface EvaluateModelRequest {
  modelId: string;
  evaluatedBy?: 'scheduler' | 'manual';
}

export interface EvaluateModelResult {
  success: boolean;
  evaluationId?: string;
  report?: any;
  error?: string;
  duration: number;
}

/**
 * Evaluate candidate model
 * 
 * Computes metrics on eval set and compares to baselines.
 * Does NOT make promotion decisions.
 */
export async function evaluateModel(request: EvaluateModelRequest): Promise<EvaluateModelResult> {
  const start = Date.now();
  const { modelId, evaluatedBy = 'scheduler' } = request;
  
  console.log(`[Model Evaluator] ========== EVALUATION START ==========`);
  console.log(`[Model Evaluator] Model: ${modelId}`);
  
  try {
    // ========== STEP 1: LOAD MODEL ==========
    console.log(`[Model Evaluator] Step 1: Loading model...`);
    
    const model = await MLModelVersionModel.findOne({ modelId }).lean();
    
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }
    
    if (model.status !== 'CANDIDATE') {
      throw new Error(`Model ${modelId} is not CANDIDATE (status: ${model.status})`);
    }
    
    const horizon = model.horizon;
    
    console.log(`[Model Evaluator] Model loaded: ${horizon} horizon, ${model.featureCount} features`);
    
    // ========== STEP 2: LOAD EVAL DATASET ==========
    console.log(`[Model Evaluator] Step 2: Loading eval dataset...`);
    
    const dataset = await loadTrainingDataset(model.datasetVersionId);
    
    console.log(`[Model Evaluator] Eval dataset: ${dataset.eval.sampleCount} samples`);
    
    // ========== LOG EVAL START ==========
    const evaluationId = generateEvaluationId(modelId);
    
    await logSelfLearningEvent({
      eventType: 'EVAL_STARTED',
      horizon,
      datasetVersionId: model.datasetVersionId,
      modelVersionId: modelId,
      evalReportId: evaluationId,
      details: {
        evalSamples: dataset.eval.sampleCount,
      },
      triggeredBy: evaluatedBy,
      severity: 'info',
    });
    
    // ========== STEP 3: CALL PYTHON ML SERVICE FOR METRICS ==========
    console.log(`[Model Evaluator] Step 3: Computing metrics via ML service...`);
    
    const mlServiceUrl = env.ML_SERVICE_URL || 'http://localhost:8003';
    const evalEndpoint = `${mlServiceUrl}/evaluate-etap5`;
    
    let evalResponse;
    try {
      const response = await axios.post(evalEndpoint, {
        model_id: modelId,
        artifact_path: model.artifact.path,
        X_eval: dataset.eval.X,
        y_eval: dataset.eval.y,
        feature_names: dataset.metadata.featureNames,
        horizon,
      }, {
        timeout: 120000, // 2 min
        headers: { 'Content-Type': 'application/json' },
      });
      
      evalResponse = response.data;
      console.log(`[Model Evaluator] Metrics computed`);
      
    } catch (apiError: any) {
      console.error(`[Model Evaluator] ML service error:`, apiError.message);
      
      await logSelfLearningEvent({
        eventType: 'EVAL_FAILED',
        horizon,
        modelVersionId: modelId,
        evalReportId: evaluationId,
        details: {
          error: apiError.message,
        },
        triggeredBy: evaluatedBy,
        severity: 'error',
      });
      
      throw new Error(`ML service evaluation failed: ${apiError.message}`);
    }
    
    // ========== STEP 4: NORMALIZE METRICS ==========
    const candidateMetrics: EvaluationMetrics = {
      samples: dataset.eval.sampleCount,
      precision: evalResponse.metrics?.precision || 0,
      recall: evalResponse.metrics?.recall || 0,
      f1: evalResponse.metrics?.f1 || 0,
      prAuc: evalResponse.metrics?.pr_auc || 0,
      rocAuc: evalResponse.metrics?.roc_auc,
      falsePositiveRate: evalResponse.metrics?.fp_rate || 0,
      falseNegativeRate: evalResponse.metrics?.fn_rate || 0,
      calibrationError: evalResponse.metrics?.calibration_error || 0,
      avgConfidence: evalResponse.metrics?.avg_confidence || 0,
      liftVsRules: 0, // Computed below
      coverage: evalResponse.metrics?.coverage || 0,
    };
    
    console.log(`[Model Evaluator] Candidate metrics:`);
    console.log(`  Precision: ${candidateMetrics.precision.toFixed(3)}`);
    console.log(`  PR-AUC: ${candidateMetrics.prAuc.toFixed(3)}`);
    console.log(`  FP rate: ${candidateMetrics.falsePositiveRate.toFixed(3)}`);
    console.log(`  Calibration: ${candidateMetrics.calibrationError.toFixed(3)}`);
    
    // ========== STEP 5: GET RULES BASELINE ==========
    console.log(`[Model Evaluator] Step 5: Computing rules baseline...`);
    
    // Rules baseline: simple heuristic based on composite score threshold
    const rulesMetrics = computeRulesBaseline(dataset.eval);
    
    console.log(`[Model Evaluator] Rules baseline:`);
    console.log(`  Precision: ${rulesMetrics.precision.toFixed(3)}`);
    console.log(`  PR-AUC: ${rulesMetrics.prAuc.toFixed(3)}`);
    
    // ========== STEP 6: GET ACTIVE MODEL METRICS (if exists) ==========
    console.log(`[Model Evaluator] Step 6: Checking active model...`);
    
    const activeModel = await MLModelVersionModel
      .findOne({ horizon, status: 'ACTIVE' })
      .lean();
    
    let activeModelMetrics: EvaluationMetrics | undefined;
    
    if (activeModel && activeModel.evalMetrics) {
      activeModelMetrics = activeModel.evalMetrics as EvaluationMetrics;
      console.log(`[Model Evaluator] Active model found: ${activeModel.modelId}`);
    } else {
      console.log(`[Model Evaluator] No active model`);
    }
    
    // ========== STEP 7: COMPUTE LIFTS ==========
    candidateMetrics.liftVsRules = rulesMetrics.precision > 0
      ? candidateMetrics.precision / rulesMetrics.precision
      : 0;
    
    if (activeModelMetrics) {
      candidateMetrics.liftVsActive = activeModelMetrics.precision > 0
        ? candidateMetrics.precision / activeModelMetrics.precision
        : undefined;
    }
    
    // ========== STEP 8: COMPUTE DELTAS ==========
    const vsRules = {
      precision: candidateMetrics.precision - rulesMetrics.precision,
      prAuc: candidateMetrics.prAuc - rulesMetrics.prAuc,
      fpRate: candidateMetrics.falsePositiveRate - rulesMetrics.falsePositiveRate,
      calibrationError: candidateMetrics.calibrationError - rulesMetrics.calibrationError,
    };
    
    const vsActiveModel = activeModelMetrics ? {
      precision: candidateMetrics.precision - activeModelMetrics.precision,
      prAuc: candidateMetrics.prAuc - activeModelMetrics.prAuc,
      fpRate: candidateMetrics.falsePositiveRate - activeModelMetrics.falsePositiveRate,
      calibrationError: candidateMetrics.calibrationError - activeModelMetrics.calibrationError,
    } : undefined;
    
    console.log(`[Model Evaluator] Deltas vs rules:`);
    console.log(`  Precision: ${vsRules.precision >= 0 ? '+' : ''}${vsRules.precision.toFixed(3)}`);
    console.log(`  PR-AUC: ${vsRules.prAuc >= 0 ? '+' : ''}${vsRules.prAuc.toFixed(3)}`);
    console.log(`  FP rate: ${vsRules.fpRate >= 0 ? '+' : ''}${vsRules.fpRate.toFixed(3)}`);
    
    // ========== STEP 9: CREATE EVALUATION REPORT ==========
    console.log(`[Model Evaluator] Step 9: Creating evaluation report...`);
    
    const report = await ModelEvaluationReportModel.create({
      evaluationId,
      candidateModelId: modelId,
      horizon,
      
      // Baselines
      rulesBaselineId: 'rules_engine_v1',
      activeModelId: activeModel?.modelId,
      
      // Dataset
      datasetVersionId: model.datasetVersionId,
      evalSampleCount: dataset.eval.sampleCount,
      
      // Decision (INCONCLUSIVE - gate will decide)
      decision: 'INCONCLUSIVE',
      reasons: ['Awaiting gate decision'],
      
      // Metrics
      candidateMetrics,
      rulesMetrics,
      activeModelMetrics,
      
      // Deltas
      vsRules,
      vsActiveModel,
      
      // Thresholds snapshot (from evaluation_rules.ts)
      thresholdsSnapshot: {}, // TODO: Import from evaluation_rules.ts
      
      // Metadata
      evaluatedAt: new Date(),
      evaluatedBy,
    });
    
    console.log(`[Model Evaluator] Evaluation report created: ${evaluationId}`);
    
    // Update model with eval metrics
    await MLModelVersionModel.updateOne(
      { modelId },
      {
        $set: {
          evalMetrics: candidateMetrics,
          evaluationReportId: evaluationId,
        },
      }
    );
    
    const duration = Date.now() - start;
    console.log(`[Model Evaluator] ========== EVALUATION COMPLETE (${duration}ms) ==========`);
    
    return {
      success: true,
      evaluationId,
      report,
      duration,
    };
    
  } catch (error: any) {
    console.error(`[Model Evaluator] Evaluation failed:`, error);
    
    const duration = Date.now() - start;
    
    await logSelfLearningEvent({
      eventType: 'EVAL_FAILED',
      modelVersionId: modelId,
      details: {
        error: error.message,
        duration,
      },
      triggeredBy: evaluatedBy,
      severity: 'error',
    });
    
    return {
      success: false,
      error: error.message,
      duration,
    };
  }
}

/**
 * Compute rules baseline metrics
 * 
 * Rules baseline: Simple heuristic based on composite score threshold
 * This represents ETAP 1 engine without ML
 */
function computeRulesBaseline(evalData: any): Omit<EvaluationMetrics, 'liftVsRules' | 'liftVsActive'> {
  // Simple heuristic: BUY if composite_score > 0.70 (from bucket assignment)
  const buyThreshold = 0.70;
  
  let tp = 0, fp = 0, fn = 0, tn = 0;
  let totalConfidence = 0;
  let predictedPositive = 0;
  
  for (let i = 0; i < evalData.X.length; i++) {
    const features = evalData.X[i];
    const trueLabel = evalData.y[i];
    
    // Extract composite_score (assume it's first feature or find by name)
    const compositeScore = features[0]; // Simplified
    
    const predicted = compositeScore >= buyThreshold ? 1 : 0;
    
    if (predicted === 1) predictedPositive++;
    
    if (predicted === 1 && trueLabel === 1) tp++;
    else if (predicted === 1 && trueLabel === 0) fp++;
    else if (predicted === 0 && trueLabel === 1) fn++;
    else if (predicted === 0 && trueLabel === 0) tn++;
    
    // Simple confidence = distance from threshold
    const confidence = Math.abs(compositeScore - buyThreshold) + 0.5;
    totalConfidence += Math.min(confidence, 1.0);
  }
  
  const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
  const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
  const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  
  const fpRate = (fp + tn) > 0 ? fp / (fp + tn) : 0;
  const fnRate = (fn + tp) > 0 ? fn / (fn + tp) : 0;
  
  // Simplified PR-AUC (would need proper calculation with varying thresholds)
  const prAuc = precision * recall; // Simplified approximation
  
  const avgConfidence = evalData.X.length > 0 ? totalConfidence / evalData.X.length : 0;
  const coverage = evalData.X.length > 0 ? predictedPositive / evalData.X.length : 0;
  
  return {
    samples: evalData.X.length,
    precision,
    recall,
    f1,
    prAuc,
    falsePositiveRate: fpRate,
    falseNegativeRate: fnRate,
    calibrationError: 0.05, // Baseline calibration
    avgConfidence,
    coverage,
  };
}

/**
 * Get evaluation report by ID
 */
export async function getEvaluationReport(evaluationId: string) {
  return ModelEvaluationReportModel
    .findOne({ evaluationId })
    .lean();
}

/**
 * Get latest evaluation for model
 */
export async function getLatestEvaluationForModel(modelId: string) {
  return ModelEvaluationReportModel
    .findOne({ candidateModelId: modelId })
    .sort({ evaluatedAt: -1 })
    .lean();
}
