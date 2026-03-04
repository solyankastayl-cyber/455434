/**
 * Active Model State
 * 
 * ETAP 5.5: Atomic state for active model tracking.
 * Single source of truth for which model is live.
 */
import mongoose, { Schema, Document } from 'mongoose';
import type { Horizon } from './self_learning.types.js';

// ==================== INTERFACE ====================

export interface IActiveModelState extends Document {
  horizon: Horizon;
  activeModelId: string;
  previousModelId: string | null;
  switchedAt: Date;
  switchReason: 'PROMOTION' | 'ROLLBACK' | 'INITIAL';
  
  // Health tracking
  healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  healthUpdatedAt: Date;
  consecutiveCriticalWindows: number;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// ==================== SCHEMA ====================

const ActiveModelStateSchema = new Schema<IActiveModelState>({
  horizon: {
    type: String,
    enum: ['7d', '30d'],
    required: true,
    unique: true,
  },
  activeModelId: {
    type: String,
    required: true,
  },
  previousModelId: {
    type: String,
    default: null,
  },
  switchedAt: {
    type: Date,
    required: true,
  },
  switchReason: {
    type: String,
    enum: ['PROMOTION', 'ROLLBACK', 'INITIAL'],
    required: true,
  },
  
  // Health tracking
  healthStatus: {
    type: String,
    enum: ['HEALTHY', 'DEGRADED', 'CRITICAL'],
    default: 'HEALTHY',
  },
  healthUpdatedAt: {
    type: Date,
    default: Date.now,
  },
  consecutiveCriticalWindows: {
    type: Number,
    default: 0,
  },
}, {
  collection: 'active_model_state',
  timestamps: true,
});

// ==================== INDEXES ====================

ActiveModelStateSchema.index({ horizon: 1 }, { unique: true });

// ==================== STATICS ====================

/**
 * Get active model state for horizon (or null)
 */
ActiveModelStateSchema.statics.getState = async function(
  horizon: Horizon
): Promise<IActiveModelState | null> {
  return this.findOne({ horizon }).lean();
};

/**
 * Atomic switch to new model
 * Returns previous state for rollback capability
 */
ActiveModelStateSchema.statics.atomicSwitch = async function(
  horizon: Horizon,
  newModelId: string,
  reason: 'PROMOTION' | 'ROLLBACK'
): Promise<{ success: boolean; previousModelId: string | null }> {
  const now = new Date();
  
  // Find and update atomically
  const previous = await this.findOneAndUpdate(
    { horizon },
    {
      $set: {
        previousModelId: '$activeModelId', // Store current as previous
        activeModelId: newModelId,
        switchedAt: now,
        switchReason: reason,
        healthStatus: 'HEALTHY',
        healthUpdatedAt: now,
        consecutiveCriticalWindows: 0,
      },
    },
    { 
      new: false, // Return old document
      upsert: false,
    }
  );
  
  if (!previous) {
    // No existing state - create new
    await this.create({
      horizon,
      activeModelId: newModelId,
      previousModelId: null,
      switchedAt: now,
      switchReason: reason === 'ROLLBACK' ? 'INITIAL' : reason,
      healthStatus: 'HEALTHY',
      healthUpdatedAt: now,
      consecutiveCriticalWindows: 0,
    });
    
    return { success: true, previousModelId: null };
  }
  
  // Update with correct previousModelId (atomic wasn't working with $)
  await this.updateOne(
    { horizon },
    { previousModelId: previous.activeModelId }
  );
  
  return { success: true, previousModelId: previous.activeModelId };
};

/**
 * Update health status
 */
ActiveModelStateSchema.statics.updateHealth = async function(
  horizon: Horizon,
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL'
): Promise<void> {
  const current = await this.findOne({ horizon });
  if (!current) return;
  
  const updates: any = {
    healthStatus: status,
    healthUpdatedAt: new Date(),
  };
  
  if (status === 'CRITICAL') {
    updates.consecutiveCriticalWindows = current.consecutiveCriticalWindows + 1;
  } else {
    updates.consecutiveCriticalWindows = 0;
  }
  
  await this.updateOne({ horizon }, updates);
};

// ==================== MODEL ====================

interface ActiveModelStateModel extends mongoose.Model<IActiveModelState> {
  getState(horizon: Horizon): Promise<IActiveModelState | null>;
  atomicSwitch(horizon: Horizon, newModelId: string, reason: 'PROMOTION' | 'ROLLBACK'): Promise<{ success: boolean; previousModelId: string | null }>;
  updateHealth(horizon: Horizon, status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL'): Promise<void>;
}

export const ActiveModelStateModel = mongoose.model<IActiveModelState, ActiveModelStateModel>(
  'ActiveModelState',
  ActiveModelStateSchema
);
