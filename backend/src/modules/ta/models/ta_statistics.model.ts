/**
 * TA Statistics Model - Mongoose schema for pattern performance stats
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ITaStatistics extends Document {
  statsId: string;
  asset: string;
  patternType: string;
  timeframe: string;
  
  // Performance metrics
  totalSignals: number;
  wins: number;
  losses: number;
  partials: number;
  
  winRate: number;
  avgReturn: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  
  // Risk metrics
  maxDrawdown: number;
  avgDrawdown: number;
  sharpeRatio?: number;
  
  // Timing
  avgDuration: number; // hours
  
  // Period
  periodStart: Date;
  periodEnd: Date;
  updatedAt: Date;
  
  // Breakdown by regime
  byRegime?: Record<string, {
    winRate: number;
    avgReturn: number;
    signals: number;
  }>;
  
  metadata?: Record<string, any>;
}

const TaStatisticsSchema = new Schema<ITaStatistics>({
  statsId: { type: String, required: true, unique: true },
  asset: { type: String, required: true, index: true },
  patternType: { type: String, required: true, index: true },
  timeframe: { type: String, required: true },
  
  totalSignals: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  partials: { type: Number, default: 0 },
  
  winRate: { type: Number, default: 0 },
  avgReturn: { type: Number, default: 0 },
  avgWin: { type: Number, default: 0 },
  avgLoss: { type: Number, default: 0 },
  profitFactor: { type: Number, default: 0 },
  expectancy: { type: Number, default: 0 },
  
  maxDrawdown: { type: Number, default: 0 },
  avgDrawdown: { type: Number, default: 0 },
  sharpeRatio: { type: Number },
  
  avgDuration: { type: Number, default: 0 },
  
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  updatedAt: { type: Date, default: Date.now },
  
  byRegime: { type: Schema.Types.Mixed },
  
  metadata: { type: Schema.Types.Mixed }
}, {
  timestamps: true,
  collection: 'ta_statistics'
});

// Compound indexes
TaStatisticsSchema.index({ asset: 1, patternType: 1, timeframe: 1 }, { unique: true });
TaStatisticsSchema.index({ winRate: -1 });

export const TaStatisticsModel = mongoose.model<ITaStatistics>('TaStatistics', TaStatisticsSchema);
