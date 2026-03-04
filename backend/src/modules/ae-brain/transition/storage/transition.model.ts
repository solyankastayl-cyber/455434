/**
 * C8 Transition Matrix Storage
 * MongoDB schema for transition matrices
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ITransitionMatrixDoc extends Document {
  matrixId: string;
  from: string;
  to: string;
  stepDays: number;
  alpha: number;
  samples: number;
  labels: string[];
  matrix: number[][];
  rowSums: number[];
  computedAt: Date;
}

const TransitionMatrixSchema = new Schema<ITransitionMatrixDoc>({
  matrixId: { type: String, required: true, unique: true, index: true },
  from: { type: String, required: true },
  to: { type: String, required: true },
  stepDays: { type: Number, required: true },
  alpha: { type: Number, required: true },
  samples: { type: Number, required: true },
  labels: [{ type: String }],
  matrix: [[{ type: Number }]],
  rowSums: [{ type: Number }],
  computedAt: { type: Date, default: Date.now },
}, {
  collection: 'ae_transition_matrices',
});

export const TransitionMatrixModel = mongoose.model<ITransitionMatrixDoc>(
  'AeTransitionMatrix',
  TransitionMatrixSchema
);
