/**
 * P12 — Adaptive Parameters MongoDB Model
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { 
  AdaptiveParams, 
  BrainRulesParams, 
  OptimizerParams, 
  MetaRiskParams,
  AdaptiveGates,
  AssetId,
} from './adaptive.contract.js';

// ═══════════════════════════════════════════════════════════════
// ACTIVE PARAMS MODEL (1 doc per asset)
// ═══════════════════════════════════════════════════════════════

export interface IAdaptiveParamsDoc extends Document {
  versionId: string;
  asset: AssetId;
  brain: BrainRulesParams;
  optimizer: OptimizerParams;
  metarisk: MetaRiskParams;
  gates: AdaptiveGates;
  updatedAt: Date;
  source: 'default' | 'tuned' | 'promoted';
}

const BrainRulesSchema = new Schema({
  tailQ05: { type: Number, required: true },
  spread: { type: Number, required: true },
  bullMean: { type: Number, required: true },
}, { _id: false });

const OptimizerSchema = new Schema({
  K: { type: Number, required: true },
  wReturn: { type: Number, required: true },
  wTail: { type: Number, required: true },
  wCorr: { type: Number, required: true },
  wGuard: { type: Number, required: true },
  capBase: { type: Number, required: true },
  capDefensive: { type: Number, required: true },
  capTail: { type: Number, required: true },
}, { _id: false });

const MetaRiskSchema = new Schema({
  durationScale: { type: Number, required: true },
  stabilityScale: { type: Number, required: true },
  flipPenalty: { type: Number, required: true },
  crossAdj: { type: Number, required: true },
}, { _id: false });

const GatesSchema = new Schema({
  minDeltaHitRatePp: { type: Number, required: true },
  maxDegradationPp: { type: Number, required: true },
  maxFlipRatePerYear: { type: Number, required: true },
  maxOverrideIntensityBase: { type: Number, required: true },
  maxOverrideIntensityTail: { type: Number, required: true },
}, { _id: false });

const AdaptiveParamsSchema = new Schema<IAdaptiveParamsDoc>({
  versionId: { type: String, required: true },
  asset: { type: String, enum: ['dxy', 'spx', 'btc'], required: true, unique: true },
  brain: { type: BrainRulesSchema, required: true },
  optimizer: { type: OptimizerSchema, required: true },
  metarisk: { type: MetaRiskSchema, required: true },
  gates: { type: GatesSchema, required: true },
  updatedAt: { type: Date, default: Date.now },
  source: { type: String, enum: ['default', 'tuned', 'promoted'], default: 'default' },
}, {
  timestamps: true,
});

export const AdaptiveParamsModel = mongoose.model<IAdaptiveParamsDoc>(
  'AdaptiveParams',
  AdaptiveParamsSchema,
  'adaptive_active_params'
);

// ═══════════════════════════════════════════════════════════════
// PARAMS HISTORY MODEL
// ═══════════════════════════════════════════════════════════════

export interface IAdaptiveHistoryDoc extends Document {
  versionId: string;
  asset: AssetId;
  brain: BrainRulesParams;
  optimizer: OptimizerParams;
  metarisk: MetaRiskParams;
  gates: AdaptiveGates;
  source: 'default' | 'tuned' | 'promoted';
  runId?: string;
  metrics?: {
    avgDeltaHitRatePp: number;
    minDeltaPp: number;
    flipRatePerYear: number;
    stabilityScore: number;
  };
  createdAt: Date;
}

const AdaptiveHistorySchema = new Schema<IAdaptiveHistoryDoc>({
  versionId: { type: String, required: true, unique: true },
  asset: { type: String, enum: ['dxy', 'spx', 'btc'], required: true },
  brain: { type: BrainRulesSchema, required: true },
  optimizer: { type: OptimizerSchema, required: true },
  metarisk: { type: MetaRiskSchema, required: true },
  gates: { type: GatesSchema, required: true },
  source: { type: String, enum: ['default', 'tuned', 'promoted'], required: true },
  runId: { type: String },
  metrics: {
    avgDeltaHitRatePp: { type: Number },
    minDeltaPp: { type: Number },
    flipRatePerYear: { type: Number },
    stabilityScore: { type: Number },
  },
  createdAt: { type: Date, default: Date.now },
}, {
  timestamps: false,
});

AdaptiveHistorySchema.index({ asset: 1, createdAt: -1 });

export const AdaptiveHistoryModel = mongoose.model<IAdaptiveHistoryDoc>(
  'AdaptiveHistory',
  AdaptiveHistorySchema,
  'adaptive_param_history'
);

// ═══════════════════════════════════════════════════════════════
// TUNING RUN MODEL
// ═══════════════════════════════════════════════════════════════

export interface ITuningRunDoc extends Document {
  runId: string;
  asset: AssetId;
  start: string;
  end: string;
  steps: number;
  mode: 'off' | 'shadow' | 'on';
  status: 'running' | 'complete' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  report?: any;
}

const TuningRunSchema = new Schema<ITuningRunDoc>({
  runId: { type: String, required: true, unique: true },
  asset: { type: String, required: true },
  start: { type: String, required: true },
  end: { type: String, required: true },
  steps: { type: Number, required: true },
  mode: { type: String, enum: ['off', 'shadow', 'on'], required: true },
  status: { type: String, enum: ['running', 'complete', 'failed'], default: 'running' },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  report: { type: Schema.Types.Mixed },
}, {
  timestamps: true,
});

export const TuningRunModel = mongoose.model<ITuningRunDoc>(
  'TuningRun',
  TuningRunSchema,
  'adaptive_tuning_runs'
);
