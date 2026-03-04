/**
 * Outcome Result Model (Block F - F1)
 * 
 * Фиксирует что произошло после решения
 * Измеряет через фиксированные окна: T+24h, T+72h, T+7d
 */
import mongoose, { Schema } from 'mongoose';

export interface IOutcomeResult {
  // Link to snapshot
  snapshotId: mongoose.Types.ObjectId;
  tokenAddress: string;
  symbol: string;
  bucket: 'BUY' | 'WATCH' | 'SELL';
  
  // Timing window
  windowHours: 24 | 72 | 168; // 24h, 72h, 7d
  
  // Price changes
  priceAtDecision: number;
  priceAfter: number;
  deltaPct: number;
  deltaAbs: number;
  
  // Risk metrics
  maxDrawdown: number; // Worst drop during window
  volatility: number;   // Price volatility
  
  // Market context during window
  marketCapChange: number;
  volumeChange: number;
  
  // Evaluation
  evaluatedAt: Date;
  decidedAt: Date;
  
  // S3: Simulation markers
  source?: 'live' | 'simulated';
  simulationVersion?: string;
  
  // Metadata
  createdAt: Date;
}

const OutcomeResultSchema = new Schema<IOutcomeResult>({
  snapshotId: { 
    type: Schema.Types.ObjectId, 
    required: true, 
    ref: 'OutcomeSnapshot',
    index: true,
  },
  tokenAddress: { type: String, required: true, lowercase: true, index: true },
  symbol: { type: String, required: true },
  bucket: { 
    type: String, 
    enum: ['BUY', 'WATCH', 'SELL'],
    required: true,
  },
  
  windowHours: { 
    type: Number, 
    enum: [24, 72, 168],
    required: true,
    index: true,
  },
  
  priceAtDecision: { type: Number, required: true },
  priceAfter: { type: Number, required: true },
  deltaPct: { type: Number, required: true },
  deltaAbs: { type: Number, default: 0 },
  
  maxDrawdown: { type: Number, default: 0 },
  volatility: { type: Number, default: 0 },
  
  marketCapChange: { type: Number, default: 0 },
  volumeChange: { type: Number, default: 0 },
  
  evaluatedAt: { type: Date },
  decidedAt: { type: Date },
  trackedAt: { type: Date },
  
  // S3: Simulation markers
  source: { type: String, enum: ['live', 'simulated'], default: 'live', index: true },
  simulationVersion: { type: String },
  
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'outcome_results',
  timestamps: false,
});

// Compound indexes
OutcomeResultSchema.index({ snapshotId: 1, windowHours: 1 }, { unique: true });
OutcomeResultSchema.index({ bucket: 1, windowHours: 1, evaluatedAt: -1 });
OutcomeResultSchema.index({ tokenAddress: 1, evaluatedAt: -1 });
OutcomeResultSchema.index({ source: 1, createdAt: -1 });

export const OutcomeResultModel = mongoose.model<IOutcomeResult>('OutcomeResult', OutcomeResultSchema);
