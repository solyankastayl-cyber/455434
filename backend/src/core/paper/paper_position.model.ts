/**
 * Paper Positions Model (Phase 13.3)
 * 
 * Individual positions within paper portfolios.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type PositionStatus = 'open' | 'closed' | 'stopped_out' | 'take_profit';
export type PriceSource = 'stub' | 'oracle' | 'dex' | 'cex' | 'manual';
export type CloseReason = 
  | 'time_stop' 
  | 'signal_reversal' 
  | 'risk_spike' 
  | 'manual' 
  | 'profit_target' 
  | 'stop_loss'
  | 'portfolio_disabled'
  | 'max_drawdown';

export interface IPaperPosition extends Document {
  _id: Types.ObjectId;
  
  portfolioId: Types.ObjectId;
  userId: string;
  
  // Asset
  assetAddress: string;
  assetSymbol?: string;
  chain: string;
  
  // Entry
  entryTimestamp: Date;
  entryPrice: number;
  entryPriceSource: PriceSource;     // Where did price come from (п.3.1)
  entryPriceTimestamp?: Date;        // When was price fetched
  entrySignalId?: string;
  entryReason: string;
  
  // Size
  sizeUSD: number;
  units: number;                  // sizeUSD / entryPrice
  
  // Current state
  status: PositionStatus;
  currentPrice?: number;
  currentPriceSource?: PriceSource;
  currentPriceTimestamp?: Date;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
  
  // Exit (if closed) (п.3.2)
  exitTimestamp?: Date;
  exitPrice?: number;
  exitPriceSource?: PriceSource;
  exitSignalId?: string;
  exitReason?: CloseReason;          // REQUIRED close reason
  
  // Final PnL
  realizedPnl?: number;
  realizedPnlPct?: number;
  
  // Risk tracking
  maxPrice?: number;
  minPrice?: number;
  maxDrawdownPct?: number;
  
  createdAt: Date;
  updatedAt: Date;
}

const PaperPositionSchema = new Schema<IPaperPosition>(
  {
    portfolioId: {
      type: Schema.Types.ObjectId,
      ref: 'PaperPortfolio',
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    
    assetAddress: { type: String, required: true, lowercase: true, index: true },
    assetSymbol: String,
    chain: { type: String, default: 'ethereum' },
    
    entryTimestamp: { type: Date, required: true },
    entryPrice: { type: Number, required: true },
    entryPriceSource: { 
      type: String, 
      enum: ['stub', 'oracle', 'dex', 'cex', 'manual'],
      default: 'stub',
    },
    entryPriceTimestamp: Date,
    entrySignalId: String,
    entryReason: { type: String, required: true },
    
    sizeUSD: { type: Number, required: true },
    units: { type: Number, required: true },
    
    status: {
      type: String,
      enum: ['open', 'closed', 'stopped_out', 'take_profit'],
      default: 'open',
      index: true,
    },
    currentPrice: Number,
    currentPriceSource: {
      type: String,
      enum: ['stub', 'oracle', 'dex', 'cex', 'manual'],
    },
    currentPriceTimestamp: Date,
    unrealizedPnl: Number,
    unrealizedPnlPct: Number,
    
    exitTimestamp: Date,
    exitPrice: Number,
    exitPriceSource: {
      type: String,
      enum: ['stub', 'oracle', 'dex', 'cex', 'manual'],
    },
    exitSignalId: String,
    exitReason: {
      type: String,
      enum: ['time_stop', 'signal_reversal', 'risk_spike', 'manual', 'profit_target', 'stop_loss', 'portfolio_disabled', 'max_drawdown'],
    },
    
    realizedPnl: Number,
    realizedPnlPct: Number,
    
    maxPrice: Number,
    minPrice: Number,
    maxDrawdownPct: Number,
  },
  {
    timestamps: true,
    collection: 'paper_positions',
  }
);

// Indexes
PaperPositionSchema.index({ portfolioId: 1, status: 1 });
PaperPositionSchema.index({ userId: 1, status: 1, createdAt: -1 });
PaperPositionSchema.index({ assetAddress: 1, status: 1 });

export const PaperPositionModel = mongoose.model<IPaperPosition>(
  'PaperPosition',
  PaperPositionSchema
);
