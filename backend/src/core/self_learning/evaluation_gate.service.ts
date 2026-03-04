/**
 * Evaluation Gate Service
 * 
 * ETAP 5.4: CRITICAL - Automatic PROMOTE / HOLD / REJECT decisions.
 * 
 * Key principle: Model cannot be promoted without proven improvement.
 * 
 * This is the most important safety gate in the self-learning loop.
 */
import { ModelVersionModel, type IModelVersion } from './model_version.model.js';
import { getActiveModel } from './model_registry.service.js';
import { applyPolicy, DEFAULT_POLICY, type EvaluationPolicy, type EvaluationDecision, type PolicyEvaluationResult } from './evaluation_policy.js';
import { diffMetrics } from './metric_diff.util.js';
import { getEvaluation as getShadowEvaluation } from '../learning/shadow_ml/shadow_ml.client.js';
import type { Horizon } from './self_learning.types.js';

// ==================== TYPES ====================

export interface EvaluationResult {
  modelVersionId: string;
  decision: EvaluationDecision;
  deltas: Record<string, number>;
  reasons: string[];
  
  // Full details
  candidateMetrics: Record<string, number>;
  baselineMetrics: Record<string, number>;
  baselineSource: 'active_model' | 'rules' | 'none';
  baselineModelId?: string;
  
  // Policy result
  policyResult: PolicyEvaluationResult;
  
  // Timestamps
  evaluatedAt: Date;
}

// ==================== MAIN EVALUATION ====================

/**
 * Evaluate model against baseline
 * 
 * Comparison is ONLY against active model (or rules baseline if no active model).
 */
export async function evaluateModel(
  modelVersionId: string,
  policy: EvaluationPolicy = DEFAULT_POLICY
): Promise<EvaluationResult> {
  console.log(`[EvaluationGate] Evaluating model ${modelVersionId}`);
  
  // Step 1: Get candidate model
  const candidate = await ModelVersionModel.findOne({ modelVersion: modelVersionId });
  
  if (!candidate) {
    throw new Error(`Model not found: ${modelVersionId}`);
  }
  
  if (candidate.status === 'REJECTED') {
    throw new Error(`Cannot evaluate rejected model: ${modelVersionId}`);
  }
  
  if (candidate.status === 'PROMOTED') {
    throw new Error(`Model already promoted: ${modelVersionId}`);
  }
  
  const horizon = candidate.horizon as Horizon;
  
  // Step 2: Get baseline (active model or rules)
  const activeModel = await getActiveModel(horizon);
  
  let baselineMetrics: Record<string, number>;
  let baselineSource: 'active_model' | 'rules' | 'none';
  let baselineModelId: string | undefined;
  
  if (activeModel) {
    baselineMetrics = activeModel.trainingMetrics as Record<string, number>;
    baselineSource = 'active_model';
    baselineModelId = activeModel.modelVersion;
    console.log(`[EvaluationGate] Comparing against active model: ${activeModel.modelVersion}`);
  } else {
    // No active model - use rules baseline from ML service
    try {
      const evalResult = await getShadowEvaluation(horizon);
      if (evalResult.ok && evalResult.comparison) {
        baselineMetrics = {
          precision: evalResult.comparison.rules_precision || 0,
          f1: evalResult.comparison.rules_f1 || 0,
          lift: 0, // Rules is baseline, lift is 0
          ece: 1.0, // Assume poor calibration for rules
          falseBuyRate: 1 - (evalResult.comparison.rules_precision || 0),
        };
      } else {
        baselineMetrics = { precision: 0, f1: 0, lift: 0, ece: 1.0, falseBuyRate: 1.0 };
      }
    } catch {
      baselineMetrics = { precision: 0, f1: 0, lift: 0, ece: 1.0, falseBuyRate: 1.0 };
    }
    baselineSource = 'rules';
    console.log(`[EvaluationGate] No active model, comparing against rules baseline`);
  }
  
  // Step 3: Get candidate metrics
  const rawMetrics = candidate.trainingMetrics?.toObject?.() || candidate.trainingMetrics || {};
  const candidateMetrics: Record<string, number> = {
    precision: rawMetrics.precision || 0,
    recall: rawMetrics.recall || 0,
    f1: rawMetrics.f1 || 0,
    prAuc: rawMetrics.prAuc || 0,
    logLoss: rawMetrics.logLoss || 0,
    brierScore: rawMetrics.brierScore || 0,
  };
  
  // Fetch fresh evaluation from ML service
  try {
    const evalResult = await getShadowEvaluation(horizon);
    if (evalResult.ok && evalResult.metrics) {
      candidateMetrics.ece = evalResult.metrics.ece || 0;
      candidateMetrics.lift = evalResult.comparison?.precision_lift || 0;
      candidateMetrics.falseBuyRate = 1 - candidateMetrics.precision;
    }
  } catch (error) {
    console.log(`[EvaluationGate] Could not fetch ML metrics, using training metrics only`);
    candidateMetrics.ece = 0;
    candidateMetrics.lift = 0;
    candidateMetrics.falseBuyRate = 1 - candidateMetrics.precision;
  }
  
  // Step 4: Apply policy
  const sampleCount = candidate.trainingMetrics?.sampleCount || 0;
  const policyResult = applyPolicy(candidateMetrics, baselineMetrics, policy, sampleCount);
  
  // Step 5: Update model with evaluation results
  await ModelVersionModel.updateOne(
    { modelVersion: modelVersionId },
    {
      status: policyResult.decision === 'REJECT' ? 'REJECTED' : 'EVALUATING',
      evaluationMetrics: candidateMetrics,
      evaluationDecision: policyResult.decision,
      evaluationReasons: policyResult.reasons,
      evaluatedAt: new Date(),
      ...(policyResult.decision === 'REJECT' && {
        rejectedAt: new Date(),
        rejectionReason: policyResult.reasons.join('; '),
      }),
    }
  );
  
  console.log(`[EvaluationGate] Decision: ${policyResult.decision} - ${policyResult.reasons.join(', ')}`);
  
  return {
    modelVersionId,
    decision: policyResult.decision,
    deltas: policyResult.deltas,
    reasons: policyResult.reasons,
    candidateMetrics,
    baselineMetrics,
    baselineSource,
    baselineModelId,
    policyResult,
    evaluatedAt: new Date(),
  };
}

/**
 * Get evaluation for model (if already evaluated)
 */
export async function getEvaluation(modelVersionId: string): Promise<{
  evaluated: boolean;
  decision: EvaluationDecision | null;
  reasons: string[];
  metrics: Record<string, number> | null;
  evaluatedAt: Date | null;
} | null> {
  const model = await ModelVersionModel.findOne({ modelVersion: modelVersionId }).lean();
  
  if (!model) {
    return null;
  }
  
  return {
    evaluated: model.evaluatedAt !== null,
    decision: model.evaluationDecision as EvaluationDecision | null,
    reasons: model.evaluationReasons || [],
    metrics: model.evaluationMetrics as Record<string, number> | null,
    evaluatedAt: model.evaluatedAt || null,
  };
}

/**
 * Re-evaluate model (force refresh)
 */
export async function reEvaluateModel(
  modelVersionId: string,
  policy: EvaluationPolicy = DEFAULT_POLICY
): Promise<EvaluationResult> {
  // Clear previous evaluation
  await ModelVersionModel.updateOne(
    { modelVersion: modelVersionId },
    {
      status: 'TRAINED',
      evaluationMetrics: null,
      evaluationDecision: null,
      evaluationReasons: [],
      evaluatedAt: null,
    }
  );
  
  return evaluateModel(modelVersionId, policy);
}

/**
 * Batch evaluate all TRAINED models for horizon
 */
export async function evaluateAllPending(horizon: Horizon): Promise<EvaluationResult[]> {
  const pendingModels = await ModelVersionModel.find({
    horizon,
    status: 'TRAINED',
  }).lean();
  
  const results: EvaluationResult[] = [];
  
  for (const model of pendingModels) {
    try {
      const result = await evaluateModel(model.modelVersion);
      results.push(result);
    } catch (error: any) {
      console.error(`[EvaluationGate] Failed to evaluate ${model.modelVersion}:`, error.message);
    }
  }
  
  return results;
}
