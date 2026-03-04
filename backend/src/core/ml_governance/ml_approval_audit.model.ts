/**
 * ML Approval Audit Log Model
 * 
 * Tracks all approval decisions for governance and compliance.
 */

import { Schema, model, Document } from 'mongoose';

export type ApprovalAction = 'APPROVED' | 'REJECTED' | 'ROLLBACK' | 'PROMOTED';

export interface IApprovalAudit extends Document {
  createdAt: Date;
  action: ApprovalAction;
  modelId: string;
  modelVersion: string;
  task: 'market' | 'actor';
  network: string;
  actor: {
    id: string;
    username: string;
    role: string;
  };
  reason?: string;
  metadata?: {
    previousVersion?: string;
    targetVersion?: string;
    metrics?: Record<string, number>;
    verdict?: string;
    mlVersion?: string;
  };
}

const ApprovalAuditSchema = new Schema<IApprovalAudit>({
  createdAt: { type: Date, default: Date.now },
  action: { 
    type: String, 
    enum: ['APPROVED', 'REJECTED', 'ROLLBACK', 'PROMOTED'],
    required: true 
  },
  modelId: { type: String, required: true },
  modelVersion: { type: String, required: true },
  task: { type: String, enum: ['market', 'actor'], required: true },
  network: { type: String, required: true },
  actor: {
    id: { type: String, required: true },
    username: { type: String, required: true },
    role: { type: String, required: true }
  },
  reason: { type: String },
  metadata: {
    previousVersion: String,
    targetVersion: String,
    metrics: { type: Schema.Types.Mixed },
    verdict: String,
    mlVersion: String
  }
});

// Indexes
ApprovalAuditSchema.index({ createdAt: -1 });
ApprovalAuditSchema.index({ task: 1, network: 1, createdAt: -1 });
ApprovalAuditSchema.index({ action: 1, createdAt: -1 });
ApprovalAuditSchema.index({ 'actor.id': 1, createdAt: -1 });

export const ApprovalAuditModel = model<IApprovalAudit>(
  'ml_approval_audit',
  ApprovalAuditSchema
);
