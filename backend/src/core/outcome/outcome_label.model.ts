/**
 * Outcome Label Model (Block F - F2)
 * 
 * Оценивает результат: SUCCESS / FLAT / FAIL
 * Правила зависят от bucket:
 * 
 * BUY:
 *   SUCCESS: delta ≥ +5%
 *   FLAT: -3% to +5%
 *   FAIL: delta ≤ -3%
 * 
 * WATCH:
 *   SUCCESS: delta within ±5% (stability)
 *   FLAT: delta within ±10%
 *   FAIL: |delta| > 10% (missed signal)
 * 
 * SELL:
 *   SUCCESS: delta ≤ -5%
 *   FLAT: -5% to +3%
 *   FAIL: delta ≥ +3%
 */
import mongoose, { Schema } from 'mongoose';

export type OutcomeType = 'SUCCESS' | 'FLAT' | 'FAIL';

export interface IOutcomeLabel {
  // Links
  snapshotId: mongoose.Types.ObjectId;
  resultId: mongoose.Types.ObjectId;
  tokenAddress: string;
  symbol: string;
  bucket: 'BUY' | 'WATCH' | 'SELL';
  
  // Window
  windowHours: 24 | 72 | 168;
  
  // Label
  outcome: OutcomeType;
  severity: number; // 0..1 (how strong the outcome)
  
  // Metrics
  deltaPct: number;
  confidenceAtDecision: number;
  coverageAtDecision: string;
  
  // Reasoning
  reasons: string[];
  
  // S3: Simulation markers
  source?: 'live' | 'simulated';
  simulationVersion?: string;
  
  // Metadata
  labeledAt: Date;
  decidedAt: Date;
  createdAt?: Date;
}

const OutcomeLabelSchema = new Schema<IOutcomeLabel>({
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
  tokenAddress: { type: String, required: true, lowercase: true },
  symbol: { type: String, required: true },
  bucket: { 
    type: String, 
    enum: ['BUY', 'WATCH', 'SELL'],
    required: true,
    index: true,
  },
  
  windowHours: { 
    type: Number, 
    enum: [24, 72, 168],
    required: true,
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
  
  deltaPct: { type: Number, required: true },
  confidenceAtDecision: { type: Number, default: 50 },
  coverageAtDecision: { type: String, default: 'LOW' },
  
  reasons: [{ type: String }],
  
  // S3: Simulation markers
  source: { type: String, enum: ['live', 'simulated'], default: 'live', index: true },
  simulationVersion: { type: String },
  
  labeledAt: { type: Date },
  decidedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'outcome_labels',
  timestamps: false,
});

// Compound indexes
OutcomeLabelSchema.index({ snapshotId: 1, windowHours: 1 });
OutcomeLabelSchema.index({ outcome: 1, bucket: 1, windowHours: 1 });
OutcomeLabelSchema.index({ bucket: 1, labeledAt: -1 });
OutcomeLabelSchema.index({ source: 1, createdAt: -1 });

export const OutcomeLabelModel = mongoose.model<IOutcomeLabel>('OutcomeLabel', OutcomeLabelSchema);
