/**
 * Graph Snapshot Model (P1.7)
 * 
 * Caches built graph snapshots with TTL.
 * Provides audit trail for graph generation.
 */

import mongoose, { Schema, Document, Model } from 'mongoose';
import { 
  GraphNode, 
  GraphEdge, 
  HighlightedStep, 
  RiskSummary, 
  ExplainBlock 
} from './graph_types.js';
import crypto from 'crypto';

// ============================================
// Types
// ============================================

export interface IGraphSnapshot {
  snapshotId: string;
  kind: 'ADDRESS' | 'ROUTE';
  address?: string;
  routeId?: string;
  
  nodes: GraphNode[];
  edges: GraphEdge[];
  highlightedPath: HighlightedStep[];
  
  riskSummary: RiskSummary;
  explain: ExplainBlock;
  
  generatedAt: number;
  expiresAt: number;
  buildTimeMs: number;
}

export interface IGraphSnapshotDocument extends IGraphSnapshot, Document {
  _id: mongoose.Types.ObjectId;
}

// ============================================
// Schema
// ============================================

const GraphSnapshotSchema = new Schema<IGraphSnapshotDocument>({
  snapshotId: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['ADDRESS', 'ROUTE'], required: true },
  address: { type: String, index: true, sparse: true },
  routeId: { type: String, index: true, sparse: true },
  mode: { type: String, default: 'raw', index: true }, // A3: mode field
  
  nodes: { type: Schema.Types.Mixed, default: [] },
  edges: { type: Schema.Types.Mixed, default: [] },
  highlightedPath: { type: Schema.Types.Mixed, default: [] },
  corridors: { type: Schema.Types.Mixed, default: [] }, // A3: corridors for calibrated
  calibrationMeta: { type: Schema.Types.Mixed }, // A3: calibration metadata
  
  riskSummary: { type: Schema.Types.Mixed, required: true },
  explain: { type: Schema.Types.Mixed, required: true },
  
  generatedAt: { type: Number, required: true },
  expiresAt: { type: Number, required: true, index: true },
  buildTimeMs: { type: Number, required: true }
}, {
  collection: 'graph_snapshots'
});

// TTL index - auto-delete expired snapshots
GraphSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound indexes
GraphSnapshotSchema.index({ kind: 1, address: 1 });
GraphSnapshotSchema.index({ kind: 1, routeId: 1 });

// ============================================
// Model
// ============================================

export const GraphSnapshotModel: Model<IGraphSnapshotDocument> =
  mongoose.models.GraphSnapshot ||
  mongoose.model<IGraphSnapshotDocument>('GraphSnapshot', GraphSnapshotSchema);

// ============================================
// Helper Functions
// ============================================

/**
 * Generate snapshot ID from parameters
 */
export function generateSnapshotId(kind: 'ADDRESS' | 'ROUTE', key: string, options?: any): string {
  const hash = crypto.createHash('sha256');
  hash.update(`${kind}:${key}:${JSON.stringify(options || {})}`);
  return hash.digest('hex').slice(0, 16);
}

/**
 * Get cached snapshot if not expired
 */
export async function getCachedSnapshot(
  kind: 'ADDRESS' | 'ROUTE',
  key: string // Can include mode: "address:mode" or just "address"
): Promise<IGraphSnapshotDocument | null> {
  // A3: Parse mode from key if present (format: "address:mode")
  const [actualKey, mode] = key.includes(':') ? key.split(':') : [key, 'raw'];
  
  const query: any = { kind };
  
  if (kind === 'ADDRESS') {
    query.address = actualKey.toLowerCase();
    if (mode) {
      query.mode = mode; // Include mode in query
    }
  } else {
    query.routeId = actualKey;
    if (mode && mode !== 'raw') {
      query.mode = mode;
    }
  }
  
  const snapshot = await GraphSnapshotModel.findOne(query)
    .sort({ generatedAt: -1 });
  
  if (!snapshot) return null;
  
  // Check if expired
  if (snapshot.expiresAt < Date.now()) {
    return null;
  }
  
  return snapshot;
}

/**
 * Save new snapshot
 * 
 * @param snapshot - Snapshot to save
 * @param cacheKey - Optional cache key with mode (format: "address:mode")
 */
export async function saveSnapshot(
  snapshot: Omit<IGraphSnapshot, 'snapshotId'>,
  cacheKey?: string
): Promise<IGraphSnapshotDocument> {
  // A3: Parse mode from cacheKey if present
  const [actualKey, mode] = cacheKey 
    ? (cacheKey.includes(':') ? cacheKey.split(':') : [cacheKey, 'raw'])
    : [snapshot.kind === 'ADDRESS' ? snapshot.address! : snapshot.routeId!, 'raw'];
  
  const key = snapshot.kind === 'ADDRESS' ? snapshot.address! : snapshot.routeId!;
  const snapshotId = generateSnapshotId(snapshot.kind, `${key}:${mode}`);
  
  // Build query including mode
  const query: any = { snapshotId };
  if (snapshot.kind === 'ADDRESS') {
    query.address = key.toLowerCase();
  } else {
    query.routeId = key;
  }
  if (mode && mode !== 'raw') {
    query.mode = mode;
  }
  
  // Upsert to handle race conditions
  return GraphSnapshotModel.findOneAndUpdate(
    query,
    { ...snapshot, snapshotId, mode },
    { upsert: true, new: true }
  );
}

/**
 * Get snapshot stats
 */
export async function getSnapshotStats(): Promise<{
  total: number;
  byKind: Record<string, number>;
  avgBuildTimeMs: number;
  expired: number;
}> {
  const now = Date.now();
  
  const [total, byKindAgg, avgAgg, expired] = await Promise.all([
    GraphSnapshotModel.countDocuments(),
    GraphSnapshotModel.aggregate([
      { $group: { _id: '$kind', count: { $sum: 1 } } }
    ]),
    GraphSnapshotModel.aggregate([
      { $group: { _id: null, avg: { $avg: '$buildTimeMs' } } }
    ]),
    GraphSnapshotModel.countDocuments({ expiresAt: { $lt: now } })
  ]);
  
  const byKind: Record<string, number> = {};
  for (const item of byKindAgg) {
    byKind[item._id] = item.count;
  }
  
  return {
    total,
    byKind,
    avgBuildTimeMs: Math.round(avgAgg[0]?.avg || 0),
    expired
  };
}
