/**
 * BATCH 3: Shadow Comparison Model
 * 
 * Хранит результаты сравнения ACTIVE vs SHADOW моделей.
 * Verdict определяет можно ли делать promotion.
 */

import { Schema, model, Document } from 'mongoose';

export type ShadowVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export type MlTask = 'market' | 'actor';

export interface IShadowComparison extends Document {
  createdAtTs: number;
  task: MlTask;
  network: string;
  windowLabel: string;

  activeModelVersion: string;
  shadowModelVersion: string;

  sample: {
    rows: number;
    fromTs?: number;
    toTs?: number;
    datasetVersion?: string;
    source?: 'mongo' | 'csv';
  };

  metricsActive: {
    accuracy: number;
    f1: number;
    precision: number;
    recall: number;
  };

  metricsShadow: {
    accuracy: number;
    f1: number;
    precision: number;
    recall: number;
  };

  delta: {
    accuracyDelta: number;
    f1Delta: number;
    precisionDelta: number;
    recallDelta: number;
  };

  latencyMs: {
    active: number;
    shadow: number;
  };

  verdict: {
    status: ShadowVerdict;
    reason: string;
    rulesVersion: string;
  };
}

const ShadowComparisonSchema = new Schema<IShadowComparison>(
  {
    createdAtTs: { type: Number, required: true, index: true },
    task: { type: String, required: true, enum: ['market', 'actor'], index: true },
    network: { type: String, required: true, index: true },
    windowLabel: { type: String, required: true, default: '24h' },

    activeModelVersion: { type: String, required: true, index: true },
    shadowModelVersion: { type: String, required: true, index: true },

    sample: {
      rows: { type: Number, required: true },
      fromTs: { type: Number },
      toTs: { type: Number },
      datasetVersion: { type: String },
      source: { type: String, enum: ['mongo', 'csv'], default: 'csv' },
    },

    metricsActive: {
      accuracy: { type: Number, required: true },
      f1: { type: Number, required: true },
      precision: { type: Number, required: true },
      recall: { type: Number, required: true },
    },

    metricsShadow: {
      accuracy: { type: Number, required: true },
      f1: { type: Number, required: true },
      precision: { type: Number, required: true },
      recall: { type: Number, required: true },
    },

    delta: {
      accuracyDelta: { type: Number, required: true },
      f1Delta: { type: Number, required: true },
      precisionDelta: { type: Number, required: true },
      recallDelta: { type: Number, required: true },
    },

    latencyMs: {
      active: { type: Number, required: true },
      shadow: { type: Number, required: true },
    },

    verdict: {
      status: { type: String, required: true, enum: ['PASS', 'FAIL', 'INCONCLUSIVE'] },
      reason: { type: String, required: true },
      rulesVersion: { type: String, required: true, default: 'v1' },
    },
  },
  { versionKey: false }
);

// Indexes
ShadowComparisonSchema.index({ task: 1, network: 1, createdAtTs: -1 });
ShadowComparisonSchema.index({ shadowModelVersion: 1 });

export const ShadowComparisonModel = model<IShadowComparison>(
  'ml_shadow_comparisons',
  ShadowComparisonSchema
);
