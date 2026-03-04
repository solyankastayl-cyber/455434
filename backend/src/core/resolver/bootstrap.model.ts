/**
 * Bootstrap Queue Model (Phase 15.5.2)
 * 
 * Queue for lazy bootstrapping unknown addresses/tokens
 */
import mongoose, { Schema, Document } from 'mongoose';

export type BootstrapType = 'address' | 'token' | 'entity' | 'ens';
export type BootstrapStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface IBootstrapJob extends Document {
  input: string;                    // Original input
  type: BootstrapType;              // What to bootstrap
  chain: string;
  
  status: BootstrapStatus;
  priority: number;                 // Higher = more urgent
  
  // Progress
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  
  // Results
  discoveredType?: string;
  discoveredData?: Record<string, any>;
  
  createdAt: Date;
  updatedAt: Date;
}

const BootstrapJobSchema = new Schema<IBootstrapJob>(
  {
    input: {
      type: String,
      required: true,
      index: true,
    },
    
    type: {
      type: String,
      enum: ['address', 'token', 'entity', 'ens'],
      required: true,
    },
    
    chain: {
      type: String,
      default: 'ethereum',
    },
    
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    
    priority: {
      type: Number,
      default: 0,
    },
    
    startedAt: Date,
    completedAt: Date,
    error: String,
    
    discoveredType: String,
    discoveredData: Schema.Types.Mixed,
  },
  {
    timestamps: true,
    collection: 'bootstrap_jobs',
  }
);

// Compound index for queue processing
BootstrapJobSchema.index({ status: 1, priority: -1, createdAt: 1 });

export const BootstrapJobModel = mongoose.model<IBootstrapJob>(
  'BootstrapJob',
  BootstrapJobSchema
);
