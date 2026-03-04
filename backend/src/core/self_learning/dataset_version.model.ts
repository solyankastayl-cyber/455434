/**
 * Dataset Version Model
 * 
 * ETAP 5.2: Immutable frozen dataset versions for reproducible training.
 */
import mongoose, { Schema, Document } from 'mongoose';
import type { DatasetVersion, Horizon, DriftLevel, DatasetVersionFilters } from './self_learning.types.js';

// ==================== INTERFACE ====================

export interface IDatasetVersion extends Document, Omit<DatasetVersion, 'datasetVersion'> {
  datasetVersion: string;
}

// ==================== SCHEMA ====================

const DatasetVersionFiltersSchema = new Schema({
  trainEligible: { type: Boolean, required: true },
  trends: [{ type: String }],
  driftLevels: [{ type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }],
  minConfidence: { type: Number },
}, { _id: false });

const ClassDistributionSchema = new Schema({
  positive: { type: Number, required: true },
  negative: { type: Number, required: true },
  ratio: { type: Number, required: true },
}, { _id: false });

const DatasetVersionSchema = new Schema<IDatasetVersion>({
  datasetVersion: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  horizon: {
    type: String,
    enum: ['7d', '30d'],
    required: true,
  },
  
  // Content
  sampleIds: {
    type: [String],
    required: true,
  },
  sampleCount: {
    type: Number,
    required: true,
  },
  filters: {
    type: DatasetVersionFiltersSchema,
    required: true,
  },
  
  // Integrity
  contentHash: {
    type: String,
    required: true,
    index: true,
  },
  
  // Class distribution
  classDistribution: {
    type: ClassDistributionSchema,
    required: true,
  },
  
  // Time range
  earliestSample: {
    type: Date,
    required: true,
  },
  latestSample: {
    type: Date,
    required: true,
  },
  
  // Metadata
  createdAt: {
    type: Date,
    default: Date.now,
  },
  createdBy: {
    type: String,
    enum: ['scheduler', 'manual'],
    default: 'scheduler',
  },
  
  // Status
  status: {
    type: String,
    enum: ['FROZEN', 'USED', 'EXPIRED'],
    default: 'FROZEN',
  },
  usedByModelVersion: {
    type: String,
    default: null,
  },
}, {
  collection: 'dataset_versions',
  timestamps: true,
});

// ==================== INDEXES ====================

DatasetVersionSchema.index({ horizon: 1, createdAt: -1 });
DatasetVersionSchema.index({ status: 1 });
DatasetVersionSchema.index({ contentHash: 1 });

// ==================== METHODS ====================

DatasetVersionSchema.methods.markAsUsed = async function(modelVersion: string): Promise<void> {
  this.status = 'USED';
  this.usedByModelVersion = modelVersion;
  await this.save();
};

DatasetVersionSchema.methods.expire = async function(): Promise<void> {
  this.status = 'EXPIRED';
  await this.save();
};

// ==================== STATICS ====================

DatasetVersionSchema.statics.findByHorizon = function(
  horizon: Horizon,
  limit: number = 10
): Promise<IDatasetVersion[]> {
  return this.find({ horizon })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

DatasetVersionSchema.statics.findLatestFrozen = function(
  horizon: Horizon
): Promise<IDatasetVersion | null> {
  return this.findOne({ horizon, status: 'FROZEN' })
    .sort({ createdAt: -1 })
    .lean();
};

DatasetVersionSchema.statics.findByHash = function(
  contentHash: string
): Promise<IDatasetVersion | null> {
  return this.findOne({ contentHash }).lean();
};

// ==================== MODEL ====================

interface DatasetVersionModel extends mongoose.Model<IDatasetVersion> {
  findByHorizon(horizon: Horizon, limit?: number): Promise<IDatasetVersion[]>;
  findLatestFrozen(horizon: Horizon): Promise<IDatasetVersion | null>;
  findByHash(contentHash: string): Promise<IDatasetVersion | null>;
}

export const DatasetVersionModel = mongoose.model<IDatasetVersion, DatasetVersionModel>(
  'DatasetVersion',
  DatasetVersionSchema
);
