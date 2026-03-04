/**
 * P1.2 - Group Attribution MongoDB Model
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IGroupAttribution {
  group: string;
  deltaF1: number;
  deltaAccuracy: number;
  deltaPrecision: number;
  deltaRecall: number;
  stability: string;
  verdict: string;
  confidence: number;
  sampleSize: number;
  reasons: string[];
}

export interface IMlGroupAttributionDoc extends Document {
  attributionId: string;
  task: string;
  network: string;
  matrixId: string;
  baseModelId: string;
  basePack: string;
  datasetId: string;
  groups: IGroupAttribution[];
  summary: {
    totalGroups: number;
    corePositive: number;
    weakPositive: number;
    neutral: number;
    negative: number;
    unstable: number;
    topContributor: string | null;
    topContribution: number;
  };
  createdAt: Date;
}

const GroupAttributionSchema = new Schema<IGroupAttribution>({
  group: { type: String, required: true },
  deltaF1: { type: Number, required: true },
  deltaAccuracy: { type: Number, required: true },
  deltaPrecision: { type: Number, default: 0 },
  deltaRecall: { type: Number, default: 0 },
  stability: { type: String, enum: ['STABLE', 'UNSTABLE', 'UNKNOWN'], default: 'UNKNOWN' },
  verdict: { type: String, required: true },
  confidence: { type: Number, default: 0 },
  sampleSize: { type: Number, default: 0 },
  reasons: [{ type: String }],
}, { _id: false });

const MlGroupAttributionSchema = new Schema<IMlGroupAttributionDoc>({
  attributionId: { type: String, required: true, unique: true, index: true },
  task: { type: String, required: true },
  network: { type: String, required: true, index: true },
  matrixId: { type: String, required: true },
  baseModelId: { type: String, required: true },
  basePack: { type: String, required: true },
  datasetId: { type: String, required: true },
  groups: [GroupAttributionSchema],
  summary: {
    totalGroups: { type: Number, default: 0 },
    corePositive: { type: Number, default: 0 },
    weakPositive: { type: Number, default: 0 },
    neutral: { type: Number, default: 0 },
    negative: { type: Number, default: 0 },
    unstable: { type: Number, default: 0 },
    topContributor: { type: String, default: null },
    topContribution: { type: Number, default: 0 },
  },
  createdAt: { type: Date, default: Date.now, index: true },
});

// Compound index for queries
MlGroupAttributionSchema.index({ network: 1, task: 1, createdAt: -1 });

export const MlGroupAttribution = mongoose.model<IMlGroupAttributionDoc>(
  'MlGroupAttribution',
  MlGroupAttributionSchema,
  'ml_group_attribution'
);
