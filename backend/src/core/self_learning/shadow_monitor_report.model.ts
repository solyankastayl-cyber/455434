/**
 * Shadow Monitor Report Model (ETAP 5.7)
 * 
 * Stores rolling window metrics for active model monitoring.
 * Used to detect degradation and trigger auto-rollback.
 */
import mongoose, { Schema, Document } from 'mongoose';

// ==================== TYPES ====================

export type MonitorWindow = '7d' | '14d';
export type MonitorDecision = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export interface MonitorMetrics {
  precision: number;
  recall: number;
  fpRate: number;
  calibrationError: number;
  sampleCount: number;
  coverage: number;
}

export interface MonitorComparison {
  vsBaseline: {
    precisionDelta: number;
    fpRateDelta: number;
    calibrationDelta: number;
  };
  vsLastReport: {
    precisionDelta: number;
    fpRateDelta: number;
  } | null;
}

export interface IShadowMonitorReport extends Document {
  reportId: string;
  horizon: '7d' | '30d';
  window: MonitorWindow;
  modelId: string;
  
  // Computed metrics
  metrics: MonitorMetrics;
  
  // Comparison
  comparison: MonitorComparison;
  
  // Decision
  decision: MonitorDecision;
  reasons: string[];
  
  // Auto-rollback
  shouldAutoRollback: boolean;
  autoRollbackTriggered: boolean;
  
  // Timestamps
  windowStart: Date;
  windowEnd: Date;
  createdAt: Date;
}

// ==================== SCHEMA ====================

const ShadowMonitorReportSchema = new Schema<IShadowMonitorReport>(
  {
    reportId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    horizon: {
      type: String,
      enum: ['7d', '30d'],
      required: true,
      index: true,
    },
    window: {
      type: String,
      enum: ['7d', '14d'],
      required: true,
    },
    modelId: {
      type: String,
      required: true,
      index: true,
    },
    metrics: {
      precision: { type: Number, default: 0 },
      recall: { type: Number, default: 0 },
      fpRate: { type: Number, default: 0 },
      calibrationError: { type: Number, default: 0 },
      sampleCount: { type: Number, default: 0 },
      coverage: { type: Number, default: 0 },
    },
    comparison: {
      vsBaseline: {
        precisionDelta: { type: Number, default: 0 },
        fpRateDelta: { type: Number, default: 0 },
        calibrationDelta: { type: Number, default: 0 },
      },
      vsLastReport: {
        type: Schema.Types.Mixed,
        default: null,
      },
    },
    decision: {
      type: String,
      enum: ['HEALTHY', 'DEGRADED', 'CRITICAL'],
      required: true,
    },
    reasons: [{
      type: String,
    }],
    shouldAutoRollback: {
      type: Boolean,
      default: false,
    },
    autoRollbackTriggered: {
      type: Boolean,
      default: false,
    },
    windowStart: {
      type: Date,
      required: true,
    },
    windowEnd: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'shadowmonitorreports',
  }
);

// Compound index for efficient queries
ShadowMonitorReportSchema.index({ horizon: 1, modelId: 1, createdAt: -1 });

// ==================== MODEL ====================

export const ShadowMonitorReportModel = mongoose.model<IShadowMonitorReport>(
  'ShadowMonitorReport',
  ShadowMonitorReportSchema
);

// ==================== OPERATIONS ====================

/**
 * Get latest report for model
 */
export async function getLatestReport(
  horizon: '7d' | '30d',
  modelId: string
): Promise<IShadowMonitorReport | null> {
  return ShadowMonitorReportModel
    .findOne({ horizon, modelId })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * Get recent reports for model
 */
export async function getRecentReports(
  horizon: '7d' | '30d',
  modelId: string,
  limit: number = 10
): Promise<IShadowMonitorReport[]> {
  return ShadowMonitorReportModel
    .find({ horizon, modelId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Count consecutive CRITICAL reports
 */
export async function countConsecutiveCritical(
  horizon: '7d' | '30d',
  modelId: string
): Promise<number> {
  const reports = await ShadowMonitorReportModel
    .find({ horizon, modelId })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  
  let count = 0;
  for (const report of reports) {
    if (report.decision === 'CRITICAL') {
      count++;
    } else {
      break;
    }
  }
  
  return count;
}

/**
 * Get reports by decision
 */
export async function getReportsByDecision(
  decision: MonitorDecision,
  limit: number = 50
): Promise<IShadowMonitorReport[]> {
  return ShadowMonitorReportModel
    .find({ decision })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get monitor statistics
 */
export async function getMonitorStats(horizon?: '7d' | '30d') {
  const query = horizon ? { horizon } : {};
  
  const total = await ShadowMonitorReportModel.countDocuments(query);
  const healthy = await ShadowMonitorReportModel.countDocuments({ ...query, decision: 'HEALTHY' });
  const degraded = await ShadowMonitorReportModel.countDocuments({ ...query, decision: 'DEGRADED' });
  const critical = await ShadowMonitorReportModel.countDocuments({ ...query, decision: 'CRITICAL' });
  const autoRollbacks = await ShadowMonitorReportModel.countDocuments({ ...query, autoRollbackTriggered: true });
  
  return {
    total,
    byDecision: {
      HEALTHY: healthy,
      DEGRADED: degraded,
      CRITICAL: critical,
    },
    autoRollbacksTriggered: autoRollbacks,
    healthRate: total > 0 ? (healthy / total * 100).toFixed(1) + '%' : 'N/A',
  };
}
