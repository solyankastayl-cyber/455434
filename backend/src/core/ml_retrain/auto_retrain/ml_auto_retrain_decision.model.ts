/**
 * ML v2.2: Auto-Retrain Decision Log
 * ML v2.3: Extended with mlVersionUsed and v23ConfigSnapshot
 * 
 * История решений auto-retrain (для UI + дебага).
 * Каждая проверка логируется с причиной и snapshot метрик.
 */

import { Schema, model, Document } from 'mongoose';
import type { IV23Config, MlVersionType } from './ml_retrain_policy.model.js';

export type DecisionType = 'ENQUEUED' | 'SKIPPED';

export interface IDecisionSnapshot {
  accuracy7d?: number;
  driftLevel?: string;
  hoursSinceRetrain?: number;
  minutesSinceRetrain?: number;
  jobs24h?: number;
  minRows?: number;
  queueJobId?: string;
  // ML v2.3 additions
  mlVersionUsed?: MlVersionType;
  v23ConfigSnapshot?: IV23Config;
}

export interface IMlAutoRetrainDecision extends Document {
  ts: number;
  task: 'market' | 'actor';
  network: string;
  decision: DecisionType;
  reasons: string[];
  snapshot: IDecisionSnapshot;
  queueJobId?: string;
  // ML v2.3: Track which version was used
  mlVersionUsed?: MlVersionType;
}

const DecisionSchema = new Schema<IMlAutoRetrainDecision>({
  ts: { type: Number, required: true },
  task: { type: String, required: true, enum: ['market', 'actor'] },
  network: { type: String, required: true },
  decision: { type: String, required: true, enum: ['ENQUEUED', 'SKIPPED'] },
  reasons: { type: [String], default: [] },
  snapshot: { type: Schema.Types.Mixed, default: {} },
  queueJobId: { type: String },
  // ML v2.3
  mlVersionUsed: { type: String, enum: ['v2.1', 'v2.3'] }
}, { collection: 'ml_auto_retrain_decisions' });

// Indexes for efficient querying
DecisionSchema.index({ task: 1, network: 1, ts: -1 });
DecisionSchema.index({ decision: 1, ts: -1 });
DecisionSchema.index({ mlVersionUsed: 1, ts: -1 }); // ML v2.3

export const MlAutoRetrainDecisionModel = model<IMlAutoRetrainDecision>(
  'MlAutoRetrainDecision',
  DecisionSchema
);
