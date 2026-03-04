/**
 * ML Retrain Service - ML v2.1 STEP 3
 * 
 * Manages retrain policies and execution.
 */

import { RetrainPolicyModel, RetrainExecutionModel } from './retrain_policy.model.js';
import { AccuracySnapshotModel } from './accuracy_snapshot.model.js';
import { DriftEventModel } from './drift_event.model.js';

// ============================================
// POLICY MANAGEMENT
// ============================================

/**
 * Get all retrain policies
 */
export async function getAllPolicies(): Promise<any[]> {
  const policies = await RetrainPolicyModel.find({}).sort({ network: 1 }).lean();
  return policies.map(p => ({
    ...p,
    _id: String(p._id),
  }));
}

/**
 * Get policy by ID
 */
export async function getPolicyById(policyId: string): Promise<any | null> {
  const policy = await RetrainPolicyModel.findOne({ policyId }).lean();
  if (!policy) return null;
  return { ...policy, _id: String(policy._id) };
}

/**
 * Create or update retrain policy
 */
export async function upsertPolicy(policyData: {
  policyId: string;
  network?: string;
  enabled?: boolean;
  triggers?: any;
  actions?: any;
  retrainConfig?: any;
}): Promise<any> {
  const now = new Date();
  
  const result = await RetrainPolicyModel.findOneAndUpdate(
    { policyId: policyData.policyId },
    {
      $set: {
        ...policyData,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true, new: true }
  ).lean();
  
  return { ...result, _id: String(result._id) };
}

/**
 * Delete policy
 */
export async function deletePolicy(policyId: string): Promise<boolean> {
  const result = await RetrainPolicyModel.deleteOne({ policyId });
  return result.deletedCount > 0;
}

/**
 * Toggle policy enabled/disabled
 */
export async function togglePolicy(policyId: string, enabled: boolean): Promise<any | null> {
  const result = await RetrainPolicyModel.findOneAndUpdate(
    { policyId },
    { $set: { enabled, updatedAt: new Date() } },
    { new: true }
  ).lean();
  
  if (!result) return null;
  return { ...result, _id: String(result._id) };
}

// ============================================
// POLICY EVALUATION
// ============================================

/**
 * Check if policy should trigger retrain
 */
export async function evaluatePolicy(policyId: string): Promise<{
  shouldTrigger: boolean;
  reason: string | null;
  details: any;
}> {
  const policy = await RetrainPolicyModel.findOne({ policyId }).lean();
  
  if (!policy || !policy.enabled) {
    return { shouldTrigger: false, reason: 'Policy disabled or not found', details: null };
  }
  
  const { triggers, lastExecution } = policy;
  
  // Check cooldown
  if (lastExecution?.timestamp) {
    const hoursSinceLastExecution = (Date.now() - lastExecution.timestamp) / (1000 * 60 * 60);
    if (hoursSinceLastExecution < triggers.cooldownHours) {
      return { 
        shouldTrigger: false, 
        reason: `Cooldown active (${Math.round(triggers.cooldownHours - hoursSinceLastExecution)}h remaining)`,
        details: { cooldownRemaining: triggers.cooldownHours - hoursSinceLastExecution }
      };
    }
  }
  
  // Check accuracy threshold
  const network = policy.network === 'all' ? undefined : policy.network;
  const latestSnapshot = await AccuracySnapshotModel.findOne(
    network ? { network, window: '7d' } : { window: '7d' }
  ).sort({ createdAt: -1 }).lean();
  
  if (latestSnapshot && latestSnapshot.accuracy < triggers.accuracyThreshold) {
    return {
      shouldTrigger: true,
      reason: `Accuracy ${(latestSnapshot.accuracy * 100).toFixed(1)}% below threshold ${(triggers.accuracyThreshold * 100)}%`,
      details: { 
        currentAccuracy: latestSnapshot.accuracy,
        threshold: triggers.accuracyThreshold,
        trigger: 'accuracy'
      }
    };
  }
  
  // Check drift severity
  if (triggers.driftSeverity !== 'NONE') {
    const severityOrder = { LOW: 1, MEDIUM: 2, HIGH: 3 };
    const recentDrifts = await DriftEventModel.find({
      ...(network ? { network } : {}),
      acknowledged: false,
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }).sort({ createdAt: -1 }).limit(triggers.consecutiveDrifts).lean();
    
    const highSeverityDrifts = recentDrifts.filter(
      d => severityOrder[d.severity] >= severityOrder[triggers.driftSeverity]
    );
    
    if (highSeverityDrifts.length >= triggers.consecutiveDrifts) {
      return {
        shouldTrigger: true,
        reason: `${highSeverityDrifts.length} consecutive ${triggers.driftSeverity}+ drift events`,
        details: {
          driftCount: highSeverityDrifts.length,
          requiredCount: triggers.consecutiveDrifts,
          trigger: 'drift'
        }
      };
    }
  }
  
  return { shouldTrigger: false, reason: 'No trigger conditions met', details: null };
}

/**
 * Evaluate all enabled policies
 */
export async function evaluateAllPolicies(): Promise<{
  evaluated: number;
  triggered: string[];
  details: any[];
}> {
  const policies = await RetrainPolicyModel.find({ enabled: true }).lean();
  const triggered: string[] = [];
  const details: any[] = [];
  
  for (const policy of policies) {
    const result = await evaluatePolicy(policy.policyId);
    details.push({
      policyId: policy.policyId,
      network: policy.network,
      ...result
    });
    
    if (result.shouldTrigger) {
      triggered.push(policy.policyId);
    }
  }
  
  return {
    evaluated: policies.length,
    triggered,
    details
  };
}

// ============================================
// RETRAIN EXECUTION
// ============================================

/**
 * Create retrain execution record
 */
export async function createExecution(data: {
  policyId: string;
  network: string;
  modelType: string;
  trigger: { type: string; value?: any; threshold?: any };
  triggeredBy: string;
}): Promise<any> {
  // Get pre-metrics
  const latestSnapshot = await AccuracySnapshotModel.findOne({
    network: data.network === 'all' ? undefined : data.network,
    window: '7d'
  }).sort({ createdAt: -1 }).lean();
  
  const latestDrift = await DriftEventModel.findOne({
    network: data.network === 'all' ? undefined : data.network,
  }).sort({ createdAt: -1 }).lean();
  
  const execution = await RetrainExecutionModel.create({
    policyId: data.policyId,
    network: data.network,
    modelType: data.modelType,
    status: 'PENDING',
    trigger: data.trigger,
    preMetrics: {
      accuracy: latestSnapshot?.accuracy,
      samples: latestSnapshot?.total,
      driftLevel: latestDrift?.severity,
    },
    triggeredBy: data.triggeredBy,
  });
  
  return { ...execution.toObject(), _id: String(execution._id) };
}

/**
 * Update execution status
 */
export async function updateExecutionStatus(
  executionId: string,
  status: 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'SKIPPED',
  details?: {
    error?: { code: string; message: string };
    postMetrics?: { accuracy: number; improvement: number };
    execution?: { completedAt: number; durationMs: number; trainingSamples: number; modelVersion: string };
  }
): Promise<any> {
  const updateData: any = { status };
  
  if (details?.error) {
    updateData.error = details.error;
  }
  if (details?.postMetrics) {
    updateData.postMetrics = details.postMetrics;
  }
  if (details?.execution) {
    updateData.execution = {
      ...details.execution,
      completedAt: details.execution.completedAt || Date.now(),
    };
  }
  
  const result = await RetrainExecutionModel.findByIdAndUpdate(
    executionId,
    { $set: updateData },
    { new: true }
  ).lean();
  
  // Update policy stats
  if (result) {
    const statsUpdate: any = {
      'lastExecution.timestamp': Date.now(),
      'lastExecution.status': status,
      'lastExecution.triggeredBy': result.triggeredBy,
      $inc: { 'stats.totalExecutions': 1 }
    };
    
    if (status === 'SUCCESS') {
      statsUpdate.$inc['stats.successfulRetrains'] = 1;
      statsUpdate['stats.lastSuccessTimestamp'] = Date.now();
    } else if (status === 'FAILED') {
      statsUpdate.$inc['stats.failedRetrains'] = 1;
    }
    
    await RetrainPolicyModel.updateOne(
      { policyId: result.policyId },
      statsUpdate
    );
  }
  
  return result ? { ...result, _id: String(result._id) } : null;
}

/**
 * Get execution history
 */
export async function getExecutionHistory(options: {
  policyId?: string;
  network?: string;
  status?: string;
  limit?: number;
}): Promise<any[]> {
  const query: any = {};
  
  if (options.policyId) query.policyId = options.policyId;
  if (options.network) query.network = options.network;
  if (options.status) query.status = options.status;
  
  const executions = await RetrainExecutionModel.find(query)
    .sort({ createdAt: -1 })
    .limit(options.limit || 50)
    .lean();
  
  return executions.map(e => ({ ...e, _id: String(e._id) }));
}

/**
 * Trigger manual retrain
 */
export async function triggerManualRetrain(
  policyId: string,
  triggeredBy: string
): Promise<{
  success: boolean;
  execution?: any;
  message: string;
}> {
  const policy = await RetrainPolicyModel.findOne({ policyId }).lean();
  
  if (!policy) {
    return { success: false, message: 'Policy not found' };
  }
  
  // Create execution record
  const execution = await createExecution({
    policyId,
    network: policy.network,
    modelType: policy.retrainConfig.modelType,
    trigger: { type: 'manual' },
    triggeredBy,
  });
  
  // Start execution (in real implementation, this would trigger actual ML training)
  await updateExecutionStatus(execution._id, 'IN_PROGRESS');
  
  // Simulate retrain (in production, this calls Python ML service)
  // For now, we mark as success after a delay simulation
  setTimeout(async () => {
    try {
      // In production: call Python ML service to retrain
      // const result = await pythonMLService.retrain(policy.retrainConfig);
      
      await updateExecutionStatus(execution._id, 'SUCCESS', {
        postMetrics: {
          accuracy: 0.58, // Would be actual validation accuracy
          improvement: 0.05,
        },
        execution: {
          completedAt: Date.now(),
          durationMs: 5000,
          trainingSamples: 1500,
          modelVersion: `v${Date.now()}`,
        },
      });
    } catch (err: any) {
      await updateExecutionStatus(execution._id, 'FAILED', {
        error: {
          code: 'RETRAIN_ERROR',
          message: err.message,
        },
      });
    }
  }, 100);
  
  return {
    success: true,
    execution,
    message: 'Retrain triggered successfully',
  };
}

// ============================================
// SUMMARY & STATS
// ============================================

/**
 * Get retrain summary
 */
export async function getRetrainSummary(): Promise<{
  totalPolicies: number;
  enabledPolicies: number;
  recentExecutions: number;
  successRate: number;
  pendingTriggers: string[];
}> {
  const [
    totalPolicies,
    enabledPolicies,
    recentExecutions,
    successfulExecutions,
  ] = await Promise.all([
    RetrainPolicyModel.countDocuments({}),
    RetrainPolicyModel.countDocuments({ enabled: true }),
    RetrainExecutionModel.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }),
    RetrainExecutionModel.countDocuments({
      status: 'SUCCESS',
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }),
  ]);
  
  // Check pending triggers
  const evaluation = await evaluateAllPolicies();
  
  return {
    totalPolicies,
    enabledPolicies,
    recentExecutions,
    successRate: recentExecutions > 0 ? successfulExecutions / recentExecutions : 1,
    pendingTriggers: evaluation.triggered,
  };
}

/**
 * Initialize default policy if none exists
 */
export async function ensureDefaultPolicy(): Promise<void> {
  const count = await RetrainPolicyModel.countDocuments({});
  if (count > 0) return;
  
  await upsertPolicy({
    policyId: 'default_market',
    network: 'all',
    enabled: true,
    triggers: {
      accuracyThreshold: 0.45,
      driftSeverity: 'MEDIUM',
      consecutiveDrifts: 3,
      minSamples: 1000,
      cooldownHours: 24,
    },
    actions: {
      autoRetrain: false,
      autoDisableOnHighDrift: true,
      sendAlert: true,
      updateDataset: true,
    },
    retrainConfig: {
      modelType: 'market',
      trainingWindowDays: 30,
      validationSplit: 0.2,
      useLatestLabels: true,
    },
  });
  
  console.log('[Retrain] Created default retrain policy');
}

export default {
  getAllPolicies,
  getPolicyById,
  upsertPolicy,
  deletePolicy,
  togglePolicy,
  evaluatePolicy,
  evaluateAllPolicies,
  createExecution,
  updateExecutionStatus,
  getExecutionHistory,
  triggerManualRetrain,
  getRetrainSummary,
  ensureDefaultPolicy,
};
