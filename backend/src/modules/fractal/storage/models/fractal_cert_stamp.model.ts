/**
 * BLOCK 43.1 — Fractal Certification Stamp Model
 * Records certification freezes and passes
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ICertSummary {
  wfSharpe?: number;
  wfMaxDD?: number;
  trades?: number;
  mcP95DD?: number;
  mcP10Sharpe?: number;
  slippageMultMax?: number;
  replayDeterministic?: boolean;
}

export interface IFractalCertStamp extends Document {
  ts: number;
  version: string;        // "v2.1"
  presetKey: string;
  modelKey: string;
  verdict: 'PASS' | 'FAIL';
  gates: Record<string, any>;  // rolling gates + thresholds
  summary: ICertSummary;
  frozen: boolean;
  notes?: string;
}

const SummarySchema = new Schema<ICertSummary>(
  {
    wfSharpe: Number,
    wfMaxDD: Number,
    trades: Number,
    mcP95DD: Number,
    mcP10Sharpe: Number,
    slippageMultMax: Number,
    replayDeterministic: Boolean,
  },
  { _id: false }
);

const FractalCertStampSchema = new Schema<IFractalCertStamp>(
  {
    ts: { type: Number, required: true, index: true },
    version: { type: String, required: true },
    presetKey: { type: String, required: true, index: true },
    modelKey: { type: String, required: true, index: true },
    verdict: { 
      type: String, 
      required: true,
      enum: ['PASS', 'FAIL']
    },
    gates: { type: Schema.Types.Mixed, required: true },
    summary: { type: SummarySchema, required: true },
    frozen: { type: Boolean, required: true, default: false },
    notes: String,
  },
  { 
    versionKey: false,
    collection: 'fractal_cert_stamps'
  }
);

FractalCertStampSchema.index({ presetKey: 1, modelKey: 1, ts: -1 });

export const FractalCertStampModel = mongoose.model<IFractalCertStamp>(
  'FractalCertStamp',
  FractalCertStampSchema
);
