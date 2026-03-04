/**
 * Gate Check MongoDB Model
 * 
 * Stores history of all gate check runs
 * Each run is immutable - we keep full history
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { GateStatus, GateSection, SectionResult } from './gate_check.types.js';

export interface IGateCheck extends Document {
  runId: string;
  horizon: '7d' | '30d';
  gate_status: GateStatus;
  trainingAllowed: boolean;
  
  failed_sections: GateSection[];
  passed_sections: GateSection[];
  
  reasons: string[];
  metrics: Record<string, number | string | boolean>;
  sections: SectionResult[];
  
  createdAt: Date;
  version: string;
}

const SectionResultSchema = new Schema({
  section: { type: String, required: true },
  passed: { type: Boolean, required: true },
  reasons: [{ type: String }],
  metrics: { type: Schema.Types.Mixed, default: {} },
}, { _id: false });

const GateCheckSchema = new Schema<IGateCheck>({
  runId: { type: String, required: true, unique: true },
  horizon: { type: String, enum: ['7d', '30d'], required: true },
  gate_status: { type: String, enum: ['PASSED', 'BLOCKED'], required: true },
  trainingAllowed: { type: Boolean, required: true },
  
  failed_sections: [{ type: String }],
  passed_sections: [{ type: String }],
  
  reasons: [{ type: String }],
  metrics: { type: Schema.Types.Mixed, default: {} },
  sections: [SectionResultSchema],
  
  createdAt: { type: Date, default: Date.now },
  version: { type: String, default: '1.0.0' },
});

// Indexes
GateCheckSchema.index({ horizon: 1, createdAt: -1 });
GateCheckSchema.index({ gate_status: 1 });

export const GateCheckModel = mongoose.model<IGateCheck>('ml_gate_checks', GateCheckSchema);
