/**
 * Cluster Storage Models
 * MongoDB schemas for cluster runs and assignments
 */

import mongoose, { Schema, Document } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// CLUSTER RUN
// ═══════════════════════════════════════════════════════════════

export interface IClusterRunDoc extends Document {
  runId: string;
  createdAt: Date;
  config: {
    k: number;
    metric: string;
    maxIter: number;
    seedStrategy: string;
  };
  dims: number;
  nSnapshots: number;
  quality: {
    inertia: number;
    avgDistance: number;
    iters: number;
  };
  clusters: Array<{
    clusterId: number;
    label: string;
    size: number;
    centroid: number[];
    stats: {
      meanDistance: number;
      p90Distance: number;
    };
    dominantDims: Array<{
      idx: number;
      name: string;
      value: number;
    }>;
  }>;
}

const ClusterRunSchema = new Schema<IClusterRunDoc>({
  runId: { type: String, required: true, unique: true, index: true },
  createdAt: { type: Date, default: Date.now },
  config: {
    k: { type: Number, required: true },
    metric: { type: String, required: true },
    maxIter: { type: Number, required: true },
    seedStrategy: { type: String, required: true },
  },
  dims: { type: Number, required: true },
  nSnapshots: { type: Number, required: true },
  quality: {
    inertia: { type: Number, required: true },
    avgDistance: { type: Number, required: true },
    iters: { type: Number, required: true },
  },
  clusters: [{
    clusterId: { type: Number, required: true },
    label: { type: String, required: true },
    size: { type: Number, required: true },
    centroid: [{ type: Number }],
    stats: {
      meanDistance: { type: Number, required: true },
      p90Distance: { type: Number, required: true },
    },
    dominantDims: [{
      idx: { type: Number, required: true },
      name: { type: String, required: true },
      value: { type: Number, required: true },
    }],
  }],
}, {
  collection: 'ae_cluster_runs',
});

export const ClusterRunModel = mongoose.model<IClusterRunDoc>('AeClusterRun', ClusterRunSchema);

// ═══════════════════════════════════════════════════════════════
// CLUSTER ASSIGNMENT
// ═══════════════════════════════════════════════════════════════

export interface IClusterAssignDoc extends Document {
  runId: string;
  ts: Date;
  clusterId: number;
  distance: number;
}

const ClusterAssignSchema = new Schema<IClusterAssignDoc>({
  runId: { type: String, required: true, index: true },
  ts: { type: Date, required: true },
  clusterId: { type: Number, required: true },
  distance: { type: Number, required: true },
}, {
  collection: 'ae_cluster_assignments',
});

// Compound index for efficient queries
ClusterAssignSchema.index({ runId: 1, ts: 1 }, { unique: true });
ClusterAssignSchema.index({ runId: 1, clusterId: 1 });

export const ClusterAssignModel = mongoose.model<IClusterAssignDoc>('AeClusterAssign', ClusterAssignSchema);
