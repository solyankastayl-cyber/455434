/**
 * ML Training Run Storage (P0.8)
 * 
 * Stores training run history and audit logs.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type TrainingRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type TrainingTrigger = 'SCHEDULED' | 'MANUAL' | 'DRIFT_DETECTED' | 'CALIBRATION';

export interface ITrainingRunConfig {
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  validationSplit?: number;
  earlyStopping?: boolean;
  customParams?: Record<string, any>;
}

export interface ITrainingRunMetrics {
  loss?: number;
  valLoss?: number;
  epochs?: number;
  bestEpoch?: number;
  trainingTime?: number;
  samplesProcessed?: number;
  custom?: Record<string, number>;
}

export interface ITrainingRun {
  runId: string;
  modelType: string;
  targetVersion: string;
  status: TrainingRunStatus;
  trigger: TrainingTrigger;
  
  // Timing
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  
  // Dataset info
  datasetVersion: string;
  trainSamples: number;
  valSamples: number;
  featureCount: number;
  taxonomyVersion: string;
  
  // Quality gates check
  gatesCheckPassed: boolean;
  gatesCheckResult?: {
    coverage: number;
    qualityScore: number;
    blockedBy?: string[];
  };
  
  // Training config
  config?: ITrainingRunConfig;
  
  // Results
  metrics?: ITrainingRunMetrics;
  outputModelId?: string;
  
  // Error info
  errorMessage?: string;
  errorStack?: string;
  
  // Metadata
  triggeredBy?: string;
  notes?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

export interface ITrainingRunDocument extends ITrainingRun, Document {}

// ============================================
// Schema
// ============================================

const TrainingRunSchema = new Schema<ITrainingRunDocument>({
  runId: { type: String, required: true, unique: true, index: true },
  modelType: { type: String, required: true, index: true },
  targetVersion: { type: String, required: true },
  status: { 
    type: String, 
    required: true,
    enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
    index: true
  },
  trigger: { 
    type: String, 
    required: true,
    enum: ['SCHEDULED', 'MANUAL', 'DRIFT_DETECTED', 'CALIBRATION']
  },
  
  startedAt: { type: Date },
  completedAt: { type: Date },
  durationMs: { type: Number },
  
  datasetVersion: { type: String, required: true },
  trainSamples: { type: Number, required: true },
  valSamples: { type: Number, required: true },
  featureCount: { type: Number, required: true },
  taxonomyVersion: { type: String, required: true },
  
  gatesCheckPassed: { type: Boolean, required: true },
  gatesCheckResult: {
    coverage: { type: Number },
    qualityScore: { type: Number },
    blockedBy: [{ type: String }]
  },
  
  config: {
    epochs: { type: Number },
    batchSize: { type: Number },
    learningRate: { type: Number },
    validationSplit: { type: Number },
    earlyStopping: { type: Boolean },
    customParams: { type: Map, of: Schema.Types.Mixed }
  },
  
  metrics: {
    loss: { type: Number },
    valLoss: { type: Number },
    epochs: { type: Number },
    bestEpoch: { type: Number },
    trainingTime: { type: Number },
    samplesProcessed: { type: Number },
    custom: { type: Map, of: Number }
  },
  
  outputModelId: { type: String, index: true },
  
  errorMessage: { type: String },
  errorStack: { type: String },
  
  triggeredBy: { type: String },
  notes: { type: String },
  
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
});

TrainingRunSchema.index({ modelType: 1, status: 1 });
TrainingRunSchema.index({ status: 1, createdAt: -1 });

// ============================================
// Model
// ============================================

export const TrainingRunModel = mongoose.model<ITrainingRunDocument>('ml_training_runs', TrainingRunSchema);

// ============================================
// Helper Functions
// ============================================

/**
 * Generate run ID
 */
export function generateRunId(modelType: string): string {
  return `RUN:${modelType}:${Date.now()}`;
}

/**
 * Create training run
 */
export async function createTrainingRun(
  run: Omit<ITrainingRun, 'runId' | 'createdAt' | 'updatedAt'>
): Promise<ITrainingRunDocument> {
  const runId = generateRunId(run.modelType);
  
  return TrainingRunModel.create({
    ...run,
    runId,
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

/**
 * Update training run
 */
export async function updateTrainingRun(
  runId: string,
  updates: Partial<ITrainingRun>
): Promise<ITrainingRunDocument | null> {
  return TrainingRunModel.findOneAndUpdate(
    { runId },
    { $set: { ...updates, updatedAt: new Date() } },
    { new: true }
  ).lean();
}

/**
 * Get run by ID
 */
export async function getTrainingRun(runId: string): Promise<ITrainingRunDocument | null> {
  return TrainingRunModel.findOne({ runId }).lean();
}

/**
 * List recent runs
 */
export async function listTrainingRuns(
  filters: { modelType?: string; status?: TrainingRunStatus } = {},
  limit: number = 20
): Promise<ITrainingRunDocument[]> {
  const query: any = {};
  if (filters.modelType) query.modelType = filters.modelType;
  if (filters.status) query.status = filters.status;
  
  return TrainingRunModel.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get training run statistics
 */
export async function getTrainingRunStats(): Promise<{
  totalRuns: number;
  byStatus: Record<string, number>;
  successRate: number;
  avgDurationMs: number;
  gatesBlockedCount: number;
}> {
  const [total, byStatus, completed, failed, durations, blocked] = await Promise.all([
    TrainingRunModel.countDocuments(),
    TrainingRunModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    TrainingRunModel.countDocuments({ status: 'COMPLETED' }),
    TrainingRunModel.countDocuments({ status: 'FAILED' }),
    TrainingRunModel.aggregate([
      { $match: { durationMs: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$durationMs' } } }
    ]),
    TrainingRunModel.countDocuments({ gatesCheckPassed: false })
  ]);
  
  const totalFinished = completed + failed;
  
  return {
    totalRuns: total,
    byStatus: byStatus.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {} as Record<string, number>),
    successRate: totalFinished > 0 ? Math.round((completed / totalFinished) * 100) : 0,
    avgDurationMs: durations[0]?.avg || 0,
    gatesBlockedCount: blocked
  };
}
