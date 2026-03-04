/**
 * C2.1.1 — Onchain MongoDB Models
 * ================================
 */

import mongoose, { Schema, Document, Types } from 'mongoose';
import {
  OnchainSnapshot,
  OnchainMetrics,
  OnchainObservation,
  OnchainProviderHealth,
  OnchainProviderStatus,
  OnchainWindow,
} from './onchain.contracts.js';

// ═══════════════════════════════════════════════════════════════
// 1. SNAPSHOT MODEL
// ═══════════════════════════════════════════════════════════════

export interface IOnchainSnapshotDoc extends Document, OnchainSnapshot {
  _id: Types.ObjectId;
  createdAt: Date;
}

const OnchainSnapshotSchema = new Schema<IOnchainSnapshotDoc>({
  symbol: { type: String, required: true, index: true },
  chain: { type: String, required: true, enum: ['bitcoin', 'ethereum', 'solana', 'arbitrum', 'base'] },
  t0: { type: Number, required: true, index: true },
  snapshotTimestamp: { type: Number, required: true },
  window: { type: String, required: true, enum: ['1h', '4h', '24h', '7d'], default: '1h' },
  
  exchangeInflowUsd: { type: Number, default: 0 },
  exchangeOutflowUsd: { type: Number, default: 0 },
  exchangeNetUsd: { type: Number, default: 0 },
  
  netInflowUsd: { type: Number, default: 0 },
  netOutflowUsd: { type: Number, default: 0 },
  netFlowUsd: { type: Number, default: 0 },
  
  activeAddresses: { type: Number, default: 0 },
  txCount: { type: Number, default: 0 },
  feesUsd: { type: Number, default: 0 },
  
  largeTransfersCount: { type: Number, default: 0 },
  largeTransfersVolumeUsd: { type: Number, default: 0 },
  topHolderDeltaUsd: { type: Number },
  
  source: { type: String, enum: ['mock', 'api', 'node'], default: 'mock' },
  sourceProvider: { type: String },
  sourceQuality: { type: Number, default: 0.3 },
  missingFields: [{ type: String }],
  rawDataPoints: { type: Map, of: Schema.Types.Mixed },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: false },
  collection: 'c2_onchain_snapshots',
});

OnchainSnapshotSchema.index({ symbol: 1, t0: 1, window: 1 }, { unique: true });
OnchainSnapshotSchema.index({ t0: -1 });

export const OnchainSnapshotModel = mongoose.models.C2OnchainSnapshot ||
  mongoose.model<IOnchainSnapshotDoc>('C2OnchainSnapshot', OnchainSnapshotSchema);

// ═══════════════════════════════════════════════════════════════
// 2. OBSERVATION MODEL
// ═══════════════════════════════════════════════════════════════

export interface IOnchainObservationDoc extends Document {
  _id: Types.ObjectId;
  id: string;
  symbol: string;
  t0: number;
  window: OnchainWindow;
  snapshot: OnchainSnapshot;
  metrics: OnchainMetrics;
  diagnostics: OnchainObservation['diagnostics'];
  createdAt: number;
  updatedAt: number;
}

const OnchainMetricsSubSchema = new Schema({
  symbol: String,
  t0: Number,
  window: String,
  flowScore: { type: Number, default: 0 },
  exchangePressure: { type: Number, default: 0 },
  whaleActivity: { type: Number, default: 0 },
  networkHeat: { type: Number, default: 0 },
  velocity: { type: Number, default: 0 },
  distributionSkew: { type: Number, default: 0 },
  dataCompleteness: { type: Number, default: 0 },
  confidence: { type: Number, default: 0 },
  drivers: [String],
  missing: [String],
  rawScores: {
    flowRaw: Number,
    exchangeRaw: Number,
    whaleRaw: Number,
    heatRaw: Number,
    velocityRaw: Number,
    skewRaw: Number,
  },
}, { _id: false });

const OnchainObservationSchema = new Schema<IOnchainObservationDoc>({
  id: { type: String, required: true, unique: true },
  symbol: { type: String, required: true, index: true },
  t0: { type: Number, required: true, index: true },
  window: { type: String, required: true, enum: ['1h', '4h', '24h', '7d'], default: '1h' },
  
  snapshot: { type: Schema.Types.Mixed, required: true },
  metrics: { type: OnchainMetricsSubSchema, required: true },
  diagnostics: { type: Schema.Types.Mixed, required: true },
  
  createdAt: { type: Number, required: true },
  updatedAt: { type: Number, required: true },
}, {
  collection: 'c2_onchain_observations',
});

OnchainObservationSchema.index({ symbol: 1, t0: -1 });
OnchainObservationSchema.index({ symbol: 1, t0: 1, window: 1 }, { unique: true });

export const OnchainObservationModel = mongoose.models.C2OnchainObservation ||
  mongoose.model<IOnchainObservationDoc>('C2OnchainObservation', OnchainObservationSchema);

// ═══════════════════════════════════════════════════════════════
// 3. PROVIDER HEALTH MODEL
// ═══════════════════════════════════════════════════════════════

export interface IOnchainProviderHealthDoc extends Document, OnchainProviderHealth {
  _id: Types.ObjectId;
}

const OnchainProviderHealthSchema = new Schema<IOnchainProviderHealthDoc>({
  providerId: { type: String, required: true, unique: true },
  providerName: { type: String, required: true },
  status: { type: String, enum: ['UP', 'DEGRADED', 'DOWN'], default: 'DOWN' },
  chains: [{ type: String }],
  lastSuccessAt: { type: Number, default: 0 },
  lastError: String,
  lastErrorAt: Number,
  successRate24h: { type: Number, default: 0 },
  avgLatencyMs: { type: Number, default: 0 },
  checkedAt: { type: Number, required: true },
}, {
  collection: 'c2_onchain_provider_health',
});

export const OnchainProviderHealthModel = mongoose.models.C2OnchainProviderHealth ||
  mongoose.model<IOnchainProviderHealthDoc>('C2OnchainProviderHealth', OnchainProviderHealthSchema);

console.log('[C2.1] Onchain Models loaded');
