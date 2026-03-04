/**
 * Attribution Outcome Link Model
 * 
 * ETAP 3.3: Links predictions to outcomes with signal attribution.
 * 
 * Key responsibilities:
 * - Connect Snapshot → Outcome → TrendValidation
 * - Determine verdict (TRUE_POSITIVE, FALSE_POSITIVE, etc.)
 * - Track which signals contributed to the decision
 * - Account for delay effects (1d miss, 7d/30d hit)
 * 
 * IMMUTABLE once created (upsert only by snapshotId + horizon).
 * NO ML - pure deterministic rules.
 */
import mongoose from 'mongoose';
import type { Bucket, Horizon, DriftLevel } from '../learning.types.js';
import type { TrendLabel, DelayLabel } from '../types/trend.types.js';
import type { 
  Verdict, 
  SignalContribution, 
  SignalContribSummary, 
  LinkQuality 
} from '../types/attribution.types.js';

// ==================== INTERFACE ====================

export interface IAttributionOutcomeLink {
  // Identifiers
  tokenAddress: string;
  symbol: string;
  snapshotId: string;
  horizon: Horizon;
  
  // Decision context
  bucketAtDecision: Bucket;
  scoreAtDecision: number;
  confidenceAtDecision: number;
  riskAtDecision: number;
  
  // Outcome context
  trendLabel: TrendLabel;
  delayLabel: DelayLabel;
  outcomeDeltaPct: number;
  drawdownPct: number;
  volumeDeltaPct: number;
  
  // Signal attribution
  signalContrib: SignalContribSummary;
  
  // Final verdict
  verdict: Verdict;
  
  // Quality metrics
  quality: LinkQuality;
  
  // Metadata
  linkedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ==================== SCHEMAS ====================

const SignalContributionSchema = new mongoose.Schema({
  key: { type: String, required: true },
  source: { type: String, enum: ['actor', 'engine', 'live', 'market'], required: true },
  value: { type: Number, required: true },
  weight: { type: Number, required: true },
  direction: { type: String, enum: ['positive', 'negative', 'neutral'], required: true },
}, { _id: false });

const ConflictSchema = new mongoose.Schema({
  key: { type: String, required: true },
  conflictScore: { type: Number, required: true },
}, { _id: false });

const SignalContribSummarySchema = new mongoose.Schema({
  positiveSignals: [SignalContributionSchema],
  negativeSignals: [SignalContributionSchema],
  conflicts: [ConflictSchema],
  topContributor: { type: String, default: null },
  totalPositive: { type: Number, required: true, default: 0 },
  totalNegative: { type: Number, required: true, default: 0 },
}, { _id: false });

const LinkQualitySchema = new mongoose.Schema({
  liveApprovedCoverage: { type: Number, required: true, min: 0, max: 1 },
  driftLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], required: true },
  confidenceModifierApplied: { type: Number, required: true },
  trendConfidence: { type: Number, required: true },
  dataCompleteness: { type: Number, required: true, min: 0, max: 1 },
}, { _id: false });

const AttributionOutcomeLinkSchema = new mongoose.Schema<IAttributionOutcomeLink>({
  tokenAddress: {
    type: String,
    required: true,
    lowercase: true,
  },
  symbol: {
    type: String,
    required: true,
  },
  snapshotId: {
    type: String,
    required: true,
  },
  horizon: {
    type: String,
    enum: ['1d', '7d', '30d'],
    required: true,
  },
  bucketAtDecision: {
    type: String,
    enum: ['BUY', 'WATCH', 'SELL'],
    required: true,
  },
  scoreAtDecision: {
    type: Number,
    required: true,
  },
  confidenceAtDecision: {
    type: Number,
    required: true,
  },
  riskAtDecision: {
    type: Number,
    required: true,
  },
  trendLabel: {
    type: String,
    enum: ['NOISE', 'SIDEWAYS', 'TREND_UP', 'TREND_DOWN'],
    required: true,
  },
  delayLabel: {
    type: String,
    enum: ['INSTANT', 'DELAYED', 'LATE', 'NONE'],
    required: true,
  },
  outcomeDeltaPct: {
    type: Number,
    required: true,
  },
  drawdownPct: {
    type: Number,
    required: true,
  },
  volumeDeltaPct: {
    type: Number,
    required: true,
  },
  signalContrib: {
    type: SignalContribSummarySchema,
    required: true,
  },
  verdict: {
    type: String,
    enum: ['TRUE_POSITIVE', 'FALSE_POSITIVE', 'TRUE_NEGATIVE', 'FALSE_NEGATIVE', 'MISSED', 'DELAYED_TRUE'],
    required: true,
  },
  quality: {
    type: LinkQualitySchema,
    required: true,
  },
  linkedAt: {
    type: Date,
    required: true,
  },
}, {
  collection: 'attribution_outcome_links',
  timestamps: true,
});

// Indexes
AttributionOutcomeLinkSchema.index({ snapshotId: 1, horizon: 1 }, { unique: true });
AttributionOutcomeLinkSchema.index({ tokenAddress: 1, linkedAt: -1 });
AttributionOutcomeLinkSchema.index({ verdict: 1 });
AttributionOutcomeLinkSchema.index({ bucketAtDecision: 1, verdict: 1 });
AttributionOutcomeLinkSchema.index({ linkedAt: -1 });
AttributionOutcomeLinkSchema.index({ horizon: 1 });

export const AttributionOutcomeLinkModel = mongoose.model<IAttributionOutcomeLink>(
  'AttributionOutcomeLink',
  AttributionOutcomeLinkSchema
);
