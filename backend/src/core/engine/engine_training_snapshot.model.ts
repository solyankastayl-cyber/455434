/**
 * Engine Training Snapshot Model
 * 
 * Stores decision snapshots for ML training
 * Each snapshot contains features, labels, and metadata
 */
import mongoose from 'mongoose';

const EngineTrainingSnapshotSchema = new mongoose.Schema({
  // Identity
  snapshotId: { type: String, required: true, unique: true, index: true },
  decisionId: { type: String, required: true, index: true },
  
  // Timestamp
  timestamp: { type: Date, required: true, index: true },
  
  // Features (25 features)
  features: {
    // Coverage group
    coverage: Number,
    distinctSources: Number,
    
    // Evidence group
    evidenceRaw: Number,
    penaltiesCount: Number,
    
    // Risk group
    riskRaw: Number,
    
    // Direction group
    direction: Number,
    
    // Conflicts group
    conflictsCount: Number,
    
    // Actors group
    actorParticipationScore: Number,
    actorCount: Number,
    actorTypeExchange: Number,
    actorTypeFund: Number,
    actorTypeMarketMaker: Number,
    actorTypeWhale: Number,
    actorTypeOther: Number,
    
    // Context group
    contextOverlapScore: Number,
    contextCount: Number,
    
    // Signals group
    signalDiversity: Number,
    signalSeverityAvg: Number,
    highSeverityRatio: Number,
    
    // Graph group
    corridorConcentration: Number,
    totalCorridorVolume: Number,
    graphDensity: Number,
    
    // Temporal group
    volatilityRegime: Number,  // 0=low, 0.5=normal, 1=high
    hourOfDay: Number,
    dayOfWeek: Number,
  },
  
  // Engine Decision
  engineDecision: {
    type: String,
    enum: ['BUY', 'SELL', 'NEUTRAL'],
    required: true,
    index: true,
  },
  
  // Raw scores
  rawScores: {
    evidence: Number,
    risk: Number,
    direction: Number,
  },
  
  // Penalties and conflicts
  penaltiesApplied: [String],
  conflictsDetected: [String],
  
  // References
  contextIds: [String],
  actorIds: [String],
  asset: {
    address: String,
    symbol: String,
  },
  
  // Labels (filled later)
  labels: {
    userFeedback: {
      type: String,
      enum: ['helpful', 'not_helpful', 'skip', null],
      default: null,
    },
    outcomeLabel: {
      type: String,
      enum: ['stable', 'flip_early', 'flip_late', 'validated', 'rejected', null],
      default: null,
    },
    labeledAt: Date,
  },
  
  // Training metadata
  training: {
    includedInTraining: { type: Boolean, default: false },
    trainedModelVersion: String,
    trainedAt: Date,
  },
  
}, {
  collection: 'engine_training_snapshots',
  timestamps: true,
});

// Indexes for training data queries
EngineTrainingSnapshotSchema.index({ 'labels.userFeedback': 1, timestamp: -1 });
EngineTrainingSnapshotSchema.index({ 'labels.outcomeLabel': 1, timestamp: -1 });
EngineTrainingSnapshotSchema.index({ 'training.includedInTraining': 1 });
EngineTrainingSnapshotSchema.index({ engineDecision: 1, timestamp: -1 });

export const EngineTrainingSnapshotModel = mongoose.model('EngineTrainingSnapshot', EngineTrainingSnapshotSchema);
