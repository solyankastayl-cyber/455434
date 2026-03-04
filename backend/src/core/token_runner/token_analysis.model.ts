/**
 * Token Analysis Model (Stage C)
 * 
 * Stores Engine analysis results for each token
 * This is NOT a decision - it's engine-layer insight snapshot
 */
import mongoose from 'mongoose';

const TokenAnalysisSchema = new mongoose.Schema({
  // Token identity
  symbol: {
    type: String,
    required: true,
    index: true,
    uppercase: true,
  },
  
  contractAddress: {
    type: String,
    required: true,
    lowercase: true,
  },
  
  chainId: {
    type: Number,
    required: true,
    default: 1,
  },
  
  // Engine decision (NOT final recommendation)
  engineLabel: {
    type: String,
    enum: ['BUY', 'SELL', 'NEUTRAL'],
    required: true,
  },
  
  engineStrength: {
    type: String,
    enum: ['low', 'medium', 'high'],
    required: true,
  },
  
  // Computed scores (0-100)
  engineScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  
  confidence: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    index: true,
  },
  
  risk: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  
  // Coverage snapshot
  coverage: {
    percent: {
      type: Number,
      default: 0,
    },
    checked: [{
      type: String,
    }],
  },
  
  // Inputs used
  inputsUsed: {
    actorSignals: { type: Number, default: 0 },
    contexts: { type: Number, default: 0 },
    corridors: { type: Number, default: 0 },
  },
  
  // Signals summary (for explainability)
  signals: [{
    type: {
      type: String,
    },
    severity: String,
    source: String,
    deviation: Number,
  }],
  
  // Why factors (from Engine)
  whyFactors: [{
    title: String,
    evidence: String,
    source: String,
  }],
  
  // Risk factors (from Engine)
  riskFactors: [{
    title: String,
    evidence: String,
  }],
  
  // Analysis mode
  analysisMode: {
    type: String,
    enum: ['fast', 'deep'],
    default: 'fast',
  },
  
  // Timestamps
  analyzedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  
  // Processing info
  processingTime: {
    type: Number, // milliseconds
    default: 0,
  },
  
  // Status
  status: {
    type: String,
    enum: ['completed', 'failed', 'pending'],
    default: 'completed',
  },
  
  error: {
    type: String,
    default: null,
  },
}, {
  collection: 'token_analyses',
  timestamps: false,
});

// Indexes
TokenAnalysisSchema.index({ contractAddress: 1, chainId: 1 });
TokenAnalysisSchema.index({ symbol: 1, analyzedAt: -1 });
TokenAnalysisSchema.index({ engineScore: -1 });
TokenAnalysisSchema.index({ confidence: -1 });
TokenAnalysisSchema.index({ analyzedAt: -1 });

export const TokenAnalysisModel = mongoose.model('TokenAnalysis', TokenAnalysisSchema);
