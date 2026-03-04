/**
 * ML v2.2: Auto-Retrain Policy Model
 * ML v2.3: Extended with mlVersion and v23Config
 * 
 * Документ на (task, network) определяет:
 * - enabled: включена ли политика
 * - triggers: когда запускать retrain
 * - guards: ограничения (cooldown, max/day)
 * - mlVersion: какую версию ML использовать (v2.1/v2.3)
 * - v23Config: настройки для v2.3 (pruning/weighting)
 * 
 * По умолчанию OFF (enabled=false)
 */

import { Schema, model, Document } from 'mongoose';

export interface ITriggerConfig {
  enabled: boolean;
  minAccuracy7d?: number;  // для accuracy trigger
  minLevel?: 'LOW' | 'MEDIUM' | 'HIGH';  // для drift trigger
  maxHoursSinceRetrain?: number;  // для time trigger
}

export interface IGuardsConfig {
  cooldownMinutes: number;
  maxJobsPerDay: number;
  minRows: number;
}

// ML v2.3: Configuration for feature pruning + sample weighting
export type MlVersionType = 'v2.1' | 'v2.3';
export type PruningModeType = 'OFF' | 'BASIC' | 'IMPORTANCE' | 'CORRELATION' | 'FULL';
export type WeightingModeType = 'OFF' | 'TIME_DECAY' | 'CLASS_WEIGHT' | 'FULL';

export interface IV23Config {
  pruningMode: PruningModeType;
  weightingMode: WeightingModeType;
  minFeatures: number;        // Safety guard: minimum features to keep
  maxFeatureDropPct: number;  // Safety guard: max % features to drop (e.g., 40)
}

export interface IMlRetrainPolicy extends Document {
  task: 'market' | 'actor';
  network: string;
  enabled: boolean;
  
  triggers: {
    accuracy: ITriggerConfig;
    drift: ITriggerConfig;
    time: ITriggerConfig;
  };
  
  guards: IGuardsConfig;
  
  // ML v2.3: ML version selection
  mlVersion: MlVersionType;
  v23Config?: IV23Config;
  
  updatedAtTs: number;
  updatedBy?: {
    id: string;
    email?: string;
  };
}

const TriggerSchema = new Schema({
  enabled: { type: Boolean, default: false },
  minAccuracy7d: { type: Number },
  minLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'] },
  maxHoursSinceRetrain: { type: Number }
}, { _id: false });

// ML v2.3: Config schema
const V23ConfigSchema = new Schema({
  pruningMode: { 
    type: String, 
    enum: ['OFF', 'BASIC', 'IMPORTANCE', 'CORRELATION', 'FULL'],
    default: 'FULL'
  },
  weightingMode: { 
    type: String, 
    enum: ['OFF', 'TIME_DECAY', 'CLASS_WEIGHT', 'FULL'],
    default: 'FULL'
  },
  minFeatures: { type: Number, default: 5 },
  maxFeatureDropPct: { type: Number, default: 40 }
}, { _id: false });

const MlRetrainPolicySchema = new Schema<IMlRetrainPolicy>({
  task: { 
    type: String, 
    required: true, 
    enum: ['market', 'actor'] 
  },
  network: { type: String, required: true },
  enabled: { type: Boolean, default: false },

  triggers: {
    accuracy: { type: TriggerSchema, default: { enabled: false, minAccuracy7d: 0.55 } },
    drift: { type: TriggerSchema, default: { enabled: false, minLevel: 'HIGH' } },
    time: { type: TriggerSchema, default: { enabled: false, maxHoursSinceRetrain: 48 } }
  },

  guards: {
    cooldownMinutes: { type: Number, default: 360 },  // 6 hours
    maxJobsPerDay: { type: Number, default: 2 },
    minRows: { type: Number, default: 500 }
  },

  // ML v2.3: Version selection (defaults to v2.1 for safety)
  mlVersion: { 
    type: String, 
    enum: ['v2.1', 'v2.3'], 
    default: 'v2.1' 
  },
  v23Config: { type: V23ConfigSchema },

  updatedAtTs: { type: Number, default: () => Math.floor(Date.now() / 1000) },
  updatedBy: {
    id: { type: String },
    email: { type: String }
  }
}, { collection: 'ml_retrain_policies' });

// Unique index per task + network
MlRetrainPolicySchema.index({ task: 1, network: 1 }, { unique: true });

export const MlRetrainPolicyModel = model<IMlRetrainPolicy>(
  'MlRetrainPolicy',
  MlRetrainPolicySchema
);

// Default v2.3 config
export const DEFAULT_V23_CONFIG: IV23Config = {
  pruningMode: 'FULL',
  weightingMode: 'FULL',
  minFeatures: 5,
  maxFeatureDropPct: 40,
};

/**
 * Seed default policies (all disabled)
 */
export async function seedDefaultPolicies(): Promise<void> {
  const tasks: Array<'market' | 'actor'> = ['market', 'actor'];
  const networks = ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'bsc', 'avalanche', 'fantom'];

  for (const task of tasks) {
    for (const network of networks) {
      await MlRetrainPolicyModel.findOneAndUpdate(
        { task, network },
        {
          $setOnInsert: {
            task,
            network,
            enabled: false,
            triggers: {
              accuracy: { enabled: false, minAccuracy7d: 0.55 },
              drift: { enabled: false, minLevel: 'HIGH' },
              time: { enabled: false, maxHoursSinceRetrain: 48 }
            },
            guards: {
              cooldownMinutes: 360,
              maxJobsPerDay: 2,
              minRows: 500
            },
            mlVersion: 'v2.1',  // Safe default
            v23Config: DEFAULT_V23_CONFIG,
            updatedAtTs: Math.floor(Date.now() / 1000)
          }
        },
        { upsert: true }
      );
    }
  }
  
  console.log('[v2.2] Default auto-retrain policies seeded (all disabled, mlVersion=v2.1)');
}
