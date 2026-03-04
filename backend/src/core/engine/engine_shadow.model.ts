/**
 * Engine Shadow Decision Model
 * 
 * Stores parallel v1.1 vs v2 decisions for comparison
 * v2 decisions do NOT affect production
 */
import mongoose from 'mongoose';

const EngineShadowDecisionSchema = new mongoose.Schema({
  // Identity
  shadowId: { type: String, required: true, unique: true, index: true },
  originalDecisionId: { type: String, required: true, index: true },
  
  // Asset info
  asset: {
    address: String,
    symbol: String,
  },
  window: String,
  
  // v1.1 Decision (PRODUCTION)
  v1Decision: {
    decision: { type: String, enum: ['BUY', 'SELL', 'NEUTRAL'], required: true },
    confidenceBand: String,
    evidence: Number,
    risk: Number,
    direction: Number,
    coverage: Number,
  },
  
  // v2 Decision (SHADOW)
  v2Decision: {
    decision: { type: String, enum: ['BUY', 'SELL', 'NEUTRAL'], required: true },
    confidenceBand: String,
    evidence: Number,           // after ML adjustment
    risk: Number,               // after ML adjustment
    direction: Number,
    coverage: Number,
  },
  
  // ML Adjustments Applied
  mlAdjustments: {
    confidenceDelta: Number,
    riskAdjustment: Number,
    conflictLikelihood: Number,
    modelVersion: String,
  },
  
  // Comparison Metrics
  comparison: {
    agreement: Boolean,         // v1 == v2
    v2MoreAggressive: Boolean,  // v2 has BUY/SELL where v1 has NEUTRAL
    v2LessAggressive: Boolean,  // v2 has NEUTRAL where v1 has BUY/SELL
    evidenceDiff: Number,       // v2.evidence - v1.evidence
    riskDiff: Number,           // v2.risk - v1.risk
  },
  
  // Features used
  features: {
    coverage: Number,
    distinctSources: Number,
    conflictsCount: Number,
    actorCount: Number,
    contextCount: Number,
  },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now, index: true },
  
}, {
  collection: 'engine_shadow_decisions',
  timestamps: true,
});

// Indexes
EngineShadowDecisionSchema.index({ 'comparison.agreement': 1, createdAt: -1 });
EngineShadowDecisionSchema.index({ 'v1Decision.decision': 1, 'v2Decision.decision': 1 });

export const EngineShadowDecisionModel = mongoose.model('EngineShadowDecision', EngineShadowDecisionSchema);
