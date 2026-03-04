/**
 * Audit Log Model
 * 
 * ETAP 5.8: Complete audit trail for all self-learning actions.
 * Every decision can be reconstructed post-factum.
 */
import mongoose, { Schema, Document } from 'mongoose';
import type { Horizon } from './self_learning.types.js';

// ==================== TYPES ====================

export type AuditAction = 
  | 'TRAIN'
  | 'EVALUATE' 
  | 'PROMOTE'
  | 'ROLLBACK'
  | 'HEALTH_CHECK'
  | 'CONFIDENCE_ADJUST'
  | 'SHADOW_START'
  | 'SHADOW_STOP'
  | 'AUTO_ROLLBACK';

export interface IAuditLog extends Document {
  auditId: string;
  timestamp: Date;
  
  // Context
  horizon: Horizon;
  modelVersionId: string;
  datasetVersionId?: string;
  
  // Action
  action: AuditAction;
  reason: string;
  
  // Metrics snapshot
  metricsSnapshot?: {
    precision?: number;
    recall?: number;
    f1?: number;
    lift?: number;
    ece?: number;
    divergenceRate?: number;
    confidenceStd?: number;
  };
  
  // Decision context
  evaluationDecision?: 'PROMOTE' | 'HOLD' | 'REJECT';
  healthStatus?: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  mlModifier?: number;
  
  // Rollback info
  rolledBackFrom?: string;
  rolledBackTo?: string;
  
  // Previous state
  previousState?: {
    activeModelId?: string;
    healthStatus?: string;
    mlModifier?: number;
  };
  
  // Metadata
  triggeredBy: 'SCHEDULER' | 'MANUAL' | 'AUTO' | 'SYSTEM';
  
  createdAt: Date;
}

// ==================== SCHEMA ====================

const MetricsSnapshotSchema = new Schema({
  precision: Number,
  recall: Number,
  f1: Number,
  lift: Number,
  ece: Number,
  divergenceRate: Number,
  confidenceStd: Number,
}, { _id: false });

const PreviousStateSchema = new Schema({
  activeModelId: String,
  healthStatus: String,
  mlModifier: Number,
}, { _id: false });

const AuditLogSchema = new Schema<IAuditLog>({
  auditId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  timestamp: {
    type: Date,
    required: true,
    index: true,
  },
  
  // Context
  horizon: {
    type: String,
    enum: ['7d', '30d'],
    required: true,
  },
  modelVersionId: {
    type: String,
    required: true,
    index: true,
  },
  datasetVersionId: String,
  
  // Action
  action: {
    type: String,
    enum: ['TRAIN', 'EVALUATE', 'PROMOTE', 'ROLLBACK', 'HEALTH_CHECK', 'CONFIDENCE_ADJUST', 'SHADOW_START', 'SHADOW_STOP', 'AUTO_ROLLBACK'],
    required: true,
    index: true,
  },
  reason: {
    type: String,
    required: true,
  },
  
  // Metrics
  metricsSnapshot: MetricsSnapshotSchema,
  
  // Decision context
  evaluationDecision: {
    type: String,
    enum: ['PROMOTE', 'HOLD', 'REJECT'],
  },
  healthStatus: {
    type: String,
    enum: ['HEALTHY', 'DEGRADED', 'CRITICAL'],
  },
  mlModifier: Number,
  
  // Rollback info
  rolledBackFrom: String,
  rolledBackTo: String,
  
  // Previous state
  previousState: PreviousStateSchema,
  
  // Metadata
  triggeredBy: {
    type: String,
    enum: ['SCHEDULER', 'MANUAL', 'AUTO', 'SYSTEM'],
    required: true,
  },
}, {
  collection: 'self_learning_audit',
  timestamps: true,
});

// ==================== INDEXES ====================

AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ horizon: 1, timestamp: -1 });
AuditLogSchema.index({ modelVersionId: 1, timestamp: -1 });
AuditLogSchema.index({ action: 1, timestamp: -1 });

// ==================== MODEL ====================

export const AuditLogModel = mongoose.model<IAuditLog>('SelfLearningAudit', AuditLogSchema);
