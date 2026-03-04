/**
 * Engine Decision Log Model
 * 
 * Stores Engine V2 decisions for ML training
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IEngineDecisionLog extends Document {
  subject: { kind: string; id: string };
  window: string;
  computedAt: Date;

  decision: string;
  confidenceBand: string;

  scores: {
    evidence: number;
    direction: number;
    risk: number;
    coverage: number;
    confidence: number;
  };

  gating: {
    blocked: boolean;
    reasons: string[];
    minCoverageToTrade: number;
  };

  health: {
    engineStatus: string;
    driftFlags: string[];
  };

  notes: {
    riskNotes: string[];
    coverageNotes: string[];
    evidenceNotes: string[];
  };

  topSignals: Array<{
    signalId: string;
    kind: string;
    contribution: number;
    confidence: number;
    ageHours: number;
    direction: number;
  }>;

  shadow: {
    enabled: boolean;
    v1Decision?: string;
    v2Decision?: string;
    decisionChanged?: boolean;
  };

  price0?: number;
  priceSource?: string;

  meta: {
    engineVersion: string;
  };
}

const EngineDecisionLogSchema = new Schema<IEngineDecisionLog>({
  subject: {
    kind: { type: String, required: true },
    id: { type: String, required: true },
  },

  window: { type: String, enum: ['1h', '6h', '24h', '7d'], required: true },
  computedAt: { type: Date, default: Date.now },

  decision: { type: String },
  confidenceBand: { type: String },

  scores: {
    evidence: { type: Number },
    direction: { type: Number },
    risk: { type: Number },
    coverage: { type: Number },
    confidence: { type: Number },
  },

  gating: {
    blocked: { type: Boolean },
    reasons: [{ type: String }],
    minCoverageToTrade: { type: Number },
  },

  health: {
    engineStatus: { type: String },
    driftFlags: [{ type: String }],
  },

  notes: {
    riskNotes: [{ type: String }],
    coverageNotes: [{ type: String }],
    evidenceNotes: [{ type: String }],
  },

  topSignals: [{
    signalId: { type: String },
    kind: { type: String },
    contribution: { type: Number },
    confidence: { type: Number },
    ageHours: { type: Number },
    direction: { type: Number },
  }],

  shadow: {
    enabled: { type: Boolean, default: false },
    v1Decision: { type: String },
    v2Decision: { type: String },
    decisionChanged: { type: Boolean },
  },

  price0: { type: Number },
  priceSource: { type: String },

  meta: {
    engineVersion: { type: String, default: 'v2' },
  },
}, { timestamps: true });

// Indexes for efficient queries
EngineDecisionLogSchema.index({ 'subject.id': 1, window: 1, computedAt: -1 });
EngineDecisionLogSchema.index({ computedAt: -1 });
EngineDecisionLogSchema.index({ window: 1, decision: 1 });

// TTL: 365 days
EngineDecisionLogSchema.index({ computedAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

// Check if model already exists to prevent OverwriteModelError
export const EngineDecisionLogModel = mongoose.models.EngineDecisionLog || mongoose.model<IEngineDecisionLog>(
  'EngineDecisionLog',
  EngineDecisionLogSchema,
  'engine_decision_logs'
);
