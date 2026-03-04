/**
 * Retrain Guards Service (ETAP 5.1)
 * 
 * Safety checks before allowing retrain.
 * ZERO tolerance for unsafe retraining conditions.
 */
import { getSelfLearningConfig } from './self_learning_config.model.js';
import { DatasetVersionModel } from './dataset_version.model.js';
import { logSelfLearningEvent } from './audit_helpers.js';
import { LearningSampleModel } from '../learning/dataset/learning_sample.model.js';
import { LiveAggregateWindowModel } from '../live/models/live_aggregate_window.model.js';

export interface GuardCheck {
  passed: boolean;
  reason?: string;
  details?: any;
}

export interface GuardSnapshot {
  timestamp: Date;
  horizon: '7d' | '30d';
  checks: {
    killSwitch: GuardCheck;
    cooldown: GuardCheck;
    minSamples: GuardCheck;
    driftLevel: GuardCheck;
    liveShare: GuardCheck;
    datasetQuality: GuardCheck;
    schemaIntegrity: GuardCheck;
    backlogHealth: GuardCheck;
  };
  overallPass: boolean;
  blockReasons: string[];
}

/**
 * Master guard check - can we retrain?
 * NEVER THROWS - always returns snapshot with ok/fail status
 */
export async function canRetrain(horizon: '7d' | '30d'): Promise<GuardSnapshot> {
  const timestamp = new Date();
  
  // Initialize with safe defaults
  const checks: any = {
    killSwitch: { passed: false, reason: 'Not checked yet' },
    cooldown: { passed: false, reason: 'Not checked yet' },
    minSamples: { passed: false, reason: 'Not checked yet' },
    driftLevel: { passed: false, reason: 'Not checked yet' },
    liveShare: { passed: false, reason: 'Not checked yet' },
    datasetQuality: { passed: false, reason: 'Not checked yet' },
    schemaIntegrity: { passed: false, reason: 'Not checked yet' },
    backlogHealth: { passed: false, reason: 'Not checked yet' },
  };
  
  try {
    const config = await getSelfLearningConfig();
    
    // ========== CHECK 1: KILL SWITCH ==========
    try {
      checks.killSwitch = checkKillSwitch(config);
    } catch (err: any) {
      checks.killSwitch = { passed: false, reason: `Kill switch check error: ${err.message}` };
    }
    
    // ========== CHECK 2: COOLDOWN ==========
    try {
      checks.cooldown = await checkCooldown(config, horizon);
    } catch (err: any) {
      checks.cooldown = { passed: false, reason: `Cooldown check error: ${err.message}` };
    }
    
    // ========== CHECK 3: MIN SAMPLES ==========
    try {
      checks.minSamples = await checkMinSamples(config, horizon);
    } catch (err: any) {
      checks.minSamples = { passed: false, reason: `Min samples check error: ${err.message}` };
    }
    
    // ========== CHECK 4: DRIFT LEVEL ==========
    try {
      checks.driftLevel = await checkDriftLevel(config, horizon);
    } catch (err: any) {
      checks.driftLevel = { passed: false, reason: `Drift level check error: ${err.message}` };
    }
    
    // ========== CHECK 5: LIVE SHARE ==========
    try {
      checks.liveShare = await checkLiveShare(config, horizon);
    } catch (err: any) {
      checks.liveShare = { passed: false, reason: `LIVE share check error: ${err.message}` };
    }
    
    // ========== CHECK 6: DATASET QUALITY ==========
    try {
      checks.datasetQuality = await checkDatasetQuality(config, horizon);
    } catch (err: any) {
      checks.datasetQuality = { passed: false, reason: `Dataset quality check error: ${err.message}` };
    }
    
    // ========== CHECK 7: SCHEMA INTEGRITY ==========
    try {
      checks.schemaIntegrity = await checkSchemaIntegrity(horizon);
    } catch (err: any) {
      checks.schemaIntegrity = { passed: false, reason: `Schema integrity check error: ${err.message}` };
    }
    
    // ========== CHECK 8: BACKLOG HEALTH ==========
    try {
      checks.backlogHealth = await checkBacklogHealth();
    } catch (err: any) {
      checks.backlogHealth = { passed: false, reason: `Backlog health check error: ${err.message}` };
    }
    
    // ========== AGGREGATE ==========
    const allPassed = Object.values(checks).every((check: any) => check.passed);
    
    const blockReasons = Object.entries(checks)
      .filter(([_, check]: [string, any]) => !check.passed)
      .map(([name, check]: [string, any]) => `${name}: ${check.reason}`);
    
    const snapshot: GuardSnapshot = {
      timestamp,
      horizon,
      checks,
      overallPass: allPassed,
      blockReasons,
    };
    
    // Log if blocked
    if (!allPassed) {
      try {
        await logSelfLearningEvent({
          eventType: 'GUARD_BLOCKED',
          horizon,
          details: {
            guardReasons: blockReasons,
            guardSnapshot: snapshot,
          },
          configSnapshot: config,
          triggeredBy: 'system',
          severity: 'warning',
        });
      } catch (logErr: any) {
        console.error('[Guards] Failed to log guard block:', logErr);
      }
    }
    
    return snapshot;
    
  } catch (err: any) {
    // Catastrophic error - return safe failure
    console.error('[Guards] Catastrophic guard check error:', err);
    
    return {
      timestamp,
      horizon,
      checks,
      overallPass: false,
      blockReasons: [`GUARD_SYSTEM_ERROR: ${err.message}`],
    };
  }
}

/**
 * CHECK 1: Kill switch
 */
function checkKillSwitch(config: any): GuardCheck {
  if (!config.selfLearningEnabled) {
    return {
      passed: false,
      reason: 'Self-learning is disabled (kill switch)',
    };
  }
  
  return { passed: true };
}

/**
 * CHECK 2: Cooldown
 */
async function checkCooldown(config: any, horizon: '7d' | '30d'): Promise<GuardCheck> {
  const lastRetrainAt = config.lastSuccessfulRetrainAt;
  
  if (!lastRetrainAt) {
    return { passed: true }; // No previous retrain
  }
  
  const cooldownMs = config.retrainCooldownHours * 60 * 60 * 1000;
  const nextEligibleAt = new Date(lastRetrainAt.getTime() + cooldownMs);
  const now = new Date();
  
  if (now < nextEligibleAt) {
    const hoursRemaining = Math.ceil((nextEligibleAt.getTime() - now.getTime()) / (60 * 60 * 1000));
    
    return {
      passed: false,
      reason: `Cooldown active: ${hoursRemaining}h remaining until ${nextEligibleAt.toISOString()}`,
      details: {
        lastRetrainAt,
        nextEligibleAt,
        hoursRemaining,
      },
    };
  }
  
  return { passed: true };
}

/**
 * CHECK 3: Minimum samples
 */
async function checkMinSamples(config: any, horizon: '7d' | '30d'): Promise<GuardCheck> {
  const count = await LearningSampleModel.countDocuments({
    horizon,
    trainEligible: true,
  });
  
  if (count < config.minTrainSamples) {
    return {
      passed: false,
      reason: `Insufficient samples: ${count}/${config.minTrainSamples}`,
      details: { count, required: config.minTrainSamples },
    };
  }
  
  return {
    passed: true,
    details: { count },
  };
}

/**
 * CHECK 4: Drift level
 */
async function checkDriftLevel(config: any, horizon: '7d' | '30d'): Promise<GuardCheck> {
  // Get recent drift status from LI-5
  const recentAggregates = await LiveAggregateWindowModel
    .find({
      window: '24h',
      approvalStatus: { $in: ['APPROVED', 'QUARANTINED'] },
    })
    .sort({ windowStart: -1 })
    .limit(10)
    .lean();
  
  if (recentAggregates.length === 0) {
    return {
      passed: false,
      reason: 'No recent LIVE data to assess drift',
    };
  }
  
  // Check drift levels
  const driftCounts = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
  };
  
  for (const agg of recentAggregates) {
    const driftLevel = agg.driftSummary?.level || 'LOW';
    driftCounts[driftLevel as keyof typeof driftCounts]++;
  }
  
  const hasHighOrCritical = driftCounts.HIGH > 0 || driftCounts.CRITICAL > 0;
  
  if (hasHighOrCritical && config.maxDriftLevelAllowed === 'LOW') {
    return {
      passed: false,
      reason: `Drift too high: ${driftCounts.HIGH} HIGH, ${driftCounts.CRITICAL} CRITICAL`,
      details: driftCounts,
    };
  }
  
  if (driftCounts.CRITICAL > 0 && config.maxDriftLevelAllowed === 'MEDIUM') {
    return {
      passed: false,
      reason: `CRITICAL drift detected: ${driftCounts.CRITICAL} windows`,
      details: driftCounts,
    };
  }
  
  return {
    passed: true,
    details: driftCounts,
  };
}

/**
 * CHECK 5: LIVE share
 */
async function checkLiveShare(config: any, horizon: '7d' | '30d'): Promise<GuardCheck> {
  const totalSamples = await LearningSampleModel.countDocuments({
    horizon,
    trainEligible: true,
  });
  
  const liveSamples = await LearningSampleModel.countDocuments({
    horizon,
    trainEligible: true,
    source: 'LIVE',
  });
  
  if (totalSamples === 0) {
    return {
      passed: false,
      reason: 'No samples available',
    };
  }
  
  const liveShare = liveSamples / totalSamples;
  
  if (liveShare < config.minLiveShare) {
    return {
      passed: false,
      reason: `LIVE share too low: ${(liveShare * 100).toFixed(1)}% < ${(config.minLiveShare * 100).toFixed(1)}%`,
      details: { liveSamples, totalSamples, liveShare },
    };
  }
  
  return {
    passed: true,
    details: { liveSamples, totalSamples, liveShare },
  };
}

/**
 * CHECK 6: Dataset quality
 */
async function checkDatasetQuality(config: any, horizon: '7d' | '30d'): Promise<GuardCheck> {
  // Get samples with quality scores
  const samplesWithQuality = await LearningSampleModel.aggregate([
    {
      $match: {
        horizon,
        trainEligible: true,
        'dataQuality.qualityScore': { $exists: true },
      },
    },
    {
      $group: {
        _id: null,
        avgQuality: { $avg: '$dataQuality.qualityScore' },
        count: { $sum: 1 },
      },
    },
  ]);
  
  if (samplesWithQuality.length === 0) {
    return {
      passed: false,
      reason: 'No quality scores available',
    };
  }
  
  const avgQuality = samplesWithQuality[0].avgQuality;
  
  if (avgQuality < config.minDatasetQualityScore) {
    return {
      passed: false,
      reason: `Dataset quality too low: ${avgQuality.toFixed(2)} < ${config.minDatasetQualityScore}`,
      details: { avgQuality },
    };
  }
  
  return {
    passed: true,
    details: { avgQuality },
  };
}

/**
 * CHECK 7: Schema integrity
 */
async function checkSchemaIntegrity(horizon: '7d' | '30d'): Promise<GuardCheck> {
  // Check if there's a previous dataset version
  const latestDataset = await DatasetVersionModel.findLatestFrozen(horizon);
  
  if (!latestDataset) {
    return { passed: true }; // No previous dataset to compare
  }
  
  // Get current schema (from latest sample)
  const latestSample = await LearningSampleModel
    .findOne({ horizon, trainEligible: true })
    .sort({ createdAt: -1 })
    .lean();
  
  if (!latestSample) {
    return {
      passed: false,
      reason: 'No recent samples to validate schema',
    };
  }
  
  // Simple schema check: feature keys must match
  const currentFeatureKeys = Object.keys(latestSample.features || {}).sort();
  const currentLabelKeys = Object.keys(latestSample.labels || {}).sort();
  
  // Hash current schema
  const currentFeatureHash = JSON.stringify(currentFeatureKeys);
  const currentLabelHash = JSON.stringify(currentLabelKeys);
  
  // Compare with previous
  const schemaMismatch = 
    (latestDataset.featureSchemaHash && latestDataset.featureSchemaHash !== currentFeatureHash) ||
    (latestDataset.labelSchemaHash && latestDataset.labelSchemaHash !== currentLabelHash);
  
  if (schemaMismatch) {
    return {
      passed: false,
      reason: 'Schema mismatch: features or labels changed',
      details: {
        previousFeatureHash: latestDataset.featureSchemaHash,
        currentFeatureHash,
        previousLabelHash: latestDataset.labelSchemaHash,
        currentLabelHash,
      },
    };
  }
  
  return { passed: true };
}

/**
 * CHECK 8: Backlog health
 */
async function checkBacklogHealth(): Promise<GuardCheck> {
  // Check recent LIVE ingestion
  const recentAggregates = await LiveAggregateWindowModel
    .find({
      window: '24h',
    })
    .sort({ windowStart: -1 })
    .limit(5)
    .lean();
  
  if (recentAggregates.length === 0) {
    return {
      passed: false,
      reason: 'No recent LIVE ingestion data',
    };
  }
  
  // Check for blocks
  const blockedCount = recentAggregates.filter(
    agg => agg.approvalStatus === 'BLOCKED'
  ).length;
  
  if (blockedCount > 2) {
    return {
      passed: false,
      reason: `Too many blocked windows: ${blockedCount}/5`,
      details: { blockedCount, total: recentAggregates.length },
    };
  }
  
  return {
    passed: true,
    details: { blockedCount, total: recentAggregates.length },
  };
}

/**
 * Get human-readable guard summary
 */
export function getGuardSummary(snapshot: GuardSnapshot): string {
  if (snapshot.overallPass) {
    return `✅ All guards passed for ${snapshot.horizon} horizon`;
  }
  
  return `❌ Retrain blocked for ${snapshot.horizon}:\n${snapshot.blockReasons.map(r => `  - ${r}`).join('\n')}`;
}
