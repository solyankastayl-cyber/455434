/**
 * SPX MEMORY LAYER — Snapshot Model
 * 
 * BLOCK B6.1 — MongoDB model for SPX snapshots
 * 
 * Collection: spx_snapshots (isolated from btc_snapshots)
 */

import mongoose, { Schema, model } from 'mongoose';
import type { SpxSnapshotDoc } from './spx-memory.types.js';

const { models } = mongoose;

const SpxSnapshotSchema = new Schema<SpxSnapshotDoc>(
  {
    symbol: { 
      type: String, 
      enum: ['SPX'], 
      required: true, 
      default: 'SPX', 
      index: true 
    },
    asOfDate: { 
      type: String, 
      required: true, 
      index: true 
    },
    source: { 
      type: String, 
      required: true, 
      index: true 
    },
    preset: { 
      type: String, 
      required: true, 
      index: true 
    },

    horizon: { 
      type: String, 
      required: true, 
      index: true 
    },
    tier: { 
      type: String, 
      required: true, 
      index: true 
    },

    direction: { 
      type: String, 
      required: true 
    },
    action: { 
      type: String, 
      required: true 
    },

    consensusIndex: { 
      type: Number, 
      required: true 
    },
    conflictLevel: { 
      type: String, 
      required: true 
    },
    structuralLock: { 
      type: Boolean, 
      required: true 
    },

    sizeMultiplier: { 
      type: Number, 
      required: true 
    },
    confidence: { 
      type: Number, 
      required: true 
    },

    phaseType: { type: String },
    phaseGrade: { type: String },
    divergenceScore: { type: Number },
    divergenceGrade: { type: String },

    primaryMatchId: { type: String },
    matchesCount: { type: Number },

    policyHash: { 
      type: String, 
      required: true 
    },
    engineVersion: { 
      type: String, 
      required: true 
    },
  },
  { 
    timestamps: true,
    collection: 'spx_snapshots',
  }
);

// Idempotency key: unique per (date, source, preset, horizon)
SpxSnapshotSchema.index(
  { symbol: 1, asOfDate: 1, source: 1, preset: 1, horizon: 1 },
  { unique: true, name: 'spx_snapshot_unique_key' }
);

// Query indexes
SpxSnapshotSchema.index({ horizon: 1, source: 1 });
SpxSnapshotSchema.index({ asOfDate: 1, horizon: 1 });
SpxSnapshotSchema.index({ source: 1, createdAt: -1 });

export const SpxSnapshotModel = 
  models.SpxSnapshot || model<SpxSnapshotDoc>('SpxSnapshot', SpxSnapshotSchema);

export default SpxSnapshotModel;
