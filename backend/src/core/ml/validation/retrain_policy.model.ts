/**
 * ML Retrain Policy Model - ML v2.1 STEP 3
 * 
 * Stores retrain policies and execution history.
 */

import mongoose from 'mongoose';

// ============================================
// RETRAIN POLICY SCHEMA
// ============================================

const retrainPolicySchema = new mongoose.Schema({
  // Policy identifier
  policyId: { type: String, required: true, unique: true },
  
  // Target network (or 'all' for global)
  network: { type: String, required: true, default: 'all' },
  
  // Policy enabled
  enabled: { type: Boolean, default: true },
  
  // Trigger conditions
  triggers: {
    // Trigger on accuracy drop below threshold
    accuracyThreshold: { type: Number, default: 0.45 },
    
    // Trigger on drift severity
    driftSeverity: { 
      type: String, 
      enum: ['LOW', 'MEDIUM', 'HIGH', 'NONE'],
      default: 'MEDIUM' 
    },
    
    // Trigger after N consecutive drift events
    consecutiveDrifts: { type: Number, default: 3 },
    
    // Minimum samples required for retrain
    minSamples: { type: Number, default: 1000 },
    
    // Cooldown between retrains (hours)
    cooldownHours: { type: Number, default: 24 },
  },
  
  // Actions to take when triggered
  actions: {
    // Auto-retrain model
    autoRetrain: { type: Boolean, default: false },
    
    // Disable model on high drift
    autoDisableOnHighDrift: { type: Boolean, default: true },
    
    // Send alert/notification
    sendAlert: { type: Boolean, default: true },
    
    // Update dataset with new labels
    updateDataset: { type: Boolean, default: true },
  },
  
  // Retrain configuration
  retrainConfig: {
    // Model type to retrain
    modelType: { 
      type: String, 
      enum: ['market', 'actor', 'both'],
      default: 'market' 
    },
    
    // Training window (days of data)
    trainingWindowDays: { type: Number, default: 30 },
    
    // Validation split
    validationSplit: { type: Number, default: 0.2 },
    
    // Use latest labels only
    useLatestLabels: { type: Boolean, default: true },
  },
  
  // Last execution info
  lastExecution: {
    timestamp: { type: Number },
    status: { 
      type: String, 
      enum: ['SUCCESS', 'FAILED', 'SKIPPED', 'IN_PROGRESS', null],
    },
    message: { type: String },
    triggeredBy: { type: String }, // 'auto' | 'manual' | admin username
  },
  
  // Stats
  stats: {
    totalExecutions: { type: Number, default: 0 },
    successfulRetrains: { type: Number, default: 0 },
    failedRetrains: { type: Number, default: 0 },
    lastSuccessTimestamp: { type: Number },
  },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

retrainPolicySchema.index({ policyId: 1 });
retrainPolicySchema.index({ network: 1 });
retrainPolicySchema.index({ enabled: 1 });

export const RetrainPolicyModel = mongoose.model('RetrainPolicy', retrainPolicySchema);

// ============================================
// RETRAIN EXECUTION LOG SCHEMA
// ============================================

const retrainExecutionSchema = new mongoose.Schema({
  // Reference to policy
  policyId: { type: String, required: true },
  
  // Network
  network: { type: String, required: true },
  
  // Model type
  modelType: { type: String, required: true },
  
  // Execution status
  status: { 
    type: String, 
    enum: ['PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'SKIPPED'],
    default: 'PENDING' 
  },
  
  // Trigger info
  trigger: {
    type: { type: String }, // 'accuracy' | 'drift' | 'manual' | 'scheduled'
    value: { type: mongoose.Schema.Types.Mixed },
    threshold: { type: mongoose.Schema.Types.Mixed },
  },
  
  // Pre-retrain metrics
  preMetrics: {
    accuracy: { type: Number },
    samples: { type: Number },
    driftLevel: { type: String },
  },
  
  // Post-retrain metrics (after validation)
  postMetrics: {
    accuracy: { type: Number },
    improvement: { type: Number },
    validationScore: { type: Number },
  },
  
  // Execution details
  execution: {
    startedAt: { type: Number },
    completedAt: { type: Number },
    durationMs: { type: Number },
    trainingSamples: { type: Number },
    modelVersion: { type: String },
  },
  
  // Error info (if failed)
  error: {
    code: { type: String },
    message: { type: String },
    stack: { type: String },
  },
  
  // Who triggered
  triggeredBy: { type: String, default: 'auto' },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
});

retrainExecutionSchema.index({ policyId: 1, createdAt: -1 });
retrainExecutionSchema.index({ network: 1, createdAt: -1 });
retrainExecutionSchema.index({ status: 1 });
retrainExecutionSchema.index({ createdAt: -1 });

export const RetrainExecutionModel = mongoose.model('RetrainExecution', retrainExecutionSchema);

// ============================================
// TYPES
// ============================================

export interface RetrainPolicy {
  policyId: string;
  network: string;
  enabled: boolean;
  triggers: {
    accuracyThreshold: number;
    driftSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'NONE';
    consecutiveDrifts: number;
    minSamples: number;
    cooldownHours: number;
  };
  actions: {
    autoRetrain: boolean;
    autoDisableOnHighDrift: boolean;
    sendAlert: boolean;
    updateDataset: boolean;
  };
  retrainConfig: {
    modelType: 'market' | 'actor' | 'both';
    trainingWindowDays: number;
    validationSplit: number;
    useLatestLabels: boolean;
  };
}

export default {
  RetrainPolicyModel,
  RetrainExecutionModel,
};
