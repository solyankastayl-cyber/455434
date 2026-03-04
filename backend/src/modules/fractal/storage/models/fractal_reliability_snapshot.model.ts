/**
 * BLOCK 43.1 — Fractal Reliability Snapshot Model
 * History of reliability/health for timeline visualization
 */

import mongoose, { Schema, Document } from 'mongoose';

export type ReliabilityBadge = 'OK' | 'WARN' | 'DEGRADED' | 'CRITICAL';

export interface IReliabilityComponents {
  drift: number;
  calibration: number;
  rolling: number;
  mcTail: number;
}

export interface IReliabilityMetrics {
  wfSharpe?: number;
  wfMaxDD?: number;
  trades?: number;
  mcP95DD?: number;
  mcP10Sharpe?: number;
  rollingPassRate?: number;
  stability?: number;
}

export interface IReliabilityContext {
  phase?: string;
  entropy?: number;
  dominance?: number;
}

export interface IFractalReliabilitySnapshot extends Document {
  ts: number;           // unix ms
  modelKey: string;
  presetKey: string;
  badge: ReliabilityBadge;
  reliabilityScore: number;  // 0..1
  components: IReliabilityComponents;
  metrics?: IReliabilityMetrics;
  context?: IReliabilityContext;
}

const ComponentsSchema = new Schema<IReliabilityComponents>(
  {
    drift: { type: Number, required: true },
    calibration: { type: Number, required: true },
    rolling: { type: Number, required: true },
    mcTail: { type: Number, required: true },
  },
  { _id: false }
);

const MetricsSchema = new Schema<IReliabilityMetrics>(
  {
    wfSharpe: Number,
    wfMaxDD: Number,
    trades: Number,
    mcP95DD: Number,
    mcP10Sharpe: Number,
    rollingPassRate: Number,
    stability: Number,
  },
  { _id: false }
);

const ContextSchema = new Schema<IReliabilityContext>(
  {
    phase: String,
    entropy: Number,
    dominance: Number,
  },
  { _id: false }
);

const FractalReliabilitySnapshotSchema = new Schema<IFractalReliabilitySnapshot>(
  {
    ts: { type: Number, required: true, index: true },
    modelKey: { type: String, required: true, index: true },
    presetKey: { type: String, required: true, index: true },
    badge: { 
      type: String, 
      required: true,
      enum: ['OK', 'WARN', 'DEGRADED', 'CRITICAL']
    },
    reliabilityScore: { type: Number, required: true },
    components: { type: ComponentsSchema, required: true },
    metrics: { type: MetricsSchema },
    context: { type: ContextSchema },
  },
  { 
    versionKey: false,
    collection: 'fractal_reliability_snapshots'
  }
);

FractalReliabilitySnapshotSchema.index({ modelKey: 1, presetKey: 1, ts: -1 });

export const FractalReliabilitySnapshotModel = mongoose.model<IFractalReliabilitySnapshot>(
  'FractalReliabilitySnapshot',
  FractalReliabilitySnapshotSchema
);
