/**
 * SNAPSHOT MODULE — MongoDB Model
 */

import mongoose, { Schema, Document } from 'mongoose';
import { DecisionSnapshot } from '../contracts/snapshot.types.js';

const SnapshotSchema = new Schema({
  snapshotId: { type: String, required: true, unique: true, index: true },
  
  symbol: { type: String, required: true, index: true },
  timestamp: { type: Number, required: true },
  
  action: { type: String, required: true, enum: ['BUY', 'SELL', 'AVOID'] },
  confidence: { type: Number, required: true },
  
  explainability: {
    verdict: { type: String, required: true, enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    appliedRules: [{ type: String }],
    blockedBy: { type: String },
    riskFlags: {
      whaleRisk: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'] },
      marketStress: { type: String, enum: ['NORMAL', 'ELEVATED', 'EXTREME'] },
      contradiction: { type: Boolean },
      liquidationRisk: { type: Boolean },
    },
    drivers: [{ type: String }],
  },
  
  sourceMeta: {
    dataMode: { type: String, required: true, enum: ['LIVE', 'MIXED', 'MOCK'] },
    providersCount: { type: Number },
    mlReady: { type: Boolean },
    systemVersion: { type: String },
  },
  
  createdAt: { type: Number, required: true },
  expiresAt: { type: Number },
}, {
  collection: 'snapshots',
});

// TTL index for auto-expiration
SnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
SnapshotSchema.index({ createdAt: -1 });

export const SnapshotModel = mongoose.model<DecisionSnapshot & Document>('Snapshot', SnapshotSchema);
