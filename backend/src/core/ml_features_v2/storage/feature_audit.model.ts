/**
 * Feature Audit Model (P0.6)
 * 
 * Audit log for feature builds.
 */

import mongoose, { Schema, Document } from 'mongoose';
import { FeatureSource, FEATURE_TAXONOMY_VERSION } from '../types/feature.types.js';

// ============================================
// Types
// ============================================

export interface IFeatureAudit {
  auditId: string;
  snapshotId?: string;
  
  entityType: 'WALLET' | 'TOKEN' | 'ACTOR';
  entityId: string;
  
  action: 'BUILD' | 'REBUILD' | 'EXPORT' | 'ATTACH';
  
  taxonomyVersion: string;
  
  // Build details
  buildDurationMs: number;
  providersUsed: FeatureSource[];
  providerErrors: Array<{
    source: FeatureSource;
    error: string;
  }>;
  
  // Coverage
  coveragePercent: number;
  missingCritical: string[];
  
  // Context
  triggeredBy: 'API' | 'CRON' | 'SHADOW' | 'MANUAL';
  userId?: string;
  
  createdAt: Date;
}

export interface IFeatureAuditDocument extends IFeatureAudit, Document {}

// ============================================
// Schema
// ============================================

const FeatureAuditSchema = new Schema<IFeatureAuditDocument>({
  auditId: { type: String, required: true, unique: true, index: true },
  snapshotId: { type: String, index: true },
  
  entityType: { 
    type: String, 
    required: true, 
    enum: ['WALLET', 'TOKEN', 'ACTOR'] 
  },
  entityId: { type: String, required: true, lowercase: true },
  
  action: { 
    type: String, 
    required: true, 
    enum: ['BUILD', 'REBUILD', 'EXPORT', 'ATTACH'],
    index: true 
  },
  
  taxonomyVersion: { type: String, required: true, default: FEATURE_TAXONOMY_VERSION },
  
  buildDurationMs: { type: Number, required: true },
  providersUsed: [{ type: String }],
  providerErrors: [{
    source: { type: String },
    error: { type: String }
  }],
  
  coveragePercent: { type: Number, required: true },
  missingCritical: [{ type: String }],
  
  triggeredBy: { 
    type: String, 
    required: true, 
    enum: ['API', 'CRON', 'SHADOW', 'MANUAL'] 
  },
  userId: { type: String },
  
  createdAt: { type: Date, default: Date.now, index: true }
});

// ============================================
// Indexes
// ============================================

FeatureAuditSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
FeatureAuditSchema.index({ action: 1, createdAt: -1 });
FeatureAuditSchema.index({ triggeredBy: 1, createdAt: -1 });

// ============================================
// Model
// ============================================

export const FeatureAuditModel = mongoose.model<IFeatureAuditDocument>(
  'ml_feature_audit',
  FeatureAuditSchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Generate audit ID
 */
export function generateAuditId(): string {
  return `AUDIT:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create audit entry
 */
export async function createAuditEntry(
  audit: Omit<IFeatureAudit, 'auditId' | 'createdAt'>
): Promise<IFeatureAuditDocument> {
  const entry: IFeatureAudit = {
    ...audit,
    auditId: generateAuditId(),
    createdAt: new Date()
  };
  
  return FeatureAuditModel.create(entry);
}

/**
 * Get recent audits
 */
export async function getRecentAudits(
  limit: number = 50
): Promise<IFeatureAuditDocument[]> {
  return FeatureAuditModel.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get audits for entity
 */
export async function getAuditsForEntity(
  entityType: string,
  entityId: string,
  limit: number = 20
): Promise<IFeatureAuditDocument[]> {
  return FeatureAuditModel.find({
    entityType,
    entityId: entityId.toLowerCase()
  })
  .sort({ createdAt: -1 })
  .limit(limit)
  .lean();
}

/**
 * Get audit statistics
 */
export async function getAuditStats(): Promise<{
  totalAudits: number;
  byAction: Record<string, number>;
  byTrigger: Record<string, number>;
  avgBuildDurationMs: number;
  avgCoverage: number;
  errorsToday: number;
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const [total, byAction, byTrigger, avgMetrics, errorsToday] = await Promise.all([
    FeatureAuditModel.countDocuments(),
    
    FeatureAuditModel.aggregate([
      { $group: { _id: '$action', count: { $sum: 1 } } }
    ]),
    
    FeatureAuditModel.aggregate([
      { $group: { _id: '$triggeredBy', count: { $sum: 1 } } }
    ]),
    
    FeatureAuditModel.aggregate([
      {
        $group: {
          _id: null,
          avgDuration: { $avg: '$buildDurationMs' },
          avgCoverage: { $avg: '$coveragePercent' }
        }
      }
    ]),
    
    FeatureAuditModel.countDocuments({
      createdAt: { $gte: today },
      'providerErrors.0': { $exists: true }
    })
  ]);
  
  const metrics = avgMetrics[0] || { avgDuration: 0, avgCoverage: 0 };
  
  return {
    totalAudits: total,
    byAction: byAction.reduce((acc, a) => {
      acc[a._id] = a.count;
      return acc;
    }, {} as Record<string, number>),
    byTrigger: byTrigger.reduce((acc, t) => {
      acc[t._id] = t.count;
      return acc;
    }, {} as Record<string, number>),
    avgBuildDurationMs: Math.round(metrics.avgDuration || 0),
    avgCoverage: Math.round((metrics.avgCoverage || 0) * 100) / 100,
    errorsToday
  };
}
