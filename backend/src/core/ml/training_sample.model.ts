/**
 * Training Sample Model (Block F4)
 * 
 * Чистый, объяснимый training dataset для ML
 * Каждая строка: "Вот решение → вот результат → вот почему"
 * 
 * Правило: НЕТ sample без attribution
 * Quality gates фильтруют мусор
 */
import mongoose, { Schema } from 'mongoose';

export interface ITrainingSample {
  // Links
  snapshotId: mongoose.Types.ObjectId;
  attributionId: mongoose.Types.ObjectId;
  tokenAddress: string;
  symbol: string;
  
  // Input Features (на момент решения)
  features: {
    dexFlow: number;
    whale: number;
    conflict: number;
    momentum: number;
    volatility: number;
    liquidity: number;
    coverage: number;
    confidence: number;
    risk: number;
  };
  
  // Context
  bucket: 'BUY' | 'WATCH' | 'SELL';
  engineMode: string;
  signalFreshness: string;
  
  // Labels (что произошло)
  outcomeLabel: 'SUCCESS' | 'FLAT' | 'FAIL';
  severity: number; // 0..1
  deltaPct: number;
  
  // Attribution (почему)
  dominantSignals: string[];
  misleadingSignals: string[];
  confidenceDelta: number;
  
  // Quality Metrics
  qualityScore: number; // 0..1 (фильтрация)
  
  // Metadata
  timestamp: Date;
  windowHours: 24 | 72 | 168;
  
  // ML usage
  usedInTraining: boolean;
  
  // S3: Simulation markers
  source?: 'live' | 'simulated';
  simulationVersion?: string;
  
  createdAt: Date;
}

const TrainingSampleSchema = new Schema<ITrainingSample>({
  snapshotId: { 
    type: Schema.Types.ObjectId, 
    required: false, // Not required for synthetic samples
    ref: 'OutcomeSnapshot',
    index: true,
  },
  attributionId: { 
    type: Schema.Types.ObjectId, 
    required: false, // Not required for synthetic samples
    ref: 'OutcomeAttribution',
    index: true,
  },
  tokenAddress: { type: String, required: true, lowercase: true },
  symbol: { type: String, required: true },
  
  features: {
    dexFlow: { type: Number, required: true },
    whale: { type: Number, required: true },
    conflict: { type: Number, required: true },
    momentum: { type: Number, required: true },
    volatility: { type: Number, required: true },
    liquidity: { type: Number, required: true },
    coverage: { type: Number, required: true },
    confidence: { type: Number, required: true },
    risk: { type: Number, required: true },
  },
  
  bucket: { 
    type: String, 
    enum: ['BUY', 'WATCH', 'SELL'],
    required: true,
    index: true,
  },
  engineMode: { type: String, required: true },
  signalFreshness: { type: String },
  
  outcomeLabel: {
    type: String,
    enum: ['SUCCESS', 'FLAT', 'FAIL'],
    required: true,
    index: true,
  },
  severity: { 
    type: Number, 
    required: true,
    min: 0,
    max: 1,
  },
  deltaPct: { type: Number, required: true },
  
  dominantSignals: [{ type: String }],
  misleadingSignals: [{ type: String }],
  confidenceDelta: { type: Number, required: true },
  
  qualityScore: { 
    type: Number, 
    required: true,
    min: 0,
    max: 1,
    index: true,
  },
  
  timestamp: { type: Date, required: true, index: true },
  windowHours: { 
    type: Number, 
    enum: [24, 72, 168],
    required: true,
  },
  
  usedInTraining: { type: Boolean, default: false },
  
  // S3: Simulation markers
  source: { type: String, enum: ['live', 'simulated'], default: 'live', index: true },
  simulationVersion: { type: String },
  
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'training_samples',
  timestamps: false,
});

// Compound indexes for ML queries
TrainingSampleSchema.index({ bucket: 1, outcomeLabel: 1, qualityScore: -1 });
TrainingSampleSchema.index({ qualityScore: -1, usedInTraining: 1 });
TrainingSampleSchema.index({ timestamp: -1 });
TrainingSampleSchema.index({ source: 1, createdAt: -1 });

export const TrainingSampleModel = mongoose.model<ITrainingSample>('TrainingSample', TrainingSampleSchema);
