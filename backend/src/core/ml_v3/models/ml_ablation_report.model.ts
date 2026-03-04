/**
 * ML Ablation Report Model - B4.3
 * 
 * Stores comparison results between two SHADOW models (e.g., PACK_A vs PACK_A_PLUS_DEX)
 */
import mongoose, { Schema, model, Document } from 'mongoose';

export type AblationVerdict = 'IMPROVES' | 'NEUTRAL' | 'DEGRADES' | 'INCONCLUSIVE';

export interface MetricSet {
  rows: number;
  accuracy: number;
  f1: number;
  precision: number;
  recall: number;
  confusion: {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
  };
  meta?: Record<string, any>;
}

export interface MlAblationReportDoc extends Document {
  task: string;              // "market" | "actor"
  network: string;           // ethereum|bnb|...
  datasetId: string;

  modelA: { modelId: string; featurePack: string; modelVersion?: string };
  modelB: { modelId: string; featurePack: string; modelVersion?: string };

  metricsA: MetricSet;
  metricsB: MetricSet;

  deltas: {
    deltaAccuracy: number;
    deltaF1: number;
    deltaPrecision: number;
    deltaRecall: number;
    fpRateA: number;
    fpRateB: number;
    fnRateA: number;
    fnRateB: number;
  };

  verdict: AblationVerdict;
  reasons: string[];

  createdAt: Date;
}

const ConfusionSchema = new Schema(
  {
    tp: { type: Number, required: true },
    fp: { type: Number, required: true },
    tn: { type: Number, required: true },
    fn: { type: Number, required: true },
  },
  { _id: false }
);

const MetricSetSchema = new Schema(
  {
    rows: { type: Number, required: true },
    accuracy: { type: Number, required: true },
    f1: { type: Number, required: true },
    precision: { type: Number, required: true },
    recall: { type: Number, required: true },
    confusion: { type: ConfusionSchema, required: true },
    meta: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const MlAblationReportSchema = new Schema<MlAblationReportDoc>(
  {
    task: { type: String, required: true, index: true },
    network: { type: String, required: true, index: true },
    datasetId: { type: String, required: true, index: true },

    modelA: {
      modelId: { type: String, required: true },
      featurePack: { type: String, required: true },
      modelVersion: { type: String },
    },
    modelB: {
      modelId: { type: String, required: true },
      featurePack: { type: String, required: true },
      modelVersion: { type: String },
    },

    metricsA: { type: MetricSetSchema, required: true },
    metricsB: { type: MetricSetSchema, required: true },

    deltas: {
      deltaAccuracy: { type: Number, required: true },
      deltaF1: { type: Number, required: true },
      deltaPrecision: { type: Number, required: true },
      deltaRecall: { type: Number, required: true },
      fpRateA: { type: Number, required: true },
      fpRateB: { type: Number, required: true },
      fnRateA: { type: Number, required: true },
      fnRateB: { type: Number, required: true },
    },

    verdict: {
      type: String,
      enum: ['IMPROVES', 'NEUTRAL', 'DEGRADES', 'INCONCLUSIVE'],
      required: true,
      index: true,
    },
    reasons: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Composite indexes for queries
MlAblationReportSchema.index({ task: 1, network: 1, createdAt: -1 });
MlAblationReportSchema.index({ verdict: 1, createdAt: -1 });

export const MlAblationReport =
  (mongoose.models.ml_ablation_reports as mongoose.Model<MlAblationReportDoc>) ||
  model<MlAblationReportDoc>('ml_ablation_reports', MlAblationReportSchema);
