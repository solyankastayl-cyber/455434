/**
 * Live Runtime Config Model
 * 
 * Singleton document that controls LIVE ingestion behavior.
 * Separate from ML config for isolation.
 * 
 * Priority: ENV Kill Switch > Runtime Config > Default (OFF)
 */
import mongoose from 'mongoose';

export interface ILiveRuntimeConfig {
  // Master switch
  enabled: boolean;
  
  // Mode
  mode: 'OFF' | 'CANARY';
  
  // State tracking
  lastRun?: Date;
  lastBlock?: number;
  lastProvider?: 'infura' | 'ankr';
  
  // Kill Switch
  killSwitchArmed: boolean;
  killReason?: string;
  
  // Metrics (rolling window)
  metrics: {
    eventsIngested24h: number;
    duplicates24h: number;
    errors24h: number;
    lastErrorAt?: Date;
    lastError?: string;
    approvalPassRate?: number;
  };
  
  // Audit
  updatedAt: Date;
  updatedBy: 'system' | 'operator';
}

const LiveRuntimeConfigSchema = new mongoose.Schema<ILiveRuntimeConfig>({
  enabled: {
    type: Boolean,
    required: true,
    default: false,
  },
  mode: {
    type: String,
    enum: ['OFF', 'CANARY'],
    required: true,
    default: 'OFF',
  },
  lastRun: {
    type: Date,
    required: false,
  },
  lastBlock: {
    type: Number,
    required: false,
  },
  lastProvider: {
    type: String,
    enum: ['infura', 'ankr'],
    required: false,
  },
  killSwitchArmed: {
    type: Boolean,
    required: true,
    default: false,
  },
  killReason: {
    type: String,
    required: false,
  },
  metrics: {
    eventsIngested24h: { type: Number, default: 0 },
    duplicates24h: { type: Number, default: 0 },
    errors24h: { type: Number, default: 0 },
    lastErrorAt: { type: Date, required: false },
    lastError: { type: String, required: false },
    approvalPassRate: { type: Number, required: false },
  },
  updatedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  updatedBy: {
    type: String,
    enum: ['system', 'operator'],
    required: true,
    default: 'system',
  },
}, {
  collection: 'live_runtime_config',
  timestamps: false,
});

// Ensure singleton
LiveRuntimeConfigSchema.index({ _id: 1 }, { unique: true });

export const LiveRuntimeConfigModel = mongoose.model<ILiveRuntimeConfig>(
  'LiveRuntimeConfig',
  LiveRuntimeConfigSchema
);

/**
 * Initialize default config if not exists
 */
export async function ensureLiveDefaultConfig(): Promise<void> {
  const count = await LiveRuntimeConfigModel.countDocuments();
  
  if (count === 0) {
    await LiveRuntimeConfigModel.create({
      enabled: false,
      mode: 'OFF',
      killSwitchArmed: false,
      metrics: {
        eventsIngested24h: 0,
        duplicates24h: 0,
        errors24h: 0,
      },
      updatedAt: new Date(),
      updatedBy: 'system',
    });
    console.log('[Live Runtime] Default config created (ingestion disabled)');
  }
}
