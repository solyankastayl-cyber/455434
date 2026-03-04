/**
 * S1.2 - Strategy Backtest Model (MongoDB)
 */
import mongoose, { Schema, Document } from 'mongoose';
import type { BacktestResult, BacktestMetrics, BacktestVerdict, BacktestWindow } from '../types/strategy_backtest.types.js';

export interface IStrategyBacktest extends Document {
  strategyId: string;
  strategyName: string;
  network: 'ethereum' | 'bnb';
  window: BacktestWindow;
  metrics: BacktestMetrics;
  verdict: BacktestVerdict;
  reasons: string[];
  windowStart: Date;
  windowEnd: Date;
  createdAt: Date;
}

const BacktestMetricsSchema = new Schema({
  totalSignals: { type: Number, required: true },
  actionableSignals: { type: Number, required: true },
  hitRate: { type: Number, required: true },
  falsePositiveRate: { type: Number, required: true },
  avgMoveAfterSignal: { type: Number, required: true },
  maxDrawdown: { type: Number, required: true },
  signalFrequency: { type: Number, required: true },
}, { _id: false });

const StrategyBacktestSchema = new Schema<IStrategyBacktest>({
  strategyId: { type: String, required: true, index: true },
  strategyName: { type: String, required: true },
  network: { type: String, required: true, enum: ['ethereum', 'bnb'], index: true },
  window: { type: String, required: true, enum: ['7d', '14d', '30d'] },
  metrics: { type: BacktestMetricsSchema, required: true },
  verdict: { type: String, required: true, enum: ['GOOD', 'MIXED', 'BAD', 'INSUFFICIENT_DATA'] },
  reasons: [{ type: String }],
  windowStart: { type: Date, required: true },
  windowEnd: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

// Compound index for efficient queries
StrategyBacktestSchema.index({ strategyId: 1, network: 1, createdAt: -1 });

export const StrategyBacktestModel = mongoose.model<IStrategyBacktest>(
  'strategy_backtests',
  StrategyBacktestSchema
);

export default StrategyBacktestModel;
