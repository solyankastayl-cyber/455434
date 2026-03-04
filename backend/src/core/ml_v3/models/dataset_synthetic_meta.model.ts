/**
 * Dataset Synthetic Meta Model - P0.1
 * 
 * Tracks synthetic dataset generation metadata
 */
import mongoose, { Schema, model, Document } from 'mongoose';

export interface IDatasetSyntheticMeta extends Document {
  datasetId: string;
  sourceDatasetId: string;
  multiplier: number;
  noisePct: number;
  timeShiftBuckets: number[];
  seed: number;
  method: string;
  rowsGenerated: number;
  createdAt: Date;
}

const DatasetSyntheticMetaSchema = new Schema<IDatasetSyntheticMeta>({
  datasetId: { type: String, required: true, unique: true, index: true },
  sourceDatasetId: { type: String, required: true, index: true },
  multiplier: { type: Number, required: true },
  noisePct: { type: Number, required: true },
  timeShiftBuckets: { type: [Number], default: [] },
  seed: { type: Number, required: true },
  method: { type: String, default: 'bootstrap_v1' },
  rowsGenerated: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

DatasetSyntheticMetaSchema.index({ sourceDatasetId: 1, createdAt: -1 });

export const DatasetSyntheticMeta =
  (mongoose.models.dataset_synthetic_meta as mongoose.Model<IDatasetSyntheticMeta>) ||
  model<IDatasetSyntheticMeta>('dataset_synthetic_meta', DatasetSyntheticMetaSchema);
