/**
 * Paper Portfolio Model (Phase 13.3)
 * 
 * Virtual portfolios for copy-trading simulation.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type PaperMode = 'copy_actor' | 'copy_strategy' | 'copy_token' | 'custom';

export interface PaperRules {
  maxPositions: number;           // Max concurrent positions
  riskCap: number;                // Max risk score to enter (0-100)
  positionSizeUSD: number;        // Position size in USD
  slippageAssumption: number;     // Assumed slippage %
  
  // Entry conditions
  entrySignalTypes: string[];     // Signal types that trigger entry
  entryMinSeverity: number;
  entryMinConfidence: number;
  
  // Exit conditions
  timeStopHours?: number;         // Auto-exit after N hours
  profitTargetPct?: number;       // Take profit at X%
  stopLossPct?: number;           // Stop loss at -X%
  exitOnRiskSpike?: boolean;      // Exit if risk spikes
  exitOnSignalReversal?: boolean; // Exit on opposite signal
}

export interface IPaperPortfolio extends Document {
  _id: Types.ObjectId;
  
  userId: string;
  name: string;
  description?: string;
  
  // Copy mode
  mode: PaperMode;
  targets: string[];              // Addresses/entities/tokens/strategy types
  
  // Rules
  rules: PaperRules;
  
  // Stats (denormalized for quick access)
  stats: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnlUSD: number;
    winRate: number;
    avgPnlPct: number;
    maxDrawdownPct: number;
    sharpeRatio?: number;
  };
  
  // State
  enabled: boolean;
  openPositions: number;
  totalValueUSD: number;
  
  createdAt: Date;
  updatedAt: Date;
}

const PaperRulesSchema = new Schema(
  {
    maxPositions: { type: Number, default: 5 },
    riskCap: { type: Number, default: 70 },
    positionSizeUSD: { type: Number, default: 1000 },
    slippageAssumption: { type: Number, default: 0.5 },
    entrySignalTypes: { type: [String], default: ['intensity_spike', 'accumulation'] },
    entryMinSeverity: { type: Number, default: 60 },
    entryMinConfidence: { type: Number, default: 0.6 },
    timeStopHours: Number,
    profitTargetPct: Number,
    stopLossPct: Number,
    exitOnRiskSpike: { type: Boolean, default: true },
    exitOnSignalReversal: { type: Boolean, default: true },
  },
  { _id: false }
);

const PaperStatsSchema = new Schema(
  {
    totalTrades: { type: Number, default: 0 },
    winningTrades: { type: Number, default: 0 },
    losingTrades: { type: Number, default: 0 },
    totalPnlUSD: { type: Number, default: 0 },
    winRate: { type: Number, default: 0 },
    avgPnlPct: { type: Number, default: 0 },
    maxDrawdownPct: { type: Number, default: 0 },
    sharpeRatio: Number,
  },
  { _id: false }
);

const PaperPortfolioSchema = new Schema<IPaperPortfolio>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    description: String,
    
    mode: {
      type: String,
      enum: ['copy_actor', 'copy_strategy', 'copy_token', 'custom'],
      required: true,
    },
    targets: { type: [String], required: true },
    
    rules: {
      type: PaperRulesSchema,
      default: {},
    },
    
    stats: {
      type: PaperStatsSchema,
      default: {},
    },
    
    enabled: { type: Boolean, default: true },
    openPositions: { type: Number, default: 0 },
    totalValueUSD: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'paper_portfolios',
  }
);

export const PaperPortfolioModel = mongoose.model<IPaperPortfolio>(
  'PaperPortfolio',
  PaperPortfolioSchema
);
