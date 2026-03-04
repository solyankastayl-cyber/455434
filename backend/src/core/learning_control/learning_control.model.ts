/**
 * Learning Control Model (Phase 12C.1)
 * 
 * Manages system-wide learning parameters and safety controls.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';
import { env } from '../../config/env.js';

export type ControlStatus = 'active' | 'frozen' | 'degraded' | 'manual_override';

export interface ILearningControl extends Document {
  _id: Types.ObjectId;
  
  // System identifier
  controlId: string;  // 'global' or specific scope
  
  // Status
  status: ControlStatus;
  statusReason?: string;
  statusChangedAt: Date;
  
  // Learning rate management
  baseLearningRate: number;
  effectiveLearningRate: number;
  learningRateDecayFactor: number;  // For age-based decay
  learningRateHalfLife: number;     // Days until LR halves
  
  // Drift guards
  driftThreshold: number;           // Max allowed total drift
  currentMaxDrift: number;          // Current maximum drift across all weights
  driftFreezeCount: number;         // Number of weights frozen due to drift
  
  // Confidence controls
  confidenceFloor: number;
  minEvidenceForLearning: number;   // Minimum events before learning kicks in
  
  // Safety metrics
  totalFreezeEvents: number;
  lastFreezeAt?: Date;
  manualOverrideAt?: Date;
  manualOverrideBy?: string;
  
  // Health tracking
  healthScore: number;              // 0-1, overall system health
  lastHealthCheck: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

const LearningControlSchema = new Schema<ILearningControl>(
  {
    controlId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: 'global',
    },
    
    status: {
      type: String,
      enum: ['active', 'frozen', 'degraded', 'manual_override'],
      default: 'active',
    },
    statusReason: String,
    statusChangedAt: {
      type: Date,
      default: Date.now,
    },
    
    baseLearningRate: {
      type: Number,
      default: () => env.ADAPTIVE_LEARNING_RATE,
    },
    effectiveLearningRate: {
      type: Number,
      default: () => env.ADAPTIVE_LEARNING_RATE,
    },
    learningRateDecayFactor: {
      type: Number,
      default: 1.0,
    },
    learningRateHalfLife: {
      type: Number,
      default: 30,  // 30 days
    },
    
    driftThreshold: {
      type: Number,
      default: () => env.ADAPTIVE_WEIGHT_CORRIDOR,
    },
    currentMaxDrift: {
      type: Number,
      default: 0,
    },
    driftFreezeCount: {
      type: Number,
      default: 0,
    },
    
    confidenceFloor: {
      type: Number,
      default: () => env.CONFIDENCE_FLOOR,
    },
    minEvidenceForLearning: {
      type: Number,
      default: 5,
    },
    
    totalFreezeEvents: {
      type: Number,
      default: 0,
    },
    lastFreezeAt: Date,
    manualOverrideAt: Date,
    manualOverrideBy: String,
    
    healthScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 1.0,
    },
    lastHealthCheck: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'learning_control',
  }
);

export const LearningControlModel = mongoose.model<ILearningControl>(
  'LearningControl',
  LearningControlSchema
);

/**
 * Calculate effective learning rate with decay
 * effectiveLR = baseLR * exp(-age / halfLife)
 */
export function calculateEffectiveLearningRate(
  baseLR: number,
  ageInDays: number,
  halfLife: number
): number {
  return baseLR * Math.exp(-ageInDays * Math.LN2 / halfLife);
}
