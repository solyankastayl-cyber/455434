/**
 * P2.3 Dataset Builder - Models & Types
 * 
 * ML-ready datasets joining features with labels
 */

import mongoose, { Schema } from 'mongoose';

// ============================================
// 1. DATASET MARKET
// ============================================

export interface IDatasetMarket {
  network: string;
  asset: string;
  ts: number;
  horizon: string;
  
  // Features (v2)
  exchangePressure: number;
  accZoneStrength: number;
  distZoneStrength: number;
  corridorsEntropy: number;
  marketRegime: string;
  
  // === V3.0 PACK A FEATURES ===
  
  // A) CEX Pressure v3
  cexPressure_5m?: number;
  cexPressure_1h?: number;
  cexPressure_1d?: number;
  cexInDelta?: number;
  cexOutDelta?: number;
  cexSpikeLevel?: string;
  
  // B) Zones v3
  zonePersistence_7d?: number;
  zonePersistence_30d?: number;
  zoneDecayScore?: number;
  zoneQualityScore?: number;
  
  // C) Corridors v3 (aggregated)
  corridorPersistence?: number;
  corridorRepeatRate?: number;
  corridorNetFlowTrend?: number;
  corridorEntropy?: number;
  corridorConcentration?: number;
  corridorQualityScore?: number;
  
  // Feature groups metadata
  featureGroups?: {
    cex_v3: boolean;
    zones_v3: boolean;
    corridors_v3: boolean;
  };
  
  // Label
  priceReturnPct: number;
  priceLabel: string;
  
  // Meta
  buildVersion: string;
  createdAt: Date;
}

const DatasetMarketSchema = new Schema<IDatasetMarket>({
  network: { type: String, required: true, index: true },
  asset: { type: String, required: true, index: true },
  ts: { type: Number, required: true, index: true },
  horizon: { type: String, required: true },
  
  // Features v2
  exchangePressure: { type: Number },
  accZoneStrength: { type: Number },
  distZoneStrength: { type: Number },
  corridorsEntropy: { type: Number },
  marketRegime: { type: String },
  
  // === V3.0 PACK A FEATURES ===
  
  // A) CEX Pressure v3
  cexPressure_5m: { type: Number },
  cexPressure_1h: { type: Number },
  cexPressure_1d: { type: Number },
  cexInDelta: { type: Number },
  cexOutDelta: { type: Number },
  cexSpikeLevel: { type: String },
  
  // B) Zones v3
  zonePersistence_7d: { type: Number },
  zonePersistence_30d: { type: Number },
  zoneDecayScore: { type: Number },
  zoneQualityScore: { type: Number },
  
  // C) Corridors v3
  corridorPersistence: { type: Number },
  corridorRepeatRate: { type: Number },
  corridorNetFlowTrend: { type: Number },
  corridorEntropy: { type: Number },
  corridorConcentration: { type: Number },
  corridorQualityScore: { type: Number },
  
  // Feature groups
  featureGroups: {
    cex_v3: { type: Boolean, default: false },
    zones_v3: { type: Boolean, default: false },
    corridors_v3: { type: Boolean, default: false },
  },
  
  priceReturnPct: { type: Number, required: true },
  priceLabel: { type: String, required: true },
  
  buildVersion: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'dataset_market',
});

DatasetMarketSchema.index({ network: 1, asset: 1, ts: -1, horizon: 1 }, { unique: true });

export const DatasetMarketModel = mongoose.models.DatasetMarket || 
  mongoose.model<IDatasetMarket>('DatasetMarket', DatasetMarketSchema);

// ============================================
// 2. DATASET ACTOR
// ============================================

export interface IDatasetActor {
  actorId: string;
  network: string;
  period: string;
  
  // Features
  netFlowUsd: number;
  inflowUsd: number;
  outflowUsd: number;
  flowRatio: number;
  cexExposure: number;
  bridgeUsage: number;
  interactionCount: number;
  influenceScore: number;
  
  // Label
  hitRate: number;
  avgReturn: number;
  performanceLabel: string;
  
  // Meta
  eventCount: number;
  buildVersion: string;
  createdAt: Date;
}

const DatasetActorSchema = new Schema<IDatasetActor>({
  actorId: { type: String, required: true, index: true },
  network: { type: String, required: true, index: true },
  period: { type: String, required: true },
  
  netFlowUsd: { type: Number },
  inflowUsd: { type: Number },
  outflowUsd: { type: Number },
  flowRatio: { type: Number },
  cexExposure: { type: Number },
  bridgeUsage: { type: Number },
  interactionCount: { type: Number },
  influenceScore: { type: Number },
  
  hitRate: { type: Number, required: true },
  avgReturn: { type: Number, required: true },
  performanceLabel: { type: String, required: true },
  
  eventCount: { type: Number, required: true },
  buildVersion: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'dataset_actor',
});

DatasetActorSchema.index({ actorId: 1, network: 1, period: 1 }, { unique: true });

export const DatasetActorModel = mongoose.models.DatasetActor || 
  mongoose.model<IDatasetActor>('DatasetActor', DatasetActorSchema);

// ============================================
// 3. DATASET SIGNAL
// ============================================

export interface IDatasetSignal {
  network: string;
  asset: string;
  ts: number;
  horizon: string;
  
  // Signal
  signalType: string;
  signalStrength: number;
  expectedDirection: string;
  
  // Label
  outcome: string;
  actualDirection: string;
  
  // Meta
  buildVersion: string;
  createdAt: Date;
}

const DatasetSignalSchema = new Schema<IDatasetSignal>({
  network: { type: String, required: true, index: true },
  asset: { type: String, required: true, index: true },
  ts: { type: Number, required: true, index: true },
  horizon: { type: String, required: true },
  
  signalType: { type: String, required: true },
  signalStrength: { type: Number, required: true },
  expectedDirection: { type: String, required: true },
  
  outcome: { type: String, required: true },
  actualDirection: { type: String, required: true },
  
  buildVersion: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'dataset_signal',
});

DatasetSignalSchema.index({ network: 1, asset: 1, ts: -1, signalType: 1 }, { unique: true });

export const DatasetSignalModel = mongoose.models.DatasetSignal || 
  mongoose.model<IDatasetSignal>('DatasetSignal', DatasetSignalSchema);

export default {
  DatasetMarketModel,
  DatasetActorModel,
  DatasetSignalModel,
};
