/**
 * Legacy Access Logger (Phase 12C.2)
 * 
 * Logs all accesses to legacy Python backend for migration tracking.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ILegacyAccessLog extends Document {
  _id: Types.ObjectId;
  
  // Request info
  endpoint: string;
  method: string;
  ip?: string;
  userAgent?: string;
  
  // Timing
  timestamp: Date;
  
  // Response
  statusCode?: number;
  responseTime?: number;
  
  // Flags
  wasBlocked: boolean;
  blockReason?: string;
}

const LegacyAccessLogSchema = new Schema<ILegacyAccessLog>(
  {
    endpoint: {
      type: String,
      required: true,
      index: true,
    },
    method: {
      type: String,
      required: true,
    },
    ip: String,
    userAgent: String,
    
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    
    statusCode: Number,
    responseTime: Number,
    
    wasBlocked: {
      type: Boolean,
      default: false,
    },
    blockReason: String,
  },
  {
    timestamps: false,
    collection: 'legacy_access_logs',
  }
);

// TTL index - auto-delete logs after 30 days
LegacyAccessLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const LegacyAccessLogModel = mongoose.model<ILegacyAccessLog>(
  'LegacyAccessLog',
  LegacyAccessLogSchema
);

/**
 * Log legacy access
 */
export async function logLegacyAccess(data: Omit<ILegacyAccessLog, '_id'>): Promise<void> {
  try {
    await LegacyAccessLogModel.create(data);
  } catch (err) {
    console.error('[Legacy Access] Failed to log:', err);
  }
}

/**
 * Get legacy access stats
 */
export async function getLegacyAccessStats(): Promise<{
  totalAccesses: number;
  blockedAccesses: number;
  topEndpoints: { endpoint: string; count: number }[];
  last24h: number;
}> {
  const [total, blocked, topEndpoints, recent] = await Promise.all([
    LegacyAccessLogModel.countDocuments(),
    LegacyAccessLogModel.countDocuments({ wasBlocked: true }),
    LegacyAccessLogModel.aggregate([
      { $group: { _id: '$endpoint', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    LegacyAccessLogModel.countDocuments({
      timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
  ]);
  
  return {
    totalAccesses: total,
    blockedAccesses: blocked,
    topEndpoints: topEndpoints.map(e => ({ endpoint: e._id, count: e.count })),
    last24h: recent,
  };
}
