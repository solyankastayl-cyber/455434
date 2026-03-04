/**
 * Computed Graph Model
 * Pre-calculated actor graphs stored for fast retrieval
 * 
 * Philosophy: Heavy computation runs in background jobs,
 * API endpoints serve cached results.
 */
import mongoose from 'mongoose';

const ComputedGraphSchema = new mongoose.Schema({
  // Cache key (e.g., "7d", "30d")
  window: { type: String, required: true, index: true },
  
  // Pre-calculated graph data
  nodes: [{
    id: String,
    label: String,
    type: { type: String, default: 'entity' },
    metrics: {
      centralityScore: Number,
      inDegree: Number,
      outDegree: Number,
      totalFlowUsd: Number,
      netFlowUsd: Number,
    },
    dominantPattern: String,
    category: String,
    coverage: Number,
    addressCount: Number,
    ui: {
      color: { type: String, enum: ['green', 'yellow', 'red'] },
      size: Number,
    },
  }],
  
  edges: [{
    id: String,
    from: String,
    to: String,
    flow: {
      direction: { type: String, enum: ['in', 'out', 'bidirectional'] },
      netFlowUsd: Number,
      volumeUsd: Number,
    },
    relationship: {
      type: { type: String },
      strength: Number,
    },
    ui: {
      color: { type: String, enum: ['green', 'red', 'neutral'] },
      width: Number,
    },
    evidence: {
      txCount: Number,
      firstSeen: Date,
      lastSeen: Date,
    },
  }],
  
  // Metadata
  metadata: {
    totalNodes: Number,
    totalEdges: Number,
    window: String,
    calculatedAt: Date,
    limits: {
      MAX_NODES: Number,
      MAX_EDGES: Number,
      MIN_FLOW_USD: Number,
      MAX_TX_SAMPLE: Number,
    },
    buildTimeMs: Number,
  },
  
  // Cache management
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, index: true },
  
}, { 
  collection: 'computed_graphs',
  timestamps: true,
});

// Index for fast lookups
ComputedGraphSchema.index({ window: 1, createdAt: -1 });

// TTL index - auto-delete expired entries
ComputedGraphSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ComputedGraphModel = mongoose.model('ComputedGraph', ComputedGraphSchema);
