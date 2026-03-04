/**
 * Self-Learning Runtime Config Model
 * 
 * Controls self-learning loop behavior (ETAP 5)
 * Extends engine runtime config with retrain guards and safety parameters.
 */
import mongoose from 'mongoose';

const SelfLearningConfigSchema = new mongoose.Schema({
  // ========== KILL SWITCH ==========
  selfLearningEnabled: {
    type: Boolean,
    default: false,
    required: true,
  },
  
  // ========== GUARDS ==========
  
  // Cooldown between retrains (hours)
  retrainCooldownHours: {
    type: Number,
    default: 168, // 7 days
    min: 24,
    max: 720, // 30 days
  },
  
  // Minimum samples required for retrain
  minTrainSamples: {
    type: Number,
    default: 200,
    min: 50,
    max: 1000,
  },
  
  // Maximum drift level allowed for retrain
  maxDriftLevelAllowed: {
    type: String,
    enum: ['LOW', 'MEDIUM'],
    default: 'MEDIUM',
  },
  
  // Minimum LIVE data share in dataset (0-1)
  minLiveShare: {
    type: Number,
    default: 0.20, // 20% minimum
    min: 0.0,
    max: 1.0,
  },
  
  // Maximum error rate during training (0-1)
  maxErrorRateDuringTraining: {
    type: Number,
    default: 0.05, // 5%
    min: 0.0,
    max: 0.5,
  },
  
  // Minimum dataset quality score (0-1)
  minDatasetQualityScore: {
    type: Number,
    default: 0.55,
    min: 0.0,
    max: 1.0,
  },
  
  // ========== EVALUATION GATE THRESHOLDS ==========
  
  // Candidate must beat rules by this margin (PR-AUC)
  minPrAucImprovementVsRules: {
    type: Number,
    default: 0.02, // +2%
    min: 0.0,
    max: 0.2,
  },
  
  // Candidate must beat rules by this margin (Precision@K)
  minPrecisionImprovementVsRules: {
    type: Number,
    default: 0.03, // +3%
    min: 0.0,
    max: 0.2,
  },
  
  // Maximum allowed calibration error increase
  maxCalibrationECEIncrease: {
    type: Number,
    default: 0.02, // +2%
    min: 0.0,
    max: 0.1,
  },
  
  // Maximum stability variance across splits (0-1)
  maxStabilityVariance: {
    type: Number,
    default: 0.10, // 10%
    min: 0.0,
    max: 0.5,
  },
  
  // ========== PROMOTION SETTINGS ==========
  
  // Auto-promote on PASS (if false, requires manual approval)
  autoPromoteOnPass: {
    type: Boolean,
    default: false, // Conservative: manual approval
  },
  
  // Auto-rollback on degradation
  autoRollbackOnDegradation: {
    type: Boolean,
    default: true, // Safety: auto rollback
  },
  
  // Degradation threshold (PR-AUC drop from baseline)
  degradationThreshold: {
    type: Number,
    default: 0.05, // 5% drop
    min: 0.0,
    max: 0.3,
  },
  
  // ========== SCHEDULING ==========
  
  // Cron schedule for retrain checks (default: every 6 hours)
  retrainScheduleCron: {
    type: String,
    default: '0 */6 * * *',
  },
  
  // Next eligible retrain time (computed from last retrain + cooldown)
  nextEligibleRetrainAt: {
    type: Date,
    required: false,
  },
  
  // Last retrain attempt
  lastRetrainAttemptAt: {
    type: Date,
    required: false,
  },
  
  // Last successful retrain
  lastSuccessfulRetrainAt: {
    type: Date,
    required: false,
  },
  
  // ========== AUDIT ==========
  
  updatedAt: {
    type: Date,
    default: Date.now,
    required: true,
  },
  
  updatedBy: {
    type: String,
    required: false,
  },
  
  notes: {
    type: String,
    required: false,
  },
}, {
  collection: 'self_learning_config',
  timestamps: false, // Manual updatedAt
});

// Ensure singleton
SelfLearningConfigSchema.index({ _id: 1 }, { unique: true });

export const SelfLearningConfigModel = mongoose.model(
  'SelfLearningConfig',
  SelfLearningConfigSchema
);

/**
 * Initialize default self-learning config
 */
export async function ensureDefaultSelfLearningConfig() {
  const count = await SelfLearningConfigModel.countDocuments();
  
  if (count === 0) {
    await SelfLearningConfigModel.create({
      selfLearningEnabled: false, // OFF by default
      retrainCooldownHours: 168,
      minTrainSamples: 200,
      maxDriftLevelAllowed: 'MEDIUM',
      minLiveShare: 0.20,
      maxErrorRateDuringTraining: 0.05,
      minDatasetQualityScore: 0.55,
      minPrAucImprovementVsRules: 0.02,
      minPrecisionImprovementVsRules: 0.03,
      maxCalibrationECEIncrease: 0.02,
      maxStabilityVariance: 0.10,
      autoPromoteOnPass: false,
      autoRollbackOnDegradation: true,
      degradationThreshold: 0.05,
      retrainScheduleCron: '0 */6 * * *',
      updatedAt: new Date(),
    });
    
    console.log('[Self-Learning Config] Default config created (disabled)');
  }
}

/**
 * Parse boolean from env string
 */
function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse number from env string
 */
function parseNumber(value: string | undefined, defaultValue: number, min?: number, max?: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return defaultValue;
  if (min !== undefined && parsed < min) return min;
  if (max !== undefined && parsed > max) return max;
  return parsed;
}

/**
 * Get current config with env overrides
 */
export async function getSelfLearningConfig() {
  let config = await SelfLearningConfigModel.findOne().lean();
  
  if (!config) {
    await ensureDefaultSelfLearningConfig();
    config = await SelfLearningConfigModel.findOne().lean();
  }
  
  // Ensure config has all required fields with defaults
  const safeConfig = {
    selfLearningEnabled: config?.selfLearningEnabled ?? false,
    retrainCooldownHours: config?.retrainCooldownHours ?? 168,
    minTrainSamples: config?.minTrainSamples ?? 200,
    maxDriftLevelAllowed: config?.maxDriftLevelAllowed ?? 'MEDIUM',
    minLiveShare: config?.minLiveShare ?? 0.20,
    maxErrorRateDuringTraining: config?.maxErrorRateDuringTraining ?? 0.05,
    minDatasetQualityScore: config?.minDatasetQualityScore ?? 0.55,
    minPrAucImprovementVsRules: config?.minPrAucImprovementVsRules ?? 0.02,
    minPrecisionImprovementVsRules: config?.minPrecisionImprovementVsRules ?? 0.03,
    maxCalibrationECEIncrease: config?.maxCalibrationECEIncrease ?? 0.02,
    maxStabilityVariance: config?.maxStabilityVariance ?? 0.10,
    autoPromoteOnPass: config?.autoPromoteOnPass ?? false,
    autoRollbackOnDegradation: config?.autoRollbackOnDegradation ?? true,
    degradationThreshold: config?.degradationThreshold ?? 0.05,
    retrainScheduleCron: config?.retrainScheduleCron ?? '0 */6 * * *',
    lastRetrainAttemptAt: config?.lastRetrainAttemptAt,
    lastSuccessfulRetrainAt: config?.lastSuccessfulRetrainAt,
  };
  
  // ENV overrides (with proper parsing)
  const envOverrides: any = {};
  
  if (process.env.SELF_LEARNING_ENABLED !== undefined) {
    envOverrides.selfLearningEnabled = parseBool(process.env.SELF_LEARNING_ENABLED, false);
  }
  
  if (process.env.RETRAIN_COOLDOWN_HOURS !== undefined) {
    envOverrides.retrainCooldownHours = parseNumber(process.env.RETRAIN_COOLDOWN_HOURS, 168, 24, 720);
  }
  
  if (process.env.MIN_TRAIN_SAMPLES !== undefined) {
    envOverrides.minTrainSamples = parseNumber(process.env.MIN_TRAIN_SAMPLES, 200, 50, 1000);
  }
  
  if (process.env.MIN_LIVE_SHARE !== undefined) {
    envOverrides.minLiveShare = parseNumber(process.env.MIN_LIVE_SHARE, 0.20, 0.0, 1.0);
  }
  
  return {
    ...safeConfig,
    ...envOverrides,
  };
}

/**
 * Update config
 */
export async function updateSelfLearningConfig(
  updates: Partial<typeof SelfLearningConfigSchema>,
  updatedBy: string
) {
  return SelfLearningConfigModel.findOneAndUpdate(
    {},
    {
      $set: {
        ...updates,
        updatedAt: new Date(),
        updatedBy,
      },
    },
    { new: true, upsert: true }
  );
}
