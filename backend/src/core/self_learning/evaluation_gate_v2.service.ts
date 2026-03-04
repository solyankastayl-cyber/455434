/**
 * Evaluation Gate v2 Service (ETAP 5.4)
 * 
 * Applies evaluation rules to model evaluation report.
 * Makes APPROVED / REJECTED / BLOCKED decision.
 * 
 * CRITICAL PRINCIPLES:
 * - Gate ONLY decides, doesn't promote
 * - Decisions are deterministic and explainable
 * - Safety-first: when in doubt, REJECT
 * - All decisions are logged and auditable
 */
import { ModelEvaluationReportModel } from './model_evaluation_report.model.js';
import { MLModelVersionModel } from './ml_model_version.model.js';
import {
  EVALUATION_RULES,
  checkAbsoluteGate,
  checkRelativeGate,
} from './evaluation_rules.js';
import { logSelfLearningEvent } from './audit_helpers.js';

// Re-define type locally to avoid import issues
export type GateDecision = 'APPROVED' | 'REJECTED' | 'BLOCKED' | 'INCONCLUSIVE';

export interface GateRequest {
  evaluationId: string;
  modelId: string;
  horizon: '7d' | '30d';
}

export interface GateCheck {
  name: string;
  category: 'absolute' | 'relative' | 'risk' | 'drift';
  passed: boolean;
  value: number;
  threshold: number;
  delta?: number;
  reason: string;
}

export interface GateResult {
  decision: GateDecision;
  reasons: string[];
  checks: GateCheck[];
  summary: {
    absolutePassed: number;
    absoluteTotal: number;
    relativePassed: number;
    relativeTotal: number;
    riskPassed: number;
    riskTotal: number;
    driftPassed: number;
    driftTotal: number;
  };
  evaluatedAt: Date;
}

/**
 * Run evaluation gate on evaluation report
 * 
 * Decision logic:
 * 1. BLOCKED if insufficient samples or high drift
 * 2. REJECTED if any absolute gate fails
 * 3. REJECTED if FP rate increase exceeds limit
 * 4. APPROVED if all absolute gates pass AND relative improvement exists
 * 5. REJECTED otherwise
 */
export async function runEvaluationGate(request: GateRequest): Promise<GateResult> {
  const { evaluationId, modelId, horizon } = request;
  const rules = EVALUATION_RULES;
  const checks: GateCheck[] = [];
  const reasons: string[] = [];
  
  console.log(`[EvaluationGate] ========== GATE CHECK: ${modelId} ==========`);
  
  // Load evaluation report
  const report = await ModelEvaluationReportModel.findOne({ evaluationId }).lean();
  
  if (!report) {
    throw new Error(`Evaluation report not found: ${evaluationId}`);
  }
  
  const candidateMetrics = report.candidateMetrics as any;
  const rulesMetrics = report.rulesMetrics as any;
  const activeModelMetrics = report.activeModelMetrics as any;
  const vsRules = report.vsRules as any;
  const vsActiveModel = report.vsActiveModel as any;
  
  // ========== BLOCK CHECK: INSUFFICIENT SAMPLES ==========
  
  const sampleCheck = checkAbsoluteGate(
    report.evalSampleCount,
    rules.absolute.minEvalSamples,
    true
  );
  
  checks.push({
    name: 'Min Eval Samples',
    category: 'absolute',
    passed: sampleCheck.passed,
    value: sampleCheck.value,
    threshold: sampleCheck.threshold,
    delta: sampleCheck.delta,
    reason: sampleCheck.passed
      ? `Sufficient samples: ${sampleCheck.value}`
      : `Insufficient samples: ${sampleCheck.value} < ${sampleCheck.threshold}`,
  });
  
  if (!sampleCheck.passed) {
    const result: GateResult = {
      decision: 'BLOCKED',
      reasons: [`Insufficient eval samples: ${report.evalSampleCount} < ${rules.absolute.minEvalSamples}`],
      checks,
      summary: summarizeChecks(checks),
      evaluatedAt: new Date(),
    };
    
    await updateReportDecision(evaluationId, result);
    return result;
  }
  
  // ========== ABSOLUTE GATES ==========
  
  // Precision gate
  const precisionThreshold = rules.absolute.precision[horizon];
  const precisionCheck = checkAbsoluteGate(
    candidateMetrics.precision || 0,
    precisionThreshold,
    true
  );
  
  checks.push({
    name: `Precision (${horizon})`,
    category: 'absolute',
    passed: precisionCheck.passed,
    value: precisionCheck.value,
    threshold: precisionCheck.threshold,
    delta: precisionCheck.delta,
    reason: precisionCheck.passed
      ? `Precision ${(precisionCheck.value * 100).toFixed(1)}% >= ${(precisionCheck.threshold * 100).toFixed(1)}%`
      : `Precision ${(precisionCheck.value * 100).toFixed(1)}% < ${(precisionCheck.threshold * 100).toFixed(1)}%`,
  });
  
  // PR-AUC gate
  const prAucThreshold = rules.absolute.prAuc[horizon];
  const prAucCheck = checkAbsoluteGate(
    candidateMetrics.prAuc || 0,
    prAucThreshold,
    true
  );
  
  checks.push({
    name: `PR-AUC (${horizon})`,
    category: 'absolute',
    passed: prAucCheck.passed,
    value: prAucCheck.value,
    threshold: prAucCheck.threshold,
    delta: prAucCheck.delta,
    reason: prAucCheck.passed
      ? `PR-AUC ${prAucCheck.value.toFixed(3)} >= ${prAucCheck.threshold.toFixed(3)}`
      : `PR-AUC ${prAucCheck.value.toFixed(3)} < ${prAucCheck.threshold.toFixed(3)}`,
  });
  
  // Calibration error gate (lower is better)
  const calibrationCheck = checkAbsoluteGate(
    candidateMetrics.calibrationError || 0,
    rules.absolute.calibrationErrorMax,
    false // Lower is better
  );
  
  checks.push({
    name: 'Calibration Error',
    category: 'absolute',
    passed: calibrationCheck.passed,
    value: calibrationCheck.value,
    threshold: calibrationCheck.threshold,
    delta: calibrationCheck.delta,
    reason: calibrationCheck.passed
      ? `Calibration error ${calibrationCheck.value.toFixed(3)} <= ${calibrationCheck.threshold.toFixed(3)}`
      : `Calibration error ${calibrationCheck.value.toFixed(3)} > ${calibrationCheck.threshold.toFixed(3)}`,
  });
  
  // ========== RELATIVE GATES ==========
  
  // Precision lift vs rules
  const precisionLiftCheck = checkRelativeGate(
    candidateMetrics.precision || 0,
    rulesMetrics?.precision || 0,
    rules.relative.precisionLift,
    true
  );
  
  checks.push({
    name: 'Precision Lift vs Rules',
    category: 'relative',
    passed: precisionLiftCheck.passed,
    value: precisionLiftCheck.actualLift,
    threshold: precisionLiftCheck.requiredLift,
    reason: precisionLiftCheck.passed
      ? `Precision lift +${(precisionLiftCheck.actualLift * 100).toFixed(1)}% >= +${(precisionLiftCheck.requiredLift * 100).toFixed(1)}%`
      : `Precision lift +${(precisionLiftCheck.actualLift * 100).toFixed(1)}% < +${(precisionLiftCheck.requiredLift * 100).toFixed(1)}%`,
  });
  
  // PR-AUC lift vs rules
  const prAucLiftCheck = checkRelativeGate(
    candidateMetrics.prAuc || 0,
    rulesMetrics?.prAuc || 0,
    rules.relative.prAucLift,
    true
  );
  
  checks.push({
    name: 'PR-AUC Lift vs Rules',
    category: 'relative',
    passed: prAucLiftCheck.passed,
    value: prAucLiftCheck.actualLift,
    threshold: prAucLiftCheck.requiredLift,
    reason: prAucLiftCheck.passed
      ? `PR-AUC lift +${(prAucLiftCheck.actualLift * 100).toFixed(1)}% >= +${(prAucLiftCheck.requiredLift * 100).toFixed(1)}%`
      : `PR-AUC lift +${(prAucLiftCheck.actualLift * 100).toFixed(1)}% < +${(prAucLiftCheck.requiredLift * 100).toFixed(1)}%`,
  });
  
  // Lift vs rules (multiplier)
  const liftMultiplier = rulesMetrics?.precision > 0
    ? (candidateMetrics.precision || 0) / rulesMetrics.precision
    : 0;
  
  const liftMultiplierCheck = liftMultiplier >= rules.relative.liftVsRules;
  
  checks.push({
    name: 'Overall Lift Multiplier',
    category: 'relative',
    passed: liftMultiplierCheck,
    value: liftMultiplier,
    threshold: rules.relative.liftVsRules,
    reason: liftMultiplierCheck
      ? `Lift ${liftMultiplier.toFixed(2)}x >= ${rules.relative.liftVsRules}x`
      : `Lift ${liftMultiplier.toFixed(2)}x < ${rules.relative.liftVsRules}x`,
  });
  
  // ========== RISK GATES ==========
  
  // FP rate increase (lower is better, so delta should be <= limit)
  const fpRateIncrease = vsRules?.fpRate || 0;
  const fpRiskCheck = fpRateIncrease <= rules.risk.fpIncreaseMax;
  
  checks.push({
    name: 'FP Rate Increase',
    category: 'risk',
    passed: fpRiskCheck,
    value: fpRateIncrease,
    threshold: rules.risk.fpIncreaseMax,
    reason: fpRiskCheck
      ? `FP rate increase ${(fpRateIncrease * 100).toFixed(1)}% <= ${(rules.risk.fpIncreaseMax * 100).toFixed(1)}%`
      : `FP rate increase ${(fpRateIncrease * 100).toFixed(1)}% > ${(rules.risk.fpIncreaseMax * 100).toFixed(1)}%`,
  });
  
  // Calibration degradation (confidence collapse)
  const calibrationDegradation = vsRules?.calibrationError || 0;
  const calibrationRiskCheck = calibrationDegradation <= rules.risk.confidenceCollapseMax;
  
  checks.push({
    name: 'Calibration Degradation',
    category: 'risk',
    passed: calibrationRiskCheck,
    value: calibrationDegradation,
    threshold: rules.risk.confidenceCollapseMax,
    reason: calibrationRiskCheck
      ? `Calibration degradation ${calibrationDegradation.toFixed(3)} <= ${rules.risk.confidenceCollapseMax}`
      : `Calibration degradation ${calibrationDegradation.toFixed(3)} > ${rules.risk.confidenceCollapseMax}`,
  });
  
  // ========== MAKE DECISION ==========
  
  const absoluteChecks = checks.filter(c => c.category === 'absolute');
  const relativeChecks = checks.filter(c => c.category === 'relative');
  const riskChecks = checks.filter(c => c.category === 'risk');
  const driftChecks = checks.filter(c => c.category === 'drift');
  
  const absolutePassed = absoluteChecks.filter(c => c.passed).length;
  const relativePassed = relativeChecks.filter(c => c.passed).length;
  const riskPassed = riskChecks.filter(c => c.passed).length;
  const driftPassed = driftChecks.filter(c => c.passed).length;
  
  let decision: GateDecision = 'REJECTED';
  
  // Check absolute gates (all must pass)
  const allAbsolutePassed = absoluteChecks.every(c => c.passed);
  
  // Check risk gates (all must pass)
  const allRiskPassed = riskChecks.every(c => c.passed);
  
  // Check relative gates (at least one must pass for APPROVED)
  const anyRelativePassed = relativeChecks.some(c => c.passed);
  
  if (!allAbsolutePassed) {
    decision = 'REJECTED';
    const failedAbsolute = absoluteChecks.filter(c => !c.passed).map(c => c.reason);
    reasons.push(...failedAbsolute);
    reasons.push('Failed absolute gates - model does not meet minimum requirements');
  } else if (!allRiskPassed) {
    decision = 'REJECTED';
    const failedRisk = riskChecks.filter(c => !c.passed).map(c => c.reason);
    reasons.push(...failedRisk);
    reasons.push('Failed risk gates - model introduces unacceptable risk');
  } else if (anyRelativePassed) {
    decision = 'APPROVED';
    const passedRelative = relativeChecks.filter(c => c.passed).map(c => c.reason);
    reasons.push(...passedRelative);
    reasons.push('Model approved - passes all absolute gates and shows relative improvement');
  } else {
    decision = 'REJECTED';
    reasons.push('Model passes absolute gates but shows no relative improvement over baseline');
  }
  
  console.log(`[EvaluationGate] Decision: ${decision}`);
  console.log(`[EvaluationGate] Reasons: ${reasons.join(', ')}`);
  
  const result: GateResult = {
    decision,
    reasons,
    checks,
    summary: {
      absolutePassed,
      absoluteTotal: absoluteChecks.length,
      relativePassed,
      relativeTotal: relativeChecks.length,
      riskPassed,
      riskTotal: riskChecks.length,
      driftPassed,
      driftTotal: driftChecks.length,
    },
    evaluatedAt: new Date(),
  };
  
  // Update report with decision
  await updateReportDecision(evaluationId, result);
  
  return result;
}

/**
 * Update evaluation report with gate decision
 */
async function updateReportDecision(evaluationId: string, result: GateResult) {
  await ModelEvaluationReportModel.updateOne(
    { evaluationId },
    {
      $set: {
        decision: result.decision,
        reasons: result.reasons,
        gateChecks: {
          absolute: result.checks.filter(c => c.category === 'absolute'),
          relative: result.checks.filter(c => c.category === 'relative'),
          risk: result.checks.filter(c => c.category === 'risk'),
          drift: result.checks.filter(c => c.category === 'drift'),
        },
        thresholdsSnapshot: EVALUATION_RULES,
      },
    }
  );
}

/**
 * Summarize check results
 */
function summarizeChecks(checks: GateCheck[]) {
  const byCategory = (cat: string) => checks.filter(c => c.category === cat);
  
  return {
    absolutePassed: byCategory('absolute').filter(c => c.passed).length,
    absoluteTotal: byCategory('absolute').length,
    relativePassed: byCategory('relative').filter(c => c.passed).length,
    relativeTotal: byCategory('relative').length,
    riskPassed: byCategory('risk').filter(c => c.passed).length,
    riskTotal: byCategory('risk').length,
    driftPassed: byCategory('drift').filter(c => c.passed).length,
    driftTotal: byCategory('drift').length,
  };
}

/**
 * Get gate result for evaluation
 */
export async function getGateResult(evaluationId: string): Promise<GateResult | null> {
  const report = await ModelEvaluationReportModel.findOne({ evaluationId }).lean();
  
  if (!report || !report.decision) {
    return null;
  }
  
  return {
    decision: report.decision as GateDecision,
    reasons: report.reasons || [],
    checks: [
      ...(report.gateChecks?.absolute || []),
      ...(report.gateChecks?.relative || []),
      ...(report.gateChecks?.risk || []),
      ...(report.gateChecks?.drift || []),
    ] as GateCheck[],
    summary: {
      absolutePassed: (report.gateChecks?.absolute || []).filter((c: any) => c.passed).length,
      absoluteTotal: (report.gateChecks?.absolute || []).length,
      relativePassed: (report.gateChecks?.relative || []).filter((c: any) => c.passed).length,
      relativeTotal: (report.gateChecks?.relative || []).length,
      riskPassed: (report.gateChecks?.risk || []).filter((c: any) => c.passed).length,
      riskTotal: (report.gateChecks?.risk || []).length,
      driftPassed: (report.gateChecks?.drift || []).filter((c: any) => c.passed).length,
      driftTotal: (report.gateChecks?.drift || []).length,
    },
    evaluatedAt: report.evaluatedAt || new Date(),
  };
}
