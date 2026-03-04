/**
 * S8 — Meta-Brain Model
 * ======================
 * 
 * Final orchestration layer that combines all intelligence layers
 * into a single actionable verdict.
 * 
 * GOLDEN RULES:
 * - Meta-Brain is orchestration ONLY
 * - Meta-Brain NEVER changes upstream outputs
 * - Meta-Brain can ONLY gate/downgrade/explain
 * 
 * INPUTS (READ-ONLY):
 * - Sentiment (S1): intent + confidence
 * - Observation (S6): quality decision + score
 * - Onchain (S7): validation verdict + impact
 * 
 * OUTPUT:
 * - MetaDecision: STRONG / WEAK / NO_ACTION + explanation
 */

import mongoose, { Schema, Document, Types } from 'mongoose';

// ============================================================
// Types
// ============================================================

export type MetaVerdict = 'STRONG' | 'WEAK' | 'NO_ACTION';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type SentimentLabel = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'BULLISH' | 'BEARISH';
export type ObservationDecision = 'USE' | 'IGNORE' | 'MISS_ALERT';
export type OnchainVerdict = 'CONFIRMS' | 'CONTRADICTS' | 'NO_DATA';
export type OnchainImpact = 'NONE' | 'DOWNGRADE' | 'STRONG_ALERT';
export type Volatility = 'LOW' | 'MEDIUM' | 'HIGH';

// ============================================================
// Input Types (READ-ONLY from lower layers)
// ============================================================

export interface SentimentInput {
  label: SentimentLabel;
  confidence: number;
  source?: string;
}

export interface ObservationInput {
  observation_id: string;
  decision: ObservationDecision;
  score: number;
  reasons: string[];
}

export interface OnchainInput {
  verdict: OnchainVerdict;
  impact: OnchainImpact;
  confidence_delta: number;
  flags: string[];
}

export interface PriceContext {
  horizon: '1h' | '4h' | '24h';
  volatility: Volatility;
  asset: string;
}

export interface MetaBrainInput {
  signal_id: string;
  sentiment: SentimentInput;
  observation: ObservationInput;
  onchain: OnchainInput;
  price_context: PriceContext;
}

// ============================================================
// Output Types
// ============================================================

export interface SourceContribution {
  sentiment: boolean;
  observation: boolean;
  onchain: boolean;
}

export interface IMetaDecision extends Document {
  _id: Types.ObjectId;
  
  // Reference
  signal_id: string;
  observation_id: string;
  
  // Final Verdict
  verdict: MetaVerdict;
  confidence: number;
  risk_level: RiskLevel;
  
  // Explanation (human-readable)
  explanation: string[];
  primary_reason: string;
  
  // Source Contributions
  sources: SourceContribution;
  
  // Input Snapshot (for audit)
  input_snapshot: {
    sentiment_label: SentimentLabel;
    sentiment_confidence: number;
    observation_decision: ObservationDecision;
    observation_score: number;
    onchain_verdict: OnchainVerdict;
    onchain_impact: OnchainImpact;
    volatility: Volatility;
    horizon: string;
    asset: string;
  };
  
  // Metadata
  version: string;
  created_at: Date;
}

// ============================================================
// Schema
// ============================================================

const MetaDecisionSchema = new Schema<IMetaDecision>({
  signal_id: { type: String, required: true, index: true },
  observation_id: { type: String, required: true, unique: true },
  
  verdict: { 
    type: String, 
    enum: ['STRONG', 'WEAK', 'NO_ACTION'], 
    required: true,
    index: true,
  },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  risk_level: { 
    type: String, 
    enum: ['LOW', 'MEDIUM', 'HIGH'], 
    required: true,
  },
  
  explanation: [{ type: String }],
  primary_reason: { type: String },
  
  sources: {
    sentiment: { type: Boolean, default: false },
    observation: { type: Boolean, default: false },
    onchain: { type: Boolean, default: false },
  },
  
  input_snapshot: {
    sentiment_label: { type: String },
    sentiment_confidence: { type: Number },
    observation_decision: { type: String },
    observation_score: { type: Number },
    onchain_verdict: { type: String },
    onchain_impact: { type: String },
    volatility: { type: String },
    horizon: { type: String },
    asset: { type: String },
  },
  
  version: { type: String, default: 'v1' },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false },
  collection: 'meta_decisions',
});

// Indexes
MetaDecisionSchema.index({ verdict: 1, created_at: -1 });
MetaDecisionSchema.index({ risk_level: 1 });
MetaDecisionSchema.index({ 'input_snapshot.asset': 1 });

export const MetaDecisionModel = mongoose.models.MetaDecision ||
  mongoose.model<IMetaDecision>('MetaDecision', MetaDecisionSchema);
