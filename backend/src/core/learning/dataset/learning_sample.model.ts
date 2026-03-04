/**
 * Learning Sample Model
 * 
 * ETAP 3.4: Stores ML training samples.
 * 
 * Each sample is a complete feature vector + labels
 * for a single token at a decision point.
 * 
 * Unique key: sampleId (snapshotId:horizon)
 * IMMUTABLE once created (upsert only).
 */
import mongoose from 'mongoose';
import type { Bucket, Horizon, DriftLevel } from '../learning.types.js';
import type { TrendLabel, DelayLabel } from '../types/trend.types.js';
import type { Verdict } from '../types/attribution.types.js';
import type { LearningSampleData, FeatureVector, Labels, SampleQuality } from '../types/dataset.types.js';

// ==================== INTERFACE ====================

export interface ILearningSample extends LearningSampleData {
  createdAt: Date;
  updatedAt: Date;
}

// ==================== SCHEMAS ====================

const SnapshotFeaturesSchema = new mongoose.Schema({
  bucket: { type: String, enum: ['BUY', 'WATCH', 'SELL'], required: true },
  compositeScore: { type: Number, required: true },
  engineScore: { type: Number, required: true },
  engineConfidence_raw: { type: Number, required: true },
  risk_raw: { type: Number, required: true },
  coverageLevel: { type: String, required: true },
  engineMode: { type: String, required: true },
  actorSignalScore: { type: Number, required: true },
  topPositiveSignals: [{ type: String }],
  topNegativeSignals: [{ type: String }],
}, { _id: false });

const LiveFeaturesSchema = new mongoose.Schema({
  live_netFlow: { type: Number, required: true },
  live_inflow: { type: Number, required: true },
  live_outflow: { type: Number, required: true },
  live_uniqueSenders: { type: Number, required: true },
  live_uniqueReceivers: { type: Number, required: true },
  live_exchangeInflow: { type: Number, required: true },
  live_exchangeOutflow: { type: Number, required: true },
  live_liquidityChangePct: { type: Number, required: true },
  live_eventCount: { type: Number, required: true },
  liveCoverage: { type: String, enum: ['FULL', 'PARTIAL', 'NONE'], required: true },
}, { _id: false });

const DriftFeaturesSchema = new mongoose.Schema({
  driftLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], required: true },
  driftScore: { type: Number, required: true },
  confidenceModifier: { type: Number, required: true },
  engineConfidence_adj: { type: Number, required: true },
}, { _id: false });

const MarketFeaturesSchema = new mongoose.Schema({
  priceAtDecision: { type: Number, required: true },
  mcapAtDecision: { type: Number, required: true },
  volumeAtDecision: { type: Number, required: true },
  momentumAtDecision: { type: Number, required: true },
}, { _id: false });

const FeatureVectorSchema = new mongoose.Schema({
  snapshot: { type: SnapshotFeaturesSchema, required: true },
  live: { type: LiveFeaturesSchema, required: true },
  drift: { type: DriftFeaturesSchema, required: true },
  market: { type: MarketFeaturesSchema, required: true },
}, { _id: false });

const TrendLabelsSchema = new mongoose.Schema({
  trend_1d: { type: String, enum: ['NOISE', 'SIDEWAYS', 'TREND_UP', 'TREND_DOWN', null], default: null },
  trend_7d: { type: String, enum: ['NOISE', 'SIDEWAYS', 'TREND_UP', 'TREND_DOWN', null], default: null },
  trend_30d: { type: String, enum: ['NOISE', 'SIDEWAYS', 'TREND_UP', 'TREND_DOWN', null], default: null },
}, { _id: false });

const DelayLabelsSchema = new mongoose.Schema({
  delayClass_7d: { type: String, enum: ['INSTANT', 'DELAYED', 'LATE', 'NONE', null], default: null },
  delayClass_30d: { type: String, enum: ['INSTANT', 'DELAYED', 'LATE', 'NONE', null], default: null },
}, { _id: false });

const OutcomeLabelsSchema = new mongoose.Schema({
  ret_1d_pct: { type: Number, default: null },
  ret_7d_pct: { type: Number, default: null },
  ret_30d_pct: { type: Number, default: null },
  maxDrawdown_7d: { type: Number, default: null },
  maxDrawdown_30d: { type: Number, default: null },
}, { _id: false });

const VerdictLabelsSchema = new mongoose.Schema({
  verdict_1d: { type: String, enum: ['TRUE_POSITIVE', 'FALSE_POSITIVE', 'TRUE_NEGATIVE', 'FALSE_NEGATIVE', 'MISSED', 'DELAYED_TRUE', null], default: null },
  verdict_7d: { type: String, enum: ['TRUE_POSITIVE', 'FALSE_POSITIVE', 'TRUE_NEGATIVE', 'FALSE_NEGATIVE', 'MISSED', 'DELAYED_TRUE', null], default: null },
  verdict_30d: { type: String, enum: ['TRUE_POSITIVE', 'FALSE_POSITIVE', 'TRUE_NEGATIVE', 'FALSE_NEGATIVE', 'MISSED', 'DELAYED_TRUE', null], default: null },
}, { _id: false });

const LabelsSchema = new mongoose.Schema({
  trends: { type: TrendLabelsSchema, required: true },
  delays: { type: DelayLabelsSchema, required: true },
  outcomes: { type: OutcomeLabelsSchema, required: true },
  verdicts: { type: VerdictLabelsSchema, required: true },
}, { _id: false });

const SampleQualitySchema = new mongoose.Schema({
  trainEligible: { type: Boolean, required: true },
  reasons: [{ type: String }],
  liveCoverage: { type: String, enum: ['FULL', 'PARTIAL', 'NONE'], required: true },
  trendCoverage: { type: Number, required: true },
  verdictCoverage: { type: Number, required: true },
  dataCompleteness: { type: Number, required: true },
}, { _id: false });

const LearningSampleSchema = new mongoose.Schema<ILearningSample>({
  sampleId: {
    type: String,
    required: true,
    unique: true,
  },
  snapshotId: {
    type: String,
    required: true,
  },
  tokenAddress: {
    type: String,
    required: true,
    lowercase: true,
  },
  symbol: {
    type: String,
    required: true,
  },
  horizon: {
    type: String,
    enum: ['1d', '7d', '30d'],
    required: true,
  },
  snapshotAt: {
    type: Date,
    required: true,
  },
  features: {
    type: FeatureVectorSchema,
    required: true,
  },
  labels: {
    type: LabelsSchema,
    required: true,
  },
  quality: {
    type: SampleQualitySchema,
    required: true,
  },
  schemaVersion: {
    type: String,
    required: true,
  },
  builtAt: {
    type: Date,
    required: true,
  },
}, {
  collection: 'learning_samples',
  timestamps: true,
});

// Indexes for efficient querying
LearningSampleSchema.index({ sampleId: 1 }, { unique: true });
LearningSampleSchema.index({ snapshotId: 1 });
LearningSampleSchema.index({ tokenAddress: 1, snapshotAt: -1 });
LearningSampleSchema.index({ horizon: 1 });
LearningSampleSchema.index({ 'quality.trainEligible': 1 });
LearningSampleSchema.index({ 'features.snapshot.bucket': 1 });
LearningSampleSchema.index({ 'labels.verdicts.verdict_7d': 1 });
LearningSampleSchema.index({ builtAt: -1 });
LearningSampleSchema.index({ schemaVersion: 1 });

export const LearningSampleModel = mongoose.model<ILearningSample>(
  'LearningSample',
  LearningSampleSchema
);
