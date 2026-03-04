/**
 * Model Evaluation Report Model (ETAP 5.4)
 * 
 * Records evaluation gate decisions for each candidate model.
 * Every candidate MUST have an evaluation report.
 */
import mongoose from 'mongoose';

export type EvaluationDecision = 
  | 'APPROVED'       // Passed all gates
  | 'REJECTED'       // Failed absolute or relative gates
  | 'BLOCKED'        // Hard block (drift, insufficient data, etc.)
  | 'INCONCLUSIVE';  // Not enough data to decide

const MetricsDeltaSchema = new mongoose.Schema({
  precision: { type: Number },
  recall: { type: Number },
  f1: { type: Number },
  prAuc: { type: Number },
  fpRate: { type: Number },
  calibrationError: { type: Number },
  lift: { type: Number },
}, { _id: false });

const MetricsSnapshotSchema = new mongoose.Schema({
  precision: { type: Number },
  recall: { type: Number },
  f1: { type: Number },
  prAuc: { type: Number },
  fpRate: { type: Number },
  calibrationError: { type: Number },
  lift: { type: Number },
  coverage: { type: Number }, // % of predictions above threshold
}, { _id: false });

const GateCheckSchema = new mongoose.Schema({
  name: { type: String, required: true },
  passed: { type: Boolean, required: true },
  value: { type: Number },
  threshold: { type: Number },
  reason: { type: String },
}, { _id: false });

const ModelEvaluationReportSchema = new mongoose.Schema({
  // ========== REPORT ID ==========
  evaluationId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  
  // ========== CANDIDATE ==========
  candidateModelId: {
    type: String,
    required: true,
    index: true,
  },
  
  horizon: {
    type: String,
    enum: ['7d', '30d'],
    required: true,
  },
  
  // ========== BASELINES ==========
  rulesBaselineId: {
    type: String,
    default: 'rules_engine_v1',
  },
  
  activeModelId: {
    type: String, // null if no active model
  },
  
  // ========== DATASET ==========
  datasetVersionId: {
    type: String,
    required: true,
  },
  
  evalSampleCount: {
    type: Number,
    required: true,
  },
  
  // ========== DECISION ==========
  decision: {
    type: String,
    enum: ['APPROVED', 'REJECTED', 'BLOCKED', 'INCONCLUSIVE'],
    required: true,
    index: true,
  },
  
  reasons: [{
    type: String,
  }],
  
  // ========== GATE CHECKS ==========
  gateChecks: {
    absolute: [GateCheckSchema],
    relative: [GateCheckSchema],
    risk: [GateCheckSchema],
    drift: [GateCheckSchema],
  },
  
  // ========== METRICS ==========
  candidateMetrics: {
    type: MetricsSnapshotSchema,
    required: true,
  },
  
  rulesMetrics: {
    type: MetricsSnapshotSchema,
    required: true,
  },
  
  activeModelMetrics: {
    type: MetricsSnapshotSchema,
  },
  
  // ========== DELTAS ==========
  vsRules: {
    type: MetricsDeltaSchema,
    required: true,
  },
  
  vsActiveModel: {
    type: MetricsDeltaSchema,
  },
  
  // ========== THRESHOLDS SNAPSHOT ==========
  thresholdsSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  
  // ========== METADATA ==========
  evaluatedAt: {
    type: Date,
    default: Date.now,
    required: true,
    index: true,
  },
  
  evaluatedBy: {
    type: String,
    enum: ['scheduler', 'manual'],
    default: 'scheduler',
  },
  
  notes: {
    type: String,
  },
}, {
  collection: 'model_evaluation_reports',
  timestamps: false, // Using evaluatedAt
});

// Indexes
ModelEvaluationReportSchema.index({ candidateModelId: 1 });
ModelEvaluationReportSchema.index({ horizon: 1, decision: 1, evaluatedAt: -1 });
ModelEvaluationReportSchema.index({ decision: 1, evaluatedAt: -1 });

export const ModelEvaluationReportModel = mongoose.model(
  'ModelEvaluationReport',
  ModelEvaluationReportSchema
);

/**
 * Generate evaluation ID
 */
export function generateEvaluationId(candidateModelId: string): string {
  const timestamp = Date.now();
  return `eval_${candidateModelId}_${timestamp}`;
}

/**
 * Get latest evaluation for candidate
 */
export async function getEvaluationForCandidate(candidateModelId: string) {
  return ModelEvaluationReportModel
    .findOne({ candidateModelId })
    .sort({ evaluatedAt: -1 })
    .lean();
}

/**
 * Get recent evaluations
 */
export async function getRecentEvaluations(
  limit: number = 50,
  filters?: {
    horizon?: '7d' | '30d';
    decision?: EvaluationDecision;
    since?: Date;
  }
) {
  const query: any = {};
  
  if (filters?.horizon) query.horizon = filters.horizon;
  if (filters?.decision) query.decision = filters.decision;
  if (filters?.since) query.evaluatedAt = { $gte: filters.since };
  
  return ModelEvaluationReportModel
    .find(query)
    .sort({ evaluatedAt: -1 })
    .limit(limit)
    .lean();
}
