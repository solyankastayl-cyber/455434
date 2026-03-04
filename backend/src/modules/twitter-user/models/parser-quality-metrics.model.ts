/**
 * Phase 5.3 — Parser Quality Metrics Model
 * 
 * Stores quality metrics per target + account combination
 * to understand parsing effectiveness.
 */

import mongoose, { Schema, Document } from 'mongoose';

// Quality status enum
export enum QualityStatus {
  HEALTHY = 'HEALTHY',       // Normal operation
  DEGRADED = 'DEGRADED',     // Warning signs
  UNSTABLE = 'UNSTABLE',     // Significant issues
}

export interface IParserQualityMetrics extends Document {
  targetId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  ownerUserId: mongoose.Types.ObjectId;
  
  // Run statistics
  runsTotal: number;
  runsWithResults: number;
  runsEmpty: number;
  
  // Fetch statistics
  totalFetched: number;
  avgFetched: number;
  maxFetched: number;
  minFetched: number;
  
  // Streak tracking
  emptyStreak: number;        // Current consecutive empty results
  maxEmptyStreak: number;     // Historical max
  lastNonEmptyAt: Date | null;
  
  // Quality assessment
  qualityStatus: QualityStatus;
  qualityScore: number;       // 0-100, higher is better
  lastAssessedAt: Date;
  
  // Degradation tracking
  degradedSince: Date | null;
  degradationReason: string | null;
  
  // Timestamps
  lastRunAt: Date;
  firstRunAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ParserQualityMetricsSchema = new Schema<IParserQualityMetrics>(
  {
    targetId: { type: Schema.Types.ObjectId, required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, required: true, index: true },
    ownerUserId: { type: Schema.Types.ObjectId, required: true, index: true },
    
    // Run statistics
    runsTotal: { type: Number, default: 0 },
    runsWithResults: { type: Number, default: 0 },
    runsEmpty: { type: Number, default: 0 },
    
    // Fetch statistics
    totalFetched: { type: Number, default: 0 },
    avgFetched: { type: Number, default: 0 },
    maxFetched: { type: Number, default: 0 },
    minFetched: { type: Number, default: Infinity },
    
    // Streak tracking
    emptyStreak: { type: Number, default: 0 },
    maxEmptyStreak: { type: Number, default: 0 },
    lastNonEmptyAt: { type: Date, default: null },
    
    // Quality assessment
    qualityStatus: { 
      type: String, 
      enum: Object.values(QualityStatus),
      default: QualityStatus.HEALTHY,
    },
    qualityScore: { type: Number, default: 100 },
    lastAssessedAt: { type: Date, default: Date.now },
    
    // Degradation tracking
    degradedSince: { type: Date, default: null },
    degradationReason: { type: String, default: null },
    
    // Timestamps
    lastRunAt: { type: Date, default: Date.now },
    firstRunAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'parser_quality_metrics',
  }
);

// Compound index for efficient lookups
ParserQualityMetricsSchema.index({ targetId: 1, accountId: 1 }, { unique: true });
ParserQualityMetricsSchema.index({ ownerUserId: 1, qualityStatus: 1 });
ParserQualityMetricsSchema.index({ qualityStatus: 1, lastRunAt: -1 });

export const ParserQualityMetricsModel = mongoose.model<IParserQualityMetrics>(
  'ParserQualityMetrics',
  ParserQualityMetricsSchema
);
