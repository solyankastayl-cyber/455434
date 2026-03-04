/**
 * P0.1 ML Inference Log Model
 * 
 * Audit trail for all ML predictions.
 * Used for debugging, drift detection, and admin dashboard.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// INTERFACE
// ============================================

export interface IMLInferenceLog extends Document {
  ts: number;
  network: string;
  signalType: 'market' | 'actor' | 'ensemble';
  
  // Model info
  modelVersion: string;
  wasFallback: boolean;
  
  // Features (hash or snapshot)
  featuresHash?: string;
  featuresSnapshot?: Record<string, number>;
  
  // Prediction result
  result: {
    pUp?: number;
    pDown?: number;
    signal?: string;
    label?: string;
    confidence?: number;
    probabilities?: Record<string, number>;
  };
  
  // Ensemble components (for ensemble signals)
  ensemble?: {
    score: number;
    components: {
      exchangePressure?: number;
      zones?: number;
      ml?: number;
    };
  };
  
  // Performance
  latencyMs: number;
  
  // Metadata
  requestId?: string;
  actorId?: string;
  
  createdAt: Date;
}

// ============================================
// SCHEMA
// ============================================

const MLInferenceLogSchema = new Schema<IMLInferenceLog>(
  {
    ts: { type: Number, required: true, index: true },
    network: { type: String, required: true, index: true },
    signalType: { 
      type: String, 
      required: true, 
      enum: ['market', 'actor', 'ensemble'],
      index: true 
    },
    
    modelVersion: { type: String, required: true },
    wasFallback: { type: Boolean, required: true, default: false },
    
    featuresHash: { type: String },
    featuresSnapshot: { type: Schema.Types.Mixed },
    
    result: {
      pUp: { type: Number },
      pDown: { type: Number },
      signal: { type: String },
      label: { type: String },
      confidence: { type: Number },
      probabilities: { type: Schema.Types.Mixed },
    },
    
    ensemble: {
      score: { type: Number },
      components: {
        exchangePressure: { type: Number },
        zones: { type: Number },
        ml: { type: Number },
      },
    },
    
    latencyMs: { type: Number, required: true },
    
    requestId: { type: String },
    actorId: { type: String, index: true },
  },
  {
    timestamps: true,
    collection: 'ml_inference_log',
  }
);

// TTL index: keep logs for 90 days
MLInferenceLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Compound indexes for common queries
MLInferenceLogSchema.index({ network: 1, signalType: 1, ts: -1 });
MLInferenceLogSchema.index({ wasFallback: 1, ts: -1 });

export const MLInferenceLogModel = mongoose.model<IMLInferenceLog>(
  'MLInferenceLog',
  MLInferenceLogSchema
);

// ============================================
// LOGGING FUNCTIONS
// ============================================

export interface LogMarketParams {
  network: string;
  modelVersion: string;
  wasFallback: boolean;
  features: {
    exchangePressure: number;
    accZoneStrength: number;
    distZoneStrength: number;
    corridorsEntropy: number;
  };
  result: {
    pUp: number;
    pDown: number;
    signal: string;
    confidence: number;
  };
  latencyMs: number;
  requestId?: string;
}

export async function logMarketInference(params: LogMarketParams): Promise<void> {
  try {
    await MLInferenceLogModel.create({
      ts: Math.floor(Date.now() / 1000),
      network: params.network,
      signalType: 'market',
      modelVersion: params.modelVersion,
      wasFallback: params.wasFallback,
      featuresSnapshot: params.features,
      result: {
        pUp: params.result.pUp,
        pDown: params.result.pDown,
        signal: params.result.signal,
        confidence: params.result.confidence,
      },
      latencyMs: params.latencyMs,
      requestId: params.requestId,
    });
  } catch (err) {
    console.error('[MLLog] Failed to log market inference:', err);
  }
}

export interface LogActorParams {
  network: string;
  actorId: string;
  modelVersion: string;
  wasFallback: boolean;
  features: Record<string, number>;
  result: {
    label: string;
    confidence: number;
    probabilities: Record<string, number>;
  };
  latencyMs: number;
  requestId?: string;
}

export async function logActorInference(params: LogActorParams): Promise<void> {
  try {
    await MLInferenceLogModel.create({
      ts: Math.floor(Date.now() / 1000),
      network: params.network,
      signalType: 'actor',
      modelVersion: params.modelVersion,
      wasFallback: params.wasFallback,
      featuresSnapshot: params.features,
      result: {
        label: params.result.label,
        confidence: params.result.confidence,
        probabilities: params.result.probabilities,
      },
      latencyMs: params.latencyMs,
      requestId: params.requestId,
      actorId: params.actorId,
    });
  } catch (err) {
    console.error('[MLLog] Failed to log actor inference:', err);
  }
}

export interface LogEnsembleParams {
  network: string;
  modelVersion: string;
  ensemble: {
    score: number;
    components: {
      exchangePressure: number;
      zones: number;
      ml: number;
    };
  };
  result: {
    signal: string;
    confidence: number;
  };
  latencyMs: number;
  wasFallback: boolean;
  requestId?: string;
}

export async function logEnsembleInference(params: LogEnsembleParams): Promise<void> {
  try {
    await MLInferenceLogModel.create({
      ts: Math.floor(Date.now() / 1000),
      network: params.network,
      signalType: 'ensemble',
      modelVersion: params.modelVersion,
      wasFallback: params.wasFallback,
      ensemble: params.ensemble,
      result: {
        signal: params.result.signal,
        confidence: params.result.confidence,
      },
      latencyMs: params.latencyMs,
      requestId: params.requestId,
    });
  } catch (err) {
    console.error('[MLLog] Failed to log ensemble inference:', err);
  }
}

// ============================================
// QUERY FUNCTIONS
// ============================================

export interface InferenceStats {
  totalCount: number;
  fallbackCount: number;
  fallbackRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
}

export async function getInferenceStats(
  network: string,
  signalType: 'market' | 'actor' | 'ensemble',
  windowSec: number = 3600
): Promise<InferenceStats> {
  const minTs = Math.floor(Date.now() / 1000) - windowSec;
  
  const pipeline = [
    {
      $match: {
        network,
        signalType,
        ts: { $gte: minTs },
      },
    },
    {
      $group: {
        _id: null,
        totalCount: { $sum: 1 },
        fallbackCount: {
          $sum: { $cond: ['$wasFallback', 1, 0] },
        },
        avgLatencyMs: { $avg: '$latencyMs' },
        latencies: { $push: '$latencyMs' },
      },
    },
  ];
  
  const results = await MLInferenceLogModel.aggregate(pipeline);
  
  if (!results.length) {
    return {
      totalCount: 0,
      fallbackCount: 0,
      fallbackRate: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      errorRate: 0,
    };
  }
  
  const r = results[0];
  const sorted = (r.latencies || []).sort((a: number, b: number) => a - b);
  const p95Index = Math.floor(sorted.length * 0.95);
  
  return {
    totalCount: r.totalCount,
    fallbackCount: r.fallbackCount,
    fallbackRate: r.totalCount > 0 ? r.fallbackCount / r.totalCount : 0,
    avgLatencyMs: Math.round(r.avgLatencyMs || 0),
    p95LatencyMs: sorted[p95Index] || 0,
    errorRate: r.totalCount > 0 ? r.fallbackCount / r.totalCount : 0,
  };
}

export default MLInferenceLogModel;
