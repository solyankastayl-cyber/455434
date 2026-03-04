/**
 * Price Label Store
 * 
 * EPIC 9: MongoDB models for price reaction labels
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { 
  PriceLabel, 
  PriceLabelRunStats,
  Reaction24hLabel,
  Reaction7dLabel,
  PriceLabelPair,
  PriceMetrics24h,
  PriceMetrics7d
} from './price_label.types.js';

// ============================================
// Price Label Model
// ============================================

export interface IPriceLabel extends Document {
  labelId: string;
  tokenAddress: string;
  signalId?: string;
  signalTimestamp: Date;
  
  label24h: Reaction24hLabel;
  label7d: Reaction7dLabel;
  pairLabel: PriceLabelPair;
  
  metrics24h: PriceMetrics24h;
  metrics7d: PriceMetrics7d;
  
  binaryLabel: number;
  
  createdAt: Date;
  runId: string;
  gateVersion: string;
  priceSource: string;
}

const PriceMetrics24hSchema = new Schema({
  priceAtSignal: Number,
  priceAt24h: Number,
  maxPrice24h: Number,
  minPrice24h: Number,
  returnPct: Number,
  maxUpsidePct: Number,
  maxDrawdownPct: Number,
  volatility24h: Number,
}, { _id: false });

const PriceMetrics7dSchema = new Schema({
  priceAtSignal: Number,
  priceAt7d: Number,
  maxPrice7d: Number,
  minPrice7d: Number,
  timeToPeakHours: Number,
  returnPct: Number,
  maxUpsidePct: Number,
  maxDrawdownPct: Number,
  trendConsistency: Number,
}, { _id: false });

const PairLabelSchema = new Schema({
  label24h: String,
  label7d: String,
  signalQuality: String,
}, { _id: false });

const PriceLabelSchema = new Schema<IPriceLabel>({
  labelId: { type: String, required: true, unique: true },
  tokenAddress: { type: String, required: true, index: true },
  signalId: { type: String, index: true },
  signalTimestamp: { type: Date, required: true, index: true },
  
  label24h: { type: String, enum: ['STRONG_UP', 'WEAK_UP', 'FLAT', 'DOWN'], required: true },
  label7d: { type: String, enum: ['FOLLOW_THROUGH', 'FADED', 'REVERSED', 'NOISE'], required: true },
  pairLabel: PairLabelSchema,
  
  metrics24h: PriceMetrics24hSchema,
  metrics7d: PriceMetrics7dSchema,
  
  binaryLabel: { type: Number, enum: [0, 1], required: true, index: true },
  
  createdAt: { type: Date, default: Date.now, index: true },
  runId: { type: String, required: true, index: true },
  gateVersion: { type: String, required: true },
  priceSource: { type: String, required: true },
});

// Indexes
PriceLabelSchema.index({ label24h: 1, label7d: 1 });
PriceLabelSchema.index({ 'pairLabel.signalQuality': 1 });
PriceLabelSchema.index({ tokenAddress: 1, signalTimestamp: -1 });

export const PriceLabelModel = mongoose.model<IPriceLabel>('ml_price_labels', PriceLabelSchema);

// ============================================
// Price Label Run Model
// ============================================

export interface IPriceLabelRun extends Document {
  runId: string;
  startedAt: Date;
  completedAt?: Date;
  status: string;
  
  signalsProcessed: number;
  labelsGenerated: number;
  insufficientData: number;
  
  distribution24h: Record<string, number>;
  distribution7d: Record<string, number>;
  qualityDistribution: Record<string, number>;
  
  positiveRatio: number;
  errors: string[];
  
  config: {
    maxSignals: number;
    priceSource: string;
  };
}

const PriceLabelRunSchema = new Schema<IPriceLabelRun>({
  runId: { type: String, required: true, unique: true },
  startedAt: { type: Date, required: true },
  completedAt: Date,
  status: { type: String, enum: ['RUNNING', 'COMPLETED', 'FAILED'], default: 'RUNNING' },
  
  signalsProcessed: { type: Number, default: 0 },
  labelsGenerated: { type: Number, default: 0 },
  insufficientData: { type: Number, default: 0 },
  
  distribution24h: { type: Schema.Types.Mixed, default: {} },
  distribution7d: { type: Schema.Types.Mixed, default: {} },
  qualityDistribution: { type: Schema.Types.Mixed, default: {} },
  
  positiveRatio: { type: Number, default: 0 },
  errors: [String],
  
  config: {
    maxSignals: Number,
    priceSource: String,
  },
});

PriceLabelRunSchema.index({ startedAt: -1 });

export const PriceLabelRunModel = mongoose.model<IPriceLabelRun>('ml_price_label_runs', PriceLabelRunSchema);

// ============================================
// Store Functions
// ============================================

export async function savePriceLabel(label: PriceLabel): Promise<string> {
  const doc = await PriceLabelModel.create(label);
  return doc.labelId;
}

export async function savePriceLabelsBatch(labels: PriceLabel[]): Promise<number> {
  if (labels.length === 0) return 0;
  const result = await PriceLabelModel.insertMany(labels, { ordered: false });
  return result.length;
}

export async function createLabelRun(
  runId: string,
  config: { maxSignals: number; priceSource: string }
): Promise<void> {
  await PriceLabelRunModel.create({
    runId,
    startedAt: new Date(),
    status: 'RUNNING',
    config,
    distribution24h: { STRONG_UP: 0, WEAK_UP: 0, FLAT: 0, DOWN: 0 },
    distribution7d: { FOLLOW_THROUGH: 0, FADED: 0, REVERSED: 0, NOISE: 0 },
    qualityDistribution: {},
  });
}

export async function completeLabelRun(runId: string, stats: Partial<PriceLabelRunStats>): Promise<void> {
  await PriceLabelRunModel.updateOne(
    { runId },
    {
      $set: {
        ...stats,
        completedAt: new Date(),
        status: 'COMPLETED',
      }
    }
  );
}

export async function failLabelRun(runId: string, error: string): Promise<void> {
  await PriceLabelRunModel.updateOne(
    { runId },
    {
      $set: { completedAt: new Date(), status: 'FAILED' },
      $push: { errors: error }
    }
  );
}

export async function getLabelRun(runId: string): Promise<IPriceLabelRun | null> {
  return PriceLabelRunModel.findOne({ runId }).lean();
}

export async function getRecentLabelRuns(limit: number = 20): Promise<IPriceLabelRun[]> {
  return PriceLabelRunModel.find()
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean();
}

export async function getPriceLabelStats(): Promise<{
  total: number;
  positive: number;
  negative: number;
  distribution24h: Record<string, number>;
  distribution7d: Record<string, number>;
  qualityDistribution: Record<string, number>;
}> {
  const [total, positive, dist24h, dist7d, qualityDist] = await Promise.all([
    PriceLabelModel.countDocuments(),
    PriceLabelModel.countDocuments({ binaryLabel: 1 }),
    PriceLabelModel.aggregate([
      { $group: { _id: '$label24h', count: { $sum: 1 } } }
    ]),
    PriceLabelModel.aggregate([
      { $group: { _id: '$label7d', count: { $sum: 1 } } }
    ]),
    PriceLabelModel.aggregate([
      { $group: { _id: '$pairLabel.signalQuality', count: { $sum: 1 } } }
    ]),
  ]);
  
  return {
    total,
    positive,
    negative: total - positive,
    distribution24h: dist24h.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {}),
    distribution7d: dist7d.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {}),
    qualityDistribution: qualityDist.reduce((acc, r) => { acc[r._id || 'UNKNOWN'] = r.count; return acc; }, {}),
  };
}

export async function getLabelsByToken(tokenAddress: string, limit: number = 100): Promise<IPriceLabel[]> {
  return PriceLabelModel.find({ tokenAddress })
    .sort({ signalTimestamp: -1 })
    .limit(limit)
    .lean();
}
