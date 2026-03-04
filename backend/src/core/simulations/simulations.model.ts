/**
 * Simulations MongoDB Model (L11.3 - Virtual Performance Engine)
 * 
 * Tracks hypothetical performance of decisions.
 * "What if user had followed this decision?"
 * 
 * Uses price data to simulate outcomes.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Simulation status
 */
export type SimulationStatus = 'active' | 'completed' | 'invalidated';

/**
 * Simulation Document Interface
 */
export interface ISimulation extends Document {
  _id: Types.ObjectId;
  
  // Source
  decisionId: string;
  actionId?: string;
  
  // Target
  targetType: 'actor' | 'strategy' | 'signal';
  targetId: string;
  
  // Entry
  entryTimestamp: Date;
  entryPrice?: number;  // If tracking specific asset
  entryCompositeScore: number;
  
  // Current state
  status: SimulationStatus;
  
  // Performance tracking
  checkpoints: {
    timestamp: Date;
    priceChange?: number;  // % change from entry
    scoreChange: number;   // Change in composite score
    notes: string[];
  }[];
  
  // Final result (when completed)
  exitTimestamp?: Date;
  exitPrice?: number;
  exitCompositeScore?: number;
  
  // Calculated metrics
  performance: {
    priceReturn?: number;     // % price change
    scoreReturn: number;      // Score change
    maxDrawdown?: number;     // Max negative % from peak
    holdingPeriodDays: number;
    outcome: 'positive' | 'negative' | 'neutral' | 'pending';
  };
  
  // Metadata
  simulationType: 'follow' | 'copy' | 'watch';
  hypotheticalAllocation: number;  // % of portfolio
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Checkpoint Schema
 */
const CheckpointSchema = new Schema(
  {
    timestamp: { type: Date, required: true },
    priceChange: Number,
    scoreChange: { type: Number, required: true },
    notes: { type: [String], default: [] },
  },
  { _id: false }
);

/**
 * Performance Schema
 */
const PerformanceSchema = new Schema(
  {
    priceReturn: Number,
    scoreReturn: { type: Number, default: 0 },
    maxDrawdown: Number,
    holdingPeriodDays: { type: Number, default: 0 },
    outcome: {
      type: String,
      enum: ['positive', 'negative', 'neutral', 'pending'],
      default: 'pending',
    },
  },
  { _id: false }
);

/**
 * Simulation Schema
 */
const SimulationSchema = new Schema<ISimulation>(
  {
    // Source
    decisionId: {
      type: String,
      required: true,
      index: true,
    },
    actionId: {
      type: String,
      index: true,
    },
    
    // Target
    targetType: {
      type: String,
      enum: ['actor', 'strategy', 'signal'],
      required: true,
    },
    targetId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    // Entry
    entryTimestamp: {
      type: Date,
      required: true,
    },
    entryPrice: Number,
    entryCompositeScore: {
      type: Number,
      required: true,
    },
    
    // Status
    status: {
      type: String,
      enum: ['active', 'completed', 'invalidated'],
      default: 'active',
      index: true,
    },
    
    // Checkpoints
    checkpoints: {
      type: [CheckpointSchema],
      default: [],
    },
    
    // Exit
    exitTimestamp: Date,
    exitPrice: Number,
    exitCompositeScore: Number,
    
    // Performance
    performance: {
      type: PerformanceSchema,
      default: {},
    },
    
    // Metadata
    simulationType: {
      type: String,
      enum: ['follow', 'copy', 'watch'],
      required: true,
    },
    hypotheticalAllocation: {
      type: Number,
      required: true,
      default: 5,
    },
  },
  {
    timestamps: true,
    collection: 'simulations',
  }
);

// Indexes
SimulationSchema.index({ status: 1, createdAt: -1 });
SimulationSchema.index({ targetId: 1, status: 1 });
SimulationSchema.index({ decisionId: 1 });
SimulationSchema.index({ 'performance.outcome': 1 });

export const SimulationModel = mongoose.model<ISimulation>('Simulation', SimulationSchema);

/**
 * Simulation duration limits (days)
 */
export const SIMULATION_MAX_DAYS: Record<string, number> = {
  'follow': 30,
  'copy': 14,
  'watch': 7,
};

/**
 * Outcome thresholds
 */
export const OUTCOME_THRESHOLDS = {
  positive: 5,   // > 5% score improvement
  negative: -5,  // < -5% score decline
};
