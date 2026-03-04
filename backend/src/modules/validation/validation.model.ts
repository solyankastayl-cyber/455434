/**
 * C2.2 — Validation MongoDB Model
 */

import mongoose, { Schema, Document, Types } from 'mongoose';
import { ValidationResult, ExchangeVerdict, ValidationResultType } from './validation.engine.js';
import { OnchainState } from '../onchain/onchain.contracts.js';

export interface IValidationResultDoc extends Document {
  _id: Types.ObjectId;
  symbol: string;
  t0: number;
  exchange: {
    verdict: ExchangeVerdict;
    confidence: number;
  };
  onchain: {
    state: OnchainState;
    confidence: number;
  };
  validation: {
    result: ValidationResultType;
    strength: number;
    reason: string[];
  };
  integrity: {
    usable: boolean;
    reason?: string;
  };
  createdAt: number;
}

const ValidationResultSchema = new Schema<IValidationResultDoc>({
  symbol: { type: String, required: true, index: true },
  t0: { type: Number, required: true, index: true },
  
  exchange: {
    verdict: { type: String, enum: ['BULLISH', 'BEARISH', 'NEUTRAL'], required: true },
    confidence: { type: Number, required: true },
  },
  
  onchain: {
    state: { type: String, enum: ['ACCUMULATION', 'DISTRIBUTION', 'NEUTRAL', 'NO_DATA'], required: true },
    confidence: { type: Number, required: true },
  },
  
  validation: {
    result: { type: String, enum: ['CONFIRMS', 'CONTRADICTS', 'NO_DATA'], required: true, index: true },
    strength: { type: Number, required: true },
    reason: [{ type: String }],
  },
  
  integrity: {
    usable: { type: Boolean, required: true },
    reason: String,
  },
  
  createdAt: { type: Number, required: true },
}, {
  collection: 'c2_validation_results',
});

// Indexes
ValidationResultSchema.index({ symbol: 1, t0: -1 });
ValidationResultSchema.index({ symbol: 1, t0: 1 }, { unique: true });
ValidationResultSchema.index({ 'validation.result': 1, t0: -1 });
ValidationResultSchema.index({ createdAt: -1 });

export const ValidationResultModel = mongoose.models.C2ValidationResult ||
  mongoose.model<IValidationResultDoc>('C2ValidationResult', ValidationResultSchema);

console.log('[C2.2] ValidationResult model loaded');
