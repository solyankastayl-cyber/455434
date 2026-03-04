/**
 * C3 — Meta-Brain v2 MongoDB Model
 */

import mongoose, { Schema, Document, Types } from 'mongoose';
import { 
  MetaBrainV2Decision, 
  FinalVerdict, 
  AlignmentType,
} from '../contracts/metaBrainV2.types.js';

export interface IMetaBrainDecisionDoc extends Document {
  _id: Types.ObjectId;
  symbol: string;
  t0: number;
  finalVerdict: FinalVerdict;
  finalConfidence: number;
  reasonTree: any[];
  debug: {
    alignment: AlignmentType;
    baseConfidence: number;
    validationMultiplier: number;
    confAfterValidation: number;
    matrixRuleId: string;
    matrixOutput: FinalVerdict;
    guardsApplied: any[];
  };
  createdAt: number;
}

const MetaBrainDecisionSchema = new Schema<IMetaBrainDecisionDoc>({
  symbol: { type: String, required: true, index: true },
  t0: { type: Number, required: true, index: true },
  
  finalVerdict: { 
    type: String, 
    enum: ['STRONG_BULLISH', 'WEAK_BULLISH', 'NEUTRAL', 'WEAK_BEARISH', 'STRONG_BEARISH', 'INCONCLUSIVE'],
    required: true,
    index: true,
  },
  finalConfidence: { type: Number, required: true },
  
  reasonTree: [{ type: Schema.Types.Mixed }],
  
  debug: {
    alignment: { type: String, enum: ['ALIGNED', 'PARTIAL', 'CONFLICT'] },
    baseConfidence: Number,
    validationMultiplier: Number,
    confAfterValidation: Number,
    matrixRuleId: String,
    matrixOutput: String,
    guardsApplied: [{ type: Schema.Types.Mixed }],
  },
  
  createdAt: { type: Number, required: true },
}, {
  collection: 'c3_metabrain_decisions',
});

// Indexes
MetaBrainDecisionSchema.index({ symbol: 1, t0: -1 });
MetaBrainDecisionSchema.index({ symbol: 1, t0: 1 }, { unique: true });
MetaBrainDecisionSchema.index({ finalVerdict: 1, createdAt: -1 });
MetaBrainDecisionSchema.index({ 'debug.alignment': 1, createdAt: -1 });
MetaBrainDecisionSchema.index({ createdAt: -1 });

export const MetaBrainDecisionModel = mongoose.models.C3MetaBrainDecision ||
  mongoose.model<IMetaBrainDecisionDoc>('C3MetaBrainDecision', MetaBrainDecisionSchema);

/**
 * Save decision to MongoDB
 */
export async function saveDecision(decision: MetaBrainV2Decision): Promise<void> {
  try {
    await MetaBrainDecisionModel.findOneAndUpdate(
      { symbol: decision.symbol, t0: decision.t0 },
      decision,
      { upsert: true }
    );
  } catch (error) {
    if ((error as any).code !== 11000) {
      console.error('[MetaBrain] Failed to save decision:', error);
    }
  }
}

/**
 * Get latest decision for symbol
 */
export async function getLatestDecision(symbol: string): Promise<MetaBrainV2Decision | null> {
  const doc = await MetaBrainDecisionModel.findOne(
    { symbol: symbol.toUpperCase() },
    {},
    { sort: { t0: -1 } }
  ).lean();
  
  return doc ? docToDecision(doc) : null;
}

/**
 * Get decision history
 */
export async function getDecisionHistory(
  symbol: string,
  limit: number = 50
): Promise<MetaBrainV2Decision[]> {
  const docs = await MetaBrainDecisionModel.find(
    { symbol: symbol.toUpperCase() },
    {},
    { sort: { t0: -1 }, limit }
  ).lean();
  
  return docs.map(docToDecision);
}

/**
 * Get statistics
 */
export async function getDecisionStats(since?: number) {
  const query = since ? { createdAt: { $gte: since } } : {};
  
  const docs = await MetaBrainDecisionModel.find(query).lean();
  
  const total = docs.length;
  const verdictCounts: Record<string, number> = {};
  const alignmentCounts: Record<string, number> = {};
  let guardTriggeredCount = 0;
  
  for (const doc of docs) {
    verdictCounts[doc.finalVerdict] = (verdictCounts[doc.finalVerdict] || 0) + 1;
    alignmentCounts[doc.debug.alignment] = (alignmentCounts[doc.debug.alignment] || 0) + 1;
    
    if (doc.debug.guardsApplied?.some((g: any) => g.triggered)) {
      guardTriggeredCount++;
    }
  }
  
  return {
    total,
    verdictDistribution: verdictCounts,
    alignmentDistribution: alignmentCounts,
    guardTriggerRate: total > 0 ? guardTriggeredCount / total : 0,
  };
}

function docToDecision(doc: any): MetaBrainV2Decision {
  return {
    symbol: doc.symbol,
    t0: doc.t0,
    finalVerdict: doc.finalVerdict,
    finalConfidence: doc.finalConfidence,
    reasonTree: doc.reasonTree,
    debug: doc.debug,
    createdAt: doc.createdAt,
  };
}

console.log('[C3] MetaBrain Decision Model loaded');
