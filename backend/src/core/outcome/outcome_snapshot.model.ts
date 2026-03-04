/**
 * Outcome Snapshot Model (Block F - F0)
 * 
 * Фиксирует момент принятия решения системой
 * "Точка истины" - что думала система в момент рекомендации
 * 
 * Создается каждый раз когда:
 * - Токен попадает в bucket (или меняет bucket)
 * - Запускается ranking computation
 */
import mongoose, { Schema } from 'mongoose';

export interface IOutcomeSnapshot {
  // Token identity
  tokenAddress: string;
  symbol: string;
  chainId: number;
  
  // Decision made
  bucket: 'BUY' | 'WATCH' | 'SELL';
  decisionScore: number;
  confidence: number;
  risk: number;
  
  // Context at decision
  coverage: number;
  coverageLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  engineMode: 'rules_only' | 'rules_with_actors' | 'rules_with_engine' | 'rules_with_ml';
  
  // Active signals
  activeSignals: string[];
  actorSignalScore?: number;
  dexFlowActive: boolean;
  whaleSignalsActive: boolean;
  conflictDetected: boolean;
  
  // Market snapshot
  priceAtDecision: number;
  marketCapAtDecision: number;
  volumeAtDecision: number;
  
  // Metadata
  decidedAt: Date;
  rankingRunId?: string; // Link to specific ranking computation
  
  // Outcome tracking status
  tracked24h: boolean;
  tracked72h: boolean;
  tracked7d: boolean;
  
  // Indexes for queries
  createdAt: Date;
  updatedAt: Date;
}

const OutcomeSnapshotSchema = new Schema<IOutcomeSnapshot>({
  tokenAddress: { type: String, required: true, lowercase: true, index: true },
  symbol: { type: String, required: true, index: true },
  chainId: { type: Number, default: 1 },
  
  bucket: { 
    type: String, 
    enum: ['BUY', 'WATCH', 'SELL'],
    required: true,
    index: true,
  },
  decisionScore: { type: Number, required: true },
  confidence: { type: Number, required: true },
  risk: { type: Number, required: true },
  
  coverage: { type: Number, required: true },
  coverageLevel: { 
    type: String, 
    enum: ['LOW', 'MEDIUM', 'HIGH'],
    required: true,
  },
  engineMode: {
    type: String,
    enum: ['rules_only', 'rules_with_actors', 'rules_with_engine', 'rules_with_ml'],
    required: true,
  },
  
  activeSignals: [{ type: String }],
  actorSignalScore: { type: Number },
  dexFlowActive: { type: Boolean, default: false },
  whaleSignalsActive: { type: Boolean, default: false },
  conflictDetected: { type: Boolean, default: false },
  
  priceAtDecision: { type: Number, required: true },
  marketCapAtDecision: { type: Number, required: true },
  volumeAtDecision: { type: Number, required: true },
  
  decidedAt: { type: Date, required: true, index: true },
  rankingRunId: { type: String },
  
  tracked24h: { type: Boolean, default: false },
  tracked72h: { type: Boolean, default: false },
  tracked7d: { type: Boolean, default: false },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  collection: 'outcome_snapshots',
  timestamps: true,
});

// Compound indexes
OutcomeSnapshotSchema.index({ tokenAddress: 1, decidedAt: -1 });
OutcomeSnapshotSchema.index({ bucket: 1, decidedAt: -1 });
OutcomeSnapshotSchema.index({ tracked24h: 1, decidedAt: 1 });
OutcomeSnapshotSchema.index({ tracked72h: 1, decidedAt: 1 });
OutcomeSnapshotSchema.index({ tracked7d: 1, decidedAt: 1 });

export const OutcomeSnapshotModel = mongoose.model<IOutcomeSnapshot>('OutcomeSnapshot', OutcomeSnapshotSchema);
