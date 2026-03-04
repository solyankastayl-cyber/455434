/**
 * Rankings V2 Mongoose Model
 * 
 * Stores ranking snapshots for tokens/entities
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IRankingSnapshot extends Document {
  subject: {
    kind: 'entity' | 'actor' | 'wallet';
    id: string;
    symbol?: string;
    address?: string;
  };
  window: '1h' | '6h' | '24h' | '7d';
  computedAt: Date;

  rankScore: number;
  bucket: 'BUY' | 'WATCH' | 'SELL' | 'NEUTRAL';
  bucketReason?: string;

  engine: {
    coverage: number;
    evidence: number;
    direction: number;
    risk: number;
    confidence: number;
  };

  quality: {
    clusterPassRate: number;
    avgDominance: number;
    penaltyRate: number;
    activeSignals: number;
  };

  freshness: {
    avgSignalAgeHours: number;
    freshnessFactor: number;
  };

  lifecycleMix: {
    active: number;
    cooldown: number;
    resolved: number;
  };

  rankTrace: {
    baseEvidence: number;
    lifecycleFactor: number;
    freshnessFactor: number;
    clusterFactor: number;
    penaltyFactor: number;
    antiSpamFactor: number;
    scoreRaw: number;
  };

  topSignals: Array<{
    signalId: string;
    kind: string;
    contribution: number;
    confidence: number;
    ageHours: number;
    direction: number;
  }>;

  meta: {
    engineVersion?: string;
    rankingsVersion: string;
    notes?: string;
  };
}

const RankingSnapshotSchema = new Schema<IRankingSnapshot>({
  subject: {
    kind: { type: String, enum: ['entity', 'actor', 'wallet'], required: true },
    id: { type: String, required: true },
    symbol: { type: String },
    address: { type: String },
  },

  window: { type: String, enum: ['1h', '6h', '24h', '7d'], required: true },
  computedAt: { type: Date, default: Date.now },

  rankScore: { type: Number, min: 0, max: 100, required: true },
  bucket: { type: String, enum: ['BUY', 'WATCH', 'SELL', 'NEUTRAL'], required: true },
  bucketReason: { type: String },

  engine: {
    coverage: { type: Number },
    evidence: { type: Number },
    direction: { type: Number },
    risk: { type: Number },
    confidence: { type: Number },
  },

  quality: {
    clusterPassRate: { type: Number },
    avgDominance: { type: Number },
    penaltyRate: { type: Number },
    activeSignals: { type: Number },
  },

  freshness: {
    avgSignalAgeHours: { type: Number },
    freshnessFactor: { type: Number },
  },

  lifecycleMix: {
    active: { type: Number },
    cooldown: { type: Number },
    resolved: { type: Number },
  },

  rankTrace: {
    baseEvidence: { type: Number },
    lifecycleFactor: { type: Number },
    freshnessFactor: { type: Number },
    clusterFactor: { type: Number },
    penaltyFactor: { type: Number },
    antiSpamFactor: { type: Number },
    scoreRaw: { type: Number },
  },

  topSignals: [{
    signalId: { type: String },
    kind: { type: String },
    contribution: { type: Number },
    confidence: { type: Number },
    ageHours: { type: Number },
    direction: { type: Number },
  }],

  meta: {
    engineVersion: { type: String },
    rankingsVersion: { type: String, default: 'v2' },
    notes: { type: String },
  },

}, { timestamps: true });

// Indexes for efficient queries
RankingSnapshotSchema.index({ 'subject.id': 1, window: 1, computedAt: -1 });
RankingSnapshotSchema.index({ window: 1, bucket: 1 });
RankingSnapshotSchema.index({ window: 1, rankScore: -1 });
RankingSnapshotSchema.index({ computedAt: -1 });

export const RankingSnapshotModel = mongoose.model<IRankingSnapshot>(
  'RankingSnapshot',
  RankingSnapshotSchema,
  'ranking_snapshots'
);
