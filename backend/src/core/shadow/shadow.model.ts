/**
 * Shadow Mode Mongoose Model
 * 
 * Stores V1 vs V2 comparison snapshots
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IShadowSnapshot extends Document {
  subject: {
    kind: 'entity' | 'actor' | 'wallet';
    id: string;
  };
  window: '1h' | '6h' | '24h' | '7d';

  v1: {
    decision: string;
    evidence: number;
    risk: number;
    confidence: number;
    coverage: number;
  };

  v2: {
    decision: string;
    evidence: number;
    direction: number;
    risk: number;
    confidence: number;
    coverage: number;
    engineStatus: string;
  };

  diff: {
    decisionChanged: boolean;
    evidenceDelta: number;
    riskDelta: number;
    coverageDelta: number;
    confidenceDelta: number;
  };

  computedAt: Date;
}

const ShadowSnapshotSchema = new Schema<IShadowSnapshot>({
  subject: {
    kind: { type: String, enum: ['entity', 'actor', 'wallet'], required: true },
    id: { type: String, required: true },
  },

  window: { type: String, enum: ['1h', '6h', '24h', '7d'], required: true },

  v1: {
    decision: { type: String },
    evidence: { type: Number },
    risk: { type: Number },
    confidence: { type: Number },
    coverage: { type: Number },
  },

  v2: {
    decision: { type: String },
    evidence: { type: Number },
    direction: { type: Number },
    risk: { type: Number },
    confidence: { type: Number },
    coverage: { type: Number },
    engineStatus: { type: String },
  },

  diff: {
    decisionChanged: { type: Boolean },
    evidenceDelta: { type: Number },
    riskDelta: { type: Number },
    coverageDelta: { type: Number },
    confidenceDelta: { type: Number },
  },

  computedAt: { type: Date, default: Date.now },

}, { timestamps: true });

// Indexes
ShadowSnapshotSchema.index({ window: 1, computedAt: -1 });
ShadowSnapshotSchema.index({ 'subject.id': 1, window: 1 });
ShadowSnapshotSchema.index({ 'diff.decisionChanged': 1, window: 1 });

export const ShadowSnapshotModel = mongoose.model<IShadowSnapshot>(
  'ShadowSnapshot',
  ShadowSnapshotSchema,
  'shadow_snapshots'
);
