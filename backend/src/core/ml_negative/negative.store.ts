/**
 * Negative Sample Store
 * 
 * EPIC 8: MongoDB models for negative samples and runs
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { 
  NegativeSample, 
  NegativeRunStats, 
  NegativeType,
  LabelReason 
} from './negative.types.js';

// ============================================
// Negative Sample Model
// ============================================

export interface INegativeSample extends Document {
  sampleId: string;
  tokenAddress: string;
  signalId?: string;
  
  label: 0 | 1;
  labelReason: LabelReason;
  negativeType?: NegativeType;
  
  priceMetrics: {
    futureReturn24h: number;
    futureReturn7d: number;
    pastReturn7d: number;
    maxAdverseExcursion: number;
    maxFavorableExcursion: number;
  };
  
  temporalContext: {
    deltaNetFlow24h: number;
    deltaNetFlow3d: number;
    deltaNetFlow7d: number;
    slope7d: number;
    acceleration7d: number;
    consistency: number;
    regime: string;
  };
  
  signalContext: {
    signalType: string;
    signalStrength: number;
    hasSmartMoney: boolean;
    hasAccumulation: boolean;
  };
  
  horizon: string;
  signalTimestamp: Date;
  createdAt: Date;
  runId: string;
  gateVersion: string;
}

const NegativeSampleSchema = new Schema<INegativeSample>({
  sampleId: { type: String, required: true, unique: true },
  tokenAddress: { type: String, required: true, index: true },
  signalId: { type: String, index: true },
  
  label: { type: Number, enum: [0, 1], required: true, index: true },
  labelReason: { type: String, required: true },
  negativeType: { type: String, enum: ['STRUCTURAL', 'NOISE', 'EXHAUSTION', 'REVERSAL'] },
  
  priceMetrics: {
    futureReturn24h: Number,
    futureReturn7d: Number,
    pastReturn7d: Number,
    maxAdverseExcursion: Number,
    maxFavorableExcursion: Number,
  },
  
  temporalContext: {
    deltaNetFlow24h: Number,
    deltaNetFlow3d: Number,
    deltaNetFlow7d: Number,
    slope7d: Number,
    acceleration7d: Number,
    consistency: Number,
    regime: String,
  },
  
  signalContext: {
    signalType: String,
    signalStrength: Number,
    hasSmartMoney: Boolean,
    hasAccumulation: Boolean,
  },
  
  horizon: { type: String, required: true },
  signalTimestamp: { type: Date, required: true, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
  runId: { type: String, required: true, index: true },
  gateVersion: { type: String, required: true },
});

// Indexes
NegativeSampleSchema.index({ label: 1, negativeType: 1 });
NegativeSampleSchema.index({ runId: 1, label: 1 });
NegativeSampleSchema.index({ tokenAddress: 1, signalTimestamp: -1 });

export const NegativeSampleModel = mongoose.model<INegativeSample>(
  'ml_negative_samples', 
  NegativeSampleSchema
);

// ============================================
// Negative Run Model (history)
// ============================================

export interface INegativeRun extends Document {
  runId: string;
  horizon: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  
  candidatesFound: number;
  samplesGenerated: number;
  positiveCount: number;
  negativeCount: number;
  insufficientCount: number;
  
  byType: {
    STRUCTURAL: number;
    NOISE: number;
    EXHAUSTION: number;
    REVERSAL: number;
  };
  
  negPosRatio: number;
  typeDistribution: Record<string, number>;
  
  limitedTypes: string[];
  reasons: string[];
  
  config: {
    maxCandidates: number;
    targetSamples: number;
    window: string;
  };
}

const NegativeRunSchema = new Schema<INegativeRun>({
  runId: { type: String, required: true, unique: true },
  horizon: { type: String, required: true },
  startedAt: { type: Date, required: true },
  completedAt: Date,
  status: { type: String, enum: ['RUNNING', 'COMPLETED', 'FAILED'], default: 'RUNNING' },
  
  candidatesFound: { type: Number, default: 0 },
  samplesGenerated: { type: Number, default: 0 },
  positiveCount: { type: Number, default: 0 },
  negativeCount: { type: Number, default: 0 },
  insufficientCount: { type: Number, default: 0 },
  
  byType: {
    STRUCTURAL: { type: Number, default: 0 },
    NOISE: { type: Number, default: 0 },
    EXHAUSTION: { type: Number, default: 0 },
    REVERSAL: { type: Number, default: 0 },
  },
  
  negPosRatio: { type: Number, default: 0 },
  typeDistribution: { type: Schema.Types.Mixed, default: {} },
  
  limitedTypes: [String],
  reasons: [String],
  
  config: {
    maxCandidates: Number,
    targetSamples: Number,
    window: String,
  },
});

NegativeRunSchema.index({ startedAt: -1 });
NegativeRunSchema.index({ status: 1 });

export const NegativeRunModel = mongoose.model<INegativeRun>(
  'ml_negative_runs', 
  NegativeRunSchema
);

// ============================================
// Store Functions
// ============================================

/**
 * Save a negative sample
 */
export async function saveSample(sample: NegativeSample): Promise<string> {
  const doc = await NegativeSampleModel.create(sample);
  return doc.sampleId;
}

/**
 * Save multiple samples (batch)
 */
export async function saveSamplesBatch(samples: NegativeSample[]): Promise<number> {
  if (samples.length === 0) return 0;
  
  const result = await NegativeSampleModel.insertMany(samples, { ordered: false });
  return result.length;
}

/**
 * Create a new run record
 */
export async function createRun(
  runId: string,
  horizon: string,
  config: { maxCandidates: number; targetSamples: number; window: string }
): Promise<void> {
  await NegativeRunModel.create({
    runId,
    horizon,
    startedAt: new Date(),
    status: 'RUNNING',
    config,
    byType: { STRUCTURAL: 0, NOISE: 0, EXHAUSTION: 0, REVERSAL: 0 },
  });
}

/**
 * Update run with final stats
 */
export async function completeRun(runId: string, stats: Partial<NegativeRunStats>): Promise<void> {
  await NegativeRunModel.updateOne(
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

/**
 * Mark run as failed
 */
export async function failRun(runId: string, reason: string): Promise<void> {
  await NegativeRunModel.updateOne(
    { runId },
    {
      $set: {
        completedAt: new Date(),
        status: 'FAILED',
      },
      $push: { reasons: reason }
    }
  );
}

/**
 * Get run by ID
 */
export async function getRun(runId: string): Promise<INegativeRun | null> {
  return NegativeRunModel.findOne({ runId }).lean();
}

/**
 * Get recent runs
 */
export async function getRecentRuns(limit: number = 20): Promise<INegativeRun[]> {
  return NegativeRunModel.find()
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get sample statistics
 */
export async function getSampleStats(): Promise<{
  total: number;
  positive: number;
  negative: number;
  byType: Record<string, number>;
  negPosRatio: number;
}> {
  const [total, positive, byType] = await Promise.all([
    NegativeSampleModel.countDocuments(),
    NegativeSampleModel.countDocuments({ label: 1 }),
    NegativeSampleModel.aggregate([
      { $match: { label: 0 } },
      { $group: { _id: '$negativeType', count: { $sum: 1 } } }
    ]),
  ]);
  
  const negative = total - positive;
  const typeMap = byType.reduce((acc, r) => {
    acc[r._id || 'UNKNOWN'] = r.count;
    return acc;
  }, {} as Record<string, number>);
  
  return {
    total,
    positive,
    negative,
    byType: typeMap,
    negPosRatio: positive > 0 ? negative / positive : 0,
  };
}

/**
 * Get samples by run
 */
export async function getSamplesByRun(
  runId: string,
  limit: number = 100
): Promise<INegativeSample[]> {
  return NegativeSampleModel.find({ runId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}
