/**
 * Engine Decision Model (P3 - Sprint 4)
 * 
 * Logs all decisions for:
 * - Auditing
 * - ML training
 * - Improvement tracking
 */
import mongoose from 'mongoose';

const EngineDecisionSchema = new mongoose.Schema({
  // IDs
  decisionId: { type: String, required: true, unique: true, index: true },
  inputId: { type: String, required: true, index: true },
  inputHash: { type: String, required: true, index: true },
  
  // Asset
  asset: {
    address: String,
    symbol: String,
    name: String,
    verified: Boolean,
    chain: String,
  },
  
  // Window
  window: { 
    type: String, 
    enum: ['1h', '6h', '24h', '7d'],
    required: true 
  },
  
  // Decision output
  decision: { 
    type: String, 
    enum: ['BUY', 'SELL', 'NEUTRAL'],
    required: true,
    index: true 
  },
  
  confidenceBand: { 
    type: String, 
    enum: ['LOW', 'MEDIUM', 'HIGH'],
    required: true 
  },
  
  // Scores
  scores: {
    evidence: Number,
    direction: Number,
    risk: Number,
  },
  
  // Reasoning
  reasoning: {
    primaryContext: {
      id: String,
      headline: String,
      whyItMatters: String,
    },
    supportingFacts: [String],
    riskNotes: [String],
  },
  
  // Explainability
  explainability: {
    signalsUsed: [String],
    actorsUsed: [String],
    contextsUsed: [String],
    coverageSnapshot: {
      contexts: Number,
      actors: Number,
      signals: Number,
      overall: Number,
    },
    // v1.1 additions
    distinctSources: Number,
    conflictsDetected: [String],
    penaltiesApplied: [String],
  },
  
  // References (for joining)
  contextIds: [String],
  signalIds: [String],
  actorSlugs: [String],
  
  // Coverage at decision time
  coverage: {
    contexts: Number,
    actors: Number,
    signals: Number,
    overall: Number,
  },
  
  // Feedback (P4)
  feedback: {
    helpful: { type: Boolean, default: null },
    feedbackAt: Date,
    comment: String,
  },
  
  // Outcome (for ML training - filled later)
  outcome: {
    priceChange24h: Number,
    priceChange7d: Number,
    wasCorrect: Boolean,
    labeledBy: { type: String, enum: ['auto', 'manual'] },
    labeledAt: Date,
  },
  
  // Metadata
  engineVersion: { type: String, default: 'v1.1' },
  createdAt: { type: Date, default: Date.now, index: true },
  
  // v1.1 additions
  neutralReason: { type: String },
  conflictsDetected: [String],
  penaltiesApplied: [String],
  
}, {
  collection: 'engine_decisions',
  timestamps: true,
});

// Indexes for analytics
EngineDecisionSchema.index({ decision: 1, createdAt: -1 });
EngineDecisionSchema.index({ 'asset.symbol': 1, createdAt: -1 });
EngineDecisionSchema.index({ confidenceBand: 1, decision: 1 });
EngineDecisionSchema.index({ 'feedback.helpful': 1 });

export const EngineDecisionModel = mongoose.model('EngineDecision', EngineDecisionSchema);
