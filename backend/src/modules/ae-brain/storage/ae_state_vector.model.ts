/**
 * AE State Vector Storage Model
 * MongoDB schema for historical state vectors
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IAeStateVectorDoc extends Document {
  asOf: string;
  vector: {
    macroSigned: number;
    macroConfidence: number;
    guardLevel: number;
    dxySignalSigned: number;
    dxyConfidence: number;
    regimeBias90d: number;
  };
  health: {
    ok: boolean;
    missing: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const AeStateVectorSchema = new Schema<IAeStateVectorDoc>({
  asOf: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  vector: {
    macroSigned: { type: Number, required: true },
    macroConfidence: { type: Number, required: true },
    guardLevel: { type: Number, required: true },
    dxySignalSigned: { type: Number, required: true },
    dxyConfidence: { type: Number, required: true },
    regimeBias90d: { type: Number, required: true },
  },
  health: {
    ok: { type: Boolean, default: true },
    missing: { type: [String], default: [] },
  },
}, {
  timestamps: true,
  collection: 'ae_state_vectors',
});

// Index for efficient queries
AeStateVectorSchema.index({ createdAt: -1 });

export const AeStateVectorModel = mongoose.model<IAeStateVectorDoc>(
  'AeStateVector',
  AeStateVectorSchema
);
