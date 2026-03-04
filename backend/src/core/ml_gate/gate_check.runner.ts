/**
 * Gate Check Runner
 * 
 * Orchestrates gate check validation:
 * 1. Collects metrics from all collectors
 * 2. Applies rules/thresholds
 * 3. Stores result in MongoDB
 * 4. Updates trainingAllowed flag
 * 5. Logs audit event
 * 
 * Training endpoint MUST check trainingAllowed before proceeding
 */

import { GateCheckModel } from './gate_check.model.js';
import { evaluateSections, buildResult, type CollectedMetrics } from './gate_check.rules.js';
import type { GateCheckOptions, GateCheckResultDTO } from './gate_check.types.js';

// Import collectors (to be implemented)
import { collectDataMetrics } from './gate_check.collectors/data_ready.collector.js';
import { collectLabelsMetrics } from './gate_check.collectors/labels_ready.collector.js';
import { collectNegativeMetrics } from './gate_check.collectors/negative_ready.collector.js';
import { collectTemporalMetrics } from './gate_check.collectors/temporal_ready.collector.js';
import { collectSafetyMetrics } from './gate_check.collectors/safety_ready.collector.js';

/**
 * Run full gate check
 * 
 * @param opts.horizon - '7d' or '30d'
 * @param opts.dryRun - if true, don't persist to DB
 * @param opts.forceRecalc - if true, ignore cache
 */
export async function runGateCheck(opts: GateCheckOptions): Promise<GateCheckResultDTO> {
  const { horizon, dryRun = false } = opts;
  
  console.log(`[GateCheck] Running gate check for horizon=${horizon}, dryRun=${dryRun}`);
  
  // 1. Collect all metrics
  const collected: CollectedMetrics = {
    data: await collectDataMetrics(horizon),
    labels: await collectLabelsMetrics(horizon),
    negative: await collectNegativeMetrics(horizon),
    temporal: await collectTemporalMetrics(horizon),
    safety: await collectSafetyMetrics(horizon),
  };
  
  // 2. Evaluate sections against thresholds
  const sections = evaluateSections(collected);
  
  // 3. Build final result
  const result = buildResult(horizon, sections);
  
  console.log(`[GateCheck] Result: ${result.gate_status}, failed=${result.failed_sections.length}`);
  
  // 4. Persist if not dry run
  if (!dryRun) {
    // Save to history
    await GateCheckModel.create(result);
    
    // Update self-learning config (source of truth for training permission)
    // This should update selfLearningConfig.trainingAllowed
    try {
      const { SelfLearningConfigModel } = await import('../self_learning/self_learning_config.model.js');
      await SelfLearningConfigModel.updateOne(
        { horizon },
        { 
          $set: { 
            trainingAllowed: result.trainingAllowed,
            lastGateCheckAt: new Date(),
            lastGateStatus: result.gate_status,
          }
        },
        { upsert: true }
      );
    } catch (err) {
      console.warn('[GateCheck] Could not update SelfLearningConfig:', err);
    }
    
    // Audit log
    try {
      const { auditLog } = await import('../self_learning/audit_logger.service.js');
      await auditLog({
        event: result.gate_status === 'PASSED' ? 'GATE_CHECK_PASSED' : 'GATE_CHECK_BLOCKED',
        horizon,
        details: {
          runId: result.runId,
          failed_sections: result.failed_sections,
          reasons: result.reasons.slice(0, 10), // limit for log size
        },
      });
    } catch (err) {
      console.warn('[GateCheck] Could not write audit log:', err);
    }
  }
  
  return result;
}

/**
 * Get latest gate check status for horizon
 */
export async function getGateStatus(horizon: '7d' | '30d'): Promise<GateCheckResultDTO | null> {
  const latest = await GateCheckModel.findOne({ horizon })
    .sort({ createdAt: -1 })
    .lean();
  
  if (!latest) return null;
  
  return {
    runId: latest.runId,
    horizon: latest.horizon,
    gate_status: latest.gate_status,
    trainingAllowed: latest.trainingAllowed,
    failed_sections: latest.failed_sections,
    passed_sections: latest.passed_sections,
    reasons: latest.reasons,
    metrics: latest.metrics,
    sections: latest.sections,
    createdAt: latest.createdAt.toISOString(),
    version: latest.version,
  };
}

/**
 * Get gate check history
 */
export async function getGateHistory(
  horizon: '7d' | '30d',
  limit: number = 20
): Promise<GateCheckResultDTO[]> {
  const history = await GateCheckModel.find({ horizon })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  
  return history.map(h => ({
    runId: h.runId,
    horizon: h.horizon,
    gate_status: h.gate_status,
    trainingAllowed: h.trainingAllowed,
    failed_sections: h.failed_sections,
    passed_sections: h.passed_sections,
    reasons: h.reasons,
    metrics: h.metrics,
    sections: h.sections,
    createdAt: h.createdAt.toISOString(),
    version: h.version,
  }));
}

/**
 * Check if training is allowed (quick check)
 * Used by training endpoint to block unauthorized training
 */
export async function isTrainingAllowed(horizon: '7d' | '30d'): Promise<boolean> {
  const latest = await GateCheckModel.findOne({ horizon })
    .sort({ createdAt: -1 })
    .select('trainingAllowed')
    .lean();
  
  return latest?.trainingAllowed ?? false;
}
