/**
 * BLOCK 56.3 — Research Model Registry Schema
 * 
 * Registry for SHADOW models in the Research Sandbox.
 * Each model has:
 * - Unique paramSet
 * - Parent active version
 * - Performance tracking
 * - Status lifecycle
 */

import mongoose, { Schema, Document } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export type ResearchModelStatus = 'SHADOW' | 'CANDIDATE' | 'PROMOTED' | 'ARCHIVED' | 'REJECTED';

export interface ResearchModelParamSet {
  // Similarity params
  repWeights?: { ret: number; vol: number; dd: number };
  minSimilarity?: number;
  
  // Entropy/Confidence
  entropyScaling?: number;
  dominanceCap?: number;
  
  // Decay
  ageDecayLambda?: number;
  
  // Risk
  tailPenaltyWeight?: number;
  
  // Budget
  budgetCurve?: 'linear' | 'sqrt' | 'log';
  exposureGamma?: number;
  
  // Strategy preset
  presetOverrides?: {
    minConfidence?: number;
    maxEntropy?: number;
    maxTailP95DD?: number;
  };
}

export interface ResearchModelPerformance {
  // Rolling metrics
  sharpe30d?: number;
  sharpe60d?: number;
  sharpe90d?: number;
  
  // Risk
  maxDD30d?: number;
  maxDD60d?: number;
  mcP95_30d?: number;
  
  // Quality
  hitRate30d?: number;
  calibrationError?: number;
  reliability?: number;
  
  // Comparison to Active
  deltaSharpVsActive?: number;
  deltaMaxDDVsActive?: number;
  
  // Updated
  lastUpdated?: Date;
}

export interface ResearchModelDocument extends Document {
  modelId: string;
  symbol: string;
  
  // Lineage
  parentActiveVersion: string;
  paramHash: string;
  
  // Configuration
  paramSet: ResearchModelParamSet;
  objectiveProfile: 'sharpe_max' | 'dd_min' | 'balanced';
  
  // Status
  status: ResearchModelStatus;
  
  // Performance
  performance: ResearchModelPerformance;
  
  // Promotion tracking
  promotionCriteria?: {
    consecutiveOutperformWindows: number;
    tailRiskCheck: boolean;
    calibrationCheck: boolean;
    reliabilityCheck: boolean;
  };
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  promotedAt?: Date;
  archivedAt?: Date;
  
  // Notes
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════

const ResearchModelSchema = new Schema<ResearchModelDocument>({
  modelId: { type: String, required: true, unique: true },
  symbol: { type: String, required: true, default: 'BTC' },
  
  // Lineage
  parentActiveVersion: { type: String, required: true },
  paramHash: { type: String, required: true },
  
  // Configuration
  paramSet: {
    repWeights: {
      ret: { type: Number },
      vol: { type: Number },
      dd: { type: Number }
    },
    minSimilarity: { type: Number },
    entropyScaling: { type: Number },
    dominanceCap: { type: Number },
    ageDecayLambda: { type: Number },
    tailPenaltyWeight: { type: Number },
    budgetCurve: { type: String, enum: ['linear', 'sqrt', 'log'] },
    exposureGamma: { type: Number },
    presetOverrides: {
      minConfidence: { type: Number },
      maxEntropy: { type: Number },
      maxTailP95DD: { type: Number }
    }
  },
  objectiveProfile: { 
    type: String, 
    required: true, 
    enum: ['sharpe_max', 'dd_min', 'balanced'],
    default: 'balanced'
  },
  
  // Status
  status: { 
    type: String, 
    required: true, 
    enum: ['SHADOW', 'CANDIDATE', 'PROMOTED', 'ARCHIVED', 'REJECTED'],
    default: 'SHADOW'
  },
  
  // Performance
  performance: {
    sharpe30d: { type: Number },
    sharpe60d: { type: Number },
    sharpe90d: { type: Number },
    maxDD30d: { type: Number },
    maxDD60d: { type: Number },
    mcP95_30d: { type: Number },
    hitRate30d: { type: Number },
    calibrationError: { type: Number },
    reliability: { type: Number },
    deltaSharpVsActive: { type: Number },
    deltaMaxDDVsActive: { type: Number },
    lastUpdated: { type: Date }
  },
  
  // Promotion tracking
  promotionCriteria: {
    consecutiveOutperformWindows: { type: Number, default: 0 },
    tailRiskCheck: { type: Boolean, default: false },
    calibrationCheck: { type: Boolean, default: false },
    reliabilityCheck: { type: Boolean, default: false }
  },
  
  // Timestamps
  promotedAt: { type: Date },
  archivedAt: { type: Date },
  
  // Notes
  notes: { type: String }
}, {
  collection: 'fractal_research_models',
  timestamps: true
});

// Indexes
ResearchModelSchema.index({ status: 1, createdAt: -1 });
ResearchModelSchema.index({ parentActiveVersion: 1 });
ResearchModelSchema.index({ paramHash: 1 });

export const ResearchModelModel = mongoose.model<ResearchModelDocument>(
  'FractalResearchModel',
  ResearchModelSchema
);

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Create a new research model
 */
export async function createResearchModel(
  model: Omit<ResearchModelDocument, '_id' | 'createdAt' | 'updatedAt'>
): Promise<ResearchModelDocument> {
  const doc = new ResearchModelModel(model);
  return doc.save();
}

/**
 * Get all shadow models
 */
export async function getShadowModels(
  symbol: string = 'BTC'
): Promise<ResearchModelDocument[]> {
  return ResearchModelModel.find({ 
    symbol, 
    status: 'SHADOW' 
  }).sort({ createdAt: -1 }).lean();
}

/**
 * Get candidate models
 */
export async function getCandidateModels(
  symbol: string = 'BTC'
): Promise<ResearchModelDocument[]> {
  return ResearchModelModel.find({ 
    symbol, 
    status: 'CANDIDATE' 
  }).sort({ 'performance.sharpe60d': -1 }).lean();
}

/**
 * Update model performance
 */
export async function updateModelPerformance(
  modelId: string,
  performance: ResearchModelPerformance
): Promise<void> {
  await ResearchModelModel.updateOne(
    { modelId },
    { 
      $set: { 
        performance: { ...performance, lastUpdated: new Date() }
      }
    }
  );
}

/**
 * Promote model to candidate
 */
export async function promoteToCandidate(
  modelId: string,
  promotionCriteria: ResearchModelDocument['promotionCriteria']
): Promise<void> {
  await ResearchModelModel.updateOne(
    { modelId },
    { 
      $set: { 
        status: 'CANDIDATE',
        promotionCriteria
      }
    }
  );
}

/**
 * Archive model
 */
export async function archiveModel(
  modelId: string,
  reason?: string
): Promise<void> {
  await ResearchModelModel.updateOne(
    { modelId },
    { 
      $set: { 
        status: 'ARCHIVED',
        archivedAt: new Date(),
        notes: reason
      }
    }
  );
}

/**
 * Generate param hash from param set
 */
export function generateParamHash(paramSet: ResearchModelParamSet): string {
  const str = JSON.stringify(paramSet, Object.keys(paramSet).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
