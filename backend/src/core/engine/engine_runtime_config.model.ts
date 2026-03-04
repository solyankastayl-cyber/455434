/**
 * Engine Runtime Config Model
 * 
 * Singleton document that controls ML behavior at runtime
 * Priority: Kill Switch > Runtime Config > Default
 */
import mongoose from 'mongoose';

const EngineRuntimeConfigSchema = new mongoose.Schema({
  // ML Control
  mlEnabled: {
    type: Boolean,
    default: false,
    required: true,
  },
  
  mlMode: {
    type: String,
    enum: ['off', 'advisor', 'assist'],
    default: 'off',
    required: true,
  },
  
  // Disable Tracking
  disabledBy: {
    type: String,
    enum: ['system', 'operator'],
    required: false,
  },
  
  disableReason: {
    type: String,
    required: false,
  },
  
  // Audit
  updatedAt: {
    type: Date,
    default: Date.now,
    required: true,
  },
  
  updatedBy: {
    type: String,
    required: false,
  },
}, {
  collection: 'engine_runtime_config',
  timestamps: false, // We handle updatedAt manually
});

// Ensure singleton
EngineRuntimeConfigSchema.index({ _id: 1 }, { unique: true });

export const EngineRuntimeConfigModel = mongoose.model(
  'EngineRuntimeConfig',
  EngineRuntimeConfigSchema
);

/**
 * Initialize default config if not exists
 */
export async function ensureDefaultConfig() {
  const count = await EngineRuntimeConfigModel.countDocuments();
  
  if (count === 0) {
    await EngineRuntimeConfigModel.create({
      mlEnabled: false,
      mlMode: 'off',
      updatedAt: new Date(),
    });
    console.log('[Engine Runtime] Default config created (ML disabled)');
  }
}
