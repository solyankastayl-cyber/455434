/**
 * ML Inference Log Storage (P0.8)
 * 
 * Stores inference requests and results for audit.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export interface IInferenceInput {
  entityType: string;
  entityId: string;
  featureSnapshotId?: string;
  featureHash?: string;
  coveragePercent: number;
  qualityScore: number;
}

export interface IInferenceOutput {
  confidenceModifier: number;
  calibrationOk: boolean;
  rawScore?: number;
  explanation?: string;
}

export interface IInferenceLog {
  inferenceId: string;
  modelId: string;
  modelVersion: string;
  
  // Input
  input: IInferenceInput;
  
  // Gate check
  gatesPassed: boolean;
  gatesBlockedBy?: string[];
  
  // Output (only if gates passed)
  output?: IInferenceOutput;
  
  // Timing
  requestedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  
  // Error
  error?: string;
  
  // Metadata
  requestSource?: string;
  
  createdAt: Date;
}

export interface IInferenceLogDocument extends IInferenceLog, Document {}

// ============================================
// Schema
// ============================================

const InferenceLogSchema = new Schema<IInferenceLogDocument>({
  inferenceId: { type: String, required: true, unique: true, index: true },
  modelId: { type: String, required: true, index: true },
  modelVersion: { type: String, required: true },
  
  input: {
    entityType: { type: String, required: true },
    entityId: { type: String, required: true, index: true },
    featureSnapshotId: { type: String },
    featureHash: { type: String },
    coveragePercent: { type: Number, required: true },
    qualityScore: { type: Number, required: true }
  },
  
  gatesPassed: { type: Boolean, required: true, index: true },
  gatesBlockedBy: [{ type: String }],
  
  output: {
    confidenceModifier: { type: Number },
    calibrationOk: { type: Boolean },
    rawScore: { type: Number },
    explanation: { type: String }
  },
  
  requestedAt: { type: Date, required: true, index: true },
  completedAt: { type: Date },
  durationMs: { type: Number },
  
  error: { type: String },
  
  requestSource: { type: String },
  
  createdAt: { type: Date, default: Date.now }
});

InferenceLogSchema.index({ 'input.entityId': 1, requestedAt: -1 });
InferenceLogSchema.index({ gatesPassed: 1, requestedAt: -1 });

// Expire old logs after 30 days
InferenceLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// ============================================
// Model
// ============================================

export const InferenceLogModel = mongoose.model<IInferenceLogDocument>('ml_inference_logs', InferenceLogSchema);

// ============================================
// Helper Functions
// ============================================

/**
 * Generate inference ID
 */
export function generateInferenceId(): string {
  return `INF:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Log inference request
 */
export async function logInference(
  log: Omit<IInferenceLog, 'inferenceId' | 'createdAt'>
): Promise<IInferenceLogDocument> {
  const inferenceId = generateInferenceId();
  
  return InferenceLogModel.create({
    ...log,
    inferenceId,
    createdAt: new Date()
  });
}

/**
 * Get inference by ID
 */
export async function getInferenceLog(inferenceId: string): Promise<IInferenceLogDocument | null> {
  return InferenceLogModel.findOne({ inferenceId }).lean();
}

/**
 * Get recent inferences for entity
 */
export async function getEntityInferences(
  entityId: string,
  limit: number = 20
): Promise<IInferenceLogDocument[]> {
  return InferenceLogModel.find({
    'input.entityId': entityId.toLowerCase()
  })
  .sort({ requestedAt: -1 })
  .limit(limit)
  .lean();
}

/**
 * Get inference statistics
 */
export async function getInferenceStats(
  since?: Date
): Promise<{
  totalInferences: number;
  gatesPassedCount: number;
  gatesBlockedCount: number;
  avgDurationMs: number;
  avgConfidenceModifier: number;
  errorCount: number;
}> {
  const query: any = {};
  if (since) {
    query.requestedAt = { $gte: since };
  }
  
  const [total, passed, blocked, durations, modifiers, errors] = await Promise.all([
    InferenceLogModel.countDocuments(query),
    InferenceLogModel.countDocuments({ ...query, gatesPassed: true }),
    InferenceLogModel.countDocuments({ ...query, gatesPassed: false }),
    InferenceLogModel.aggregate([
      { $match: { ...query, durationMs: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$durationMs' } } }
    ]),
    InferenceLogModel.aggregate([
      { $match: { ...query, 'output.confidenceModifier': { $exists: true } } },
      { $group: { _id: null, avg: { $avg: '$output.confidenceModifier' } } }
    ]),
    InferenceLogModel.countDocuments({ ...query, error: { $exists: true, $ne: null } })
  ]);
  
  return {
    totalInferences: total,
    gatesPassedCount: passed,
    gatesBlockedCount: blocked,
    avgDurationMs: Math.round(durations[0]?.avg || 0),
    avgConfidenceModifier: Math.round((modifiers[0]?.avg || 0) * 1000) / 1000,
    errorCount: errors
  };
}
