/**
 * Outcome Attribution Model (Block F3)
 * 
 * Отвечает на вопрос: ПОЧЕМУ система была права или ошиблась?
 * 
 * Для каждого outcome определяет:
 * 1. Какие сигналы реально повлияли (dominant)
 * 2. Какие сигналы были ложными (misleading)
 * 3. Чего не хватило (missing/blind spots)
 * 4. Как это должно изменить confidence
 * 
 * Rule-based causal attribution, НЕ ML black box
 */
import mongoose, { Schema } from 'mongoose';

export interface IOutcomeAttribution {
  // Links
  snapshotId: mongoose.Types.ObjectId;
  resultId: mongoose.Types.ObjectId;
  labelId: mongoose.Types.ObjectId;
  tokenAddress: string;
  symbol: string;
  
  // Context
  bucket: 'BUY' | 'WATCH' | 'SELL';
  outcome: 'SUCCESS' | 'FLAT' | 'FAIL';
  severity: number; // 0..1
  windowHours: 24 | 72 | 168;
  
  // Signal Contributions (relative influence)
  signalContributions: {
    dexFlow: number;
    whale: number;
    conflict: number;
    momentum: number;
    volatility: number;
    liquidity: number;
  };
  
  // Attribution Results
  dominantSignals: string[];      // Что помогло (положительный вклад)
  misleadingSignals: string[];    // Что подвело (ложный сигнал)
  missingSignals: string[];       // Чего не хватило (blind spot)
  
  // Feedback для системы
  confidenceDelta: number;        // Рекомендация изменения confidence (-20..+20)
  
  // Reasoning (для объяснения)
  reasons: string[];
  
  // S3: Simulation markers
  source?: 'live' | 'simulated';
  simulationVersion?: string;
  
  // Metadata
  createdAt: Date;
  decidedAt: Date;
}

const OutcomeAttributionSchema = new Schema<IOutcomeAttribution>({
  snapshotId: { 
    type: Schema.Types.ObjectId, 
    required: true, 
    ref: 'OutcomeSnapshot',
    index: true,
  },
  resultId: { 
    type: Schema.Types.ObjectId, 
    required: true, 
    ref: 'OutcomeResult',
  },
  labelId: { 
    type: Schema.Types.ObjectId, 
    required: true, 
    ref: 'OutcomeLabel',
  },
  tokenAddress: { type: String, required: true, lowercase: true, index: true },
  symbol: { type: String, required: true },
  
  bucket: { 
    type: String, 
    enum: ['BUY', 'WATCH', 'SELL'],
    required: true,
    index: true,
  },
  outcome: {
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
  windowHours: { 
    type: Number, 
    enum: [24, 72, 168],
    required: true,
  },
  
  signalContributions: {
    dexFlow: { type: Number, default: 0 },
    whale: { type: Number, default: 0 },
    conflict: { type: Number, default: 0 },
    momentum: { type: Number, default: 0 },
    volatility: { type: Number, default: 0 },
    liquidity: { type: Number, default: 0 },
  },
  
  dominantSignals: [{ type: String }],
  misleadingSignals: [{ type: String }],
  missingSignals: [{ type: String }],
  
  confidenceDelta: { 
    type: Number, 
    required: true,
    min: -20,
    max: 20,
  },
  
  reasons: [{ type: String }],
  
  // S3: Simulation markers
  source: { type: String, enum: ['live', 'simulated'], default: 'live', index: true },
  simulationVersion: { type: String },
  
  createdAt: { type: Date, default: Date.now },
  decidedAt: { type: Date },
}, {
  collection: 'outcome_attributions',
  timestamps: false,
});

// Compound indexes
OutcomeAttributionSchema.index({ snapshotId: 1, windowHours: 1 });
OutcomeAttributionSchema.index({ bucket: 1, outcome: 1, createdAt: -1 });
OutcomeAttributionSchema.index({ tokenAddress: 1, createdAt: -1 });
OutcomeAttributionSchema.index({ source: 1, createdAt: -1 });

export const OutcomeAttributionModel = mongoose.model<IOutcomeAttribution>('OutcomeAttribution', OutcomeAttributionSchema);
