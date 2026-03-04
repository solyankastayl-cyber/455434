/**
 * Self-Learning Runtime Model
 * 
 * ETAP 5.1: Singleton configuration for self-learning system.
 * Controls scheduler, guards, and overall state.
 */
import mongoose, { Schema, Document } from 'mongoose';
import type { SelfLearningRuntimeConfig, Horizon, GateDecision } from './self_learning.types.js';
import { SELF_LEARNING_CONSTANTS } from './self_learning.types.js';

// ==================== INTERFACE ====================

export interface ISelfLearningRuntime extends Document, SelfLearningRuntimeConfig {}

// ==================== SCHEMA ====================

const SelfLearningRuntimeSchema = new Schema<ISelfLearningRuntime>({
  enabled: {
    type: Boolean,
    default: false,
  },
  mode: {
    type: String,
    enum: ['OFF', 'SHADOW', 'ACTIVE'],
    default: 'OFF',
  },
  horizons: {
    type: [String],
    enum: ['7d', '30d'],
    default: ['7d', '30d'],
  },
  
  // Schedule
  scheduleEnabled: {
    type: Boolean,
    default: false,
  },
  scheduleCron: {
    type: String,
    default: '0 3 * * *', // Daily at 3am
  },
  
  // Last run info
  lastRetrainAt: {
    type: Date,
    default: null,
  },
  lastRetrainHorizon: {
    type: String,
    enum: ['7d', '30d', null],
    default: null,
  },
  lastRetrainDecision: {
    type: String,
    enum: ['PROMOTE', 'HOLD', 'REJECT', null],
    default: null,
  },
  lastRetrainModelVersion: {
    type: String,
    default: null,
  },
  
  // Guards config
  minNewSamples: {
    type: Number,
    default: SELF_LEARNING_CONSTANTS.MIN_NEW_SAMPLES,
  },
  cooldownDays: {
    type: Number,
    default: SELF_LEARNING_CONSTANTS.COOLDOWN_DAYS,
  },
}, {
  collection: 'self_learning_runtime',
  timestamps: true,
});

// ==================== INDEXES ====================

// Only one document should exist
SelfLearningRuntimeSchema.index({}, { unique: true });

// ==================== STATICS ====================

SelfLearningRuntimeSchema.statics.getConfig = async function(): Promise<ISelfLearningRuntime> {
  let config = await this.findOne();
  
  if (!config) {
    config = await this.create({
      enabled: false,
      mode: 'OFF',
      horizons: ['7d', '30d'],
      scheduleEnabled: false,
      scheduleCron: '0 3 * * *',
      minNewSamples: SELF_LEARNING_CONSTANTS.MIN_NEW_SAMPLES,
      cooldownDays: SELF_LEARNING_CONSTANTS.COOLDOWN_DAYS,
    });
  }
  
  return config;
};

SelfLearningRuntimeSchema.statics.updateConfig = async function(
  updates: Partial<SelfLearningRuntimeConfig>
): Promise<ISelfLearningRuntime> {
  const config = await this.getConfig();
  
  Object.assign(config, updates, { updatedAt: new Date() });
  await config.save();
  
  return config;
};

SelfLearningRuntimeSchema.statics.recordRetrainResult = async function(
  horizon: Horizon,
  decision: GateDecision,
  modelVersion: string | null
): Promise<ISelfLearningRuntime> {
  return this.updateConfig({
    lastRetrainAt: new Date(),
    lastRetrainHorizon: horizon,
    lastRetrainDecision: decision,
    lastRetrainModelVersion: modelVersion,
  });
};

// ==================== MODEL ====================

interface SelfLearningRuntimeModel extends mongoose.Model<ISelfLearningRuntime> {
  getConfig(): Promise<ISelfLearningRuntime>;
  updateConfig(updates: Partial<SelfLearningRuntimeConfig>): Promise<ISelfLearningRuntime>;
  recordRetrainResult(horizon: Horizon, decision: GateDecision, modelVersion: string | null): Promise<ISelfLearningRuntime>;
}

export const SelfLearningRuntimeModel = mongoose.model<ISelfLearningRuntime, SelfLearningRuntimeModel>(
  'SelfLearningRuntime',
  SelfLearningRuntimeSchema
);
