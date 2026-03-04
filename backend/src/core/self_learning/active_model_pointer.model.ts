/**
 * Active Model Pointer Model (ETAP 5.5)
 * 
 * Singleton per horizon - tracks which model is currently ACTIVE.
 * Stores previous model for instant rollback.
 * 
 * INVARIANTS:
 * - Only ONE active model per horizon at any time
 * - Previous model is always preserved for rollback
 * - All switches are atomic and logged
 */
import mongoose, { Schema, Document } from 'mongoose';

// ==================== TYPES ====================

export type Horizon = '7d' | '30d';

export interface IActiveModelPointer extends Document {
  horizon: Horizon;
  activeModelId: string | null;
  previousModelId: string | null;
  switchedAt: Date;
  switchedBy: string;
  switchReason: string;
  
  // Safety fields
  rollbackCount: number;
  lastRollbackAt: Date | null;
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
}

// ==================== SCHEMA ====================

const ActiveModelPointerSchema = new Schema<IActiveModelPointer>(
  {
    horizon: {
      type: String,
      enum: ['7d', '30d'],
      required: true,
      unique: true,
      index: true,
    },
    activeModelId: {
      type: String,
      default: null,
    },
    previousModelId: {
      type: String,
      default: null,
    },
    switchedAt: {
      type: Date,
      default: Date.now,
    },
    switchedBy: {
      type: String,
      default: 'system',
    },
    switchReason: {
      type: String,
      default: '',
    },
    rollbackCount: {
      type: Number,
      default: 0,
    },
    lastRollbackAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'activemodelpointers',
  }
);

// ==================== MODEL ====================

export const ActiveModelPointerModel = mongoose.model<IActiveModelPointer>(
  'ActiveModelPointer',
  ActiveModelPointerSchema
);

// ==================== OPERATIONS ====================

/**
 * Get current active model pointer for horizon
 * Creates singleton if not exists (with null activeModelId)
 */
export async function getPointer(horizon: Horizon): Promise<IActiveModelPointer> {
  let pointer = await ActiveModelPointerModel.findOne({ horizon });
  
  if (!pointer) {
    pointer = await ActiveModelPointerModel.create({
      horizon,
      activeModelId: null,
      previousModelId: null,
      switchedAt: new Date(),
      switchedBy: 'system',
      switchReason: 'Initial creation',
    });
  }
  
  return pointer;
}

/**
 * Get active model ID for horizon (null if none)
 */
export async function getActiveModelId(horizon: Horizon): Promise<string | null> {
  const pointer = await getPointer(horizon);
  return pointer.activeModelId;
}

/**
 * Get previous model ID for horizon (for rollback)
 */
export async function getPreviousModelId(horizon: Horizon): Promise<string | null> {
  const pointer = await getPointer(horizon);
  return pointer.previousModelId;
}

/**
 * Set active model (atomic switch)
 * 
 * Stores current as previous before switching.
 */
export async function setActiveModel(
  horizon: Horizon,
  modelId: string,
  switchedBy: string,
  reason: string
): Promise<IActiveModelPointer> {
  const pointer = await getPointer(horizon);
  
  const previousId = pointer.activeModelId;
  
  pointer.previousModelId = previousId;
  pointer.activeModelId = modelId;
  pointer.switchedAt = new Date();
  pointer.switchedBy = switchedBy;
  pointer.switchReason = reason;
  
  await pointer.save();
  
  console.log(`[ActiveModelPointer] ${horizon}: ${previousId || 'null'} → ${modelId}`);
  
  return pointer;
}

/**
 * Rollback to previous model
 * 
 * Swaps active ↔ previous.
 */
export async function rollbackToPrevious(
  horizon: Horizon,
  rolledBackBy: string,
  reason: string
): Promise<{ success: boolean; pointer: IActiveModelPointer; rolledBackTo: string | null }> {
  const pointer = await getPointer(horizon);
  
  if (!pointer.previousModelId) {
    return {
      success: false,
      pointer,
      rolledBackTo: null,
    };
  }
  
  const current = pointer.activeModelId;
  const previous = pointer.previousModelId;
  
  pointer.activeModelId = previous;
  pointer.previousModelId = current;
  pointer.switchedAt = new Date();
  pointer.switchedBy = rolledBackBy;
  pointer.switchReason = reason;
  pointer.rollbackCount += 1;
  pointer.lastRollbackAt = new Date();
  
  await pointer.save();
  
  console.log(`[ActiveModelPointer] ROLLBACK ${horizon}: ${current} → ${previous}`);
  
  return {
    success: true,
    pointer,
    rolledBackTo: previous,
  };
}

/**
 * Clear active model (fallback to rules-only)
 */
export async function clearActiveModel(
  horizon: Horizon,
  clearedBy: string,
  reason: string
): Promise<IActiveModelPointer> {
  const pointer = await getPointer(horizon);
  
  pointer.previousModelId = pointer.activeModelId;
  pointer.activeModelId = null;
  pointer.switchedAt = new Date();
  pointer.switchedBy = clearedBy;
  pointer.switchReason = reason;
  
  await pointer.save();
  
  console.log(`[ActiveModelPointer] CLEARED ${horizon} (fallback to rules-only)`);
  
  return pointer;
}

/**
 * Get full state for both horizons
 */
export async function getAllPointers(): Promise<{ '7d': IActiveModelPointer; '30d': IActiveModelPointer }> {
  const [p7d, p30d] = await Promise.all([
    getPointer('7d'),
    getPointer('30d'),
  ]);
  
  return { '7d': p7d, '30d': p30d };
}
