/**
 * Admin Audit Log
 * 
 * Tracks all admin actions for accountability and debugging.
 * Required for production multi-admin environments.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// TYPES
// ============================================

export type AdminAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'ML_TOGGLE'
  | 'ML_POLICY_UPDATE'
  | 'ML_RELOAD'
  | 'ML_MODEL_TOGGLE'
  | 'PROVIDER_ADD'
  | 'PROVIDER_REMOVE'
  | 'PROVIDER_RESET'
  | 'PROVIDER_RESET_ALL'
  | 'CIRCUIT_BREAKER_RESET'
  | 'SNAPSHOT_RUN'
  | 'SCHEDULER_START'
  | 'SCHEDULER_STOP'
  | 'USER_CREATE'
  | 'PASSWORD_CHANGE';

export interface IAdminAuditLog extends Document {
  ts: number;
  adminId: string;
  adminUsername?: string;
  action: AdminAction;
  resource?: string;
  payload?: Record<string, any>;
  result: 'success' | 'failure';
  errorMessage?: string;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

// ============================================
// SCHEMA
// ============================================

const AdminAuditLogSchema = new Schema<IAdminAuditLog>(
  {
    ts: { type: Number, required: true, index: true },
    adminId: { type: String, required: true, index: true },
    adminUsername: { type: String },
    action: { 
      type: String, 
      required: true, 
      index: true,
      enum: [
        'LOGIN_SUCCESS', 'LOGIN_FAILED',
        'ML_TOGGLE', 'ML_POLICY_UPDATE', 'ML_RELOAD', 'ML_MODEL_TOGGLE',
        'PROVIDER_ADD', 'PROVIDER_REMOVE', 'PROVIDER_RESET', 'PROVIDER_RESET_ALL',
        'CIRCUIT_BREAKER_RESET',
        'SNAPSHOT_RUN', 'SCHEDULER_START', 'SCHEDULER_STOP',
        'USER_CREATE', 'PASSWORD_CHANGE',
      ],
    },
    resource: { type: String },
    payload: { type: Schema.Types.Mixed },
    result: { type: String, enum: ['success', 'failure'], default: 'success' },
    errorMessage: { type: String },
    ip: { type: String },
    userAgent: { type: String },
  },
  {
    timestamps: true,
    collection: 'admin_audit_log',
  }
);

// TTL: keep logs for 90 days
AdminAuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
AdminAuditLogSchema.index({ action: 1, ts: -1 });

export const AdminAuditLogModel = mongoose.models.AdminAuditLog ||
  mongoose.model<IAdminAuditLog>('AdminAuditLog', AdminAuditLogSchema);

// ============================================
// LOGGING FUNCTIONS
// ============================================

export interface LogParams {
  adminId: string;
  adminUsername?: string;
  action: AdminAction;
  resource?: string;
  payload?: Record<string, any>;
  result?: 'success' | 'failure';
  errorMessage?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Log an admin action
 */
export async function logAdminAction(params: LogParams): Promise<void> {
  try {
    await AdminAuditLogModel.create({
      ts: Math.floor(Date.now() / 1000),
      adminId: params.adminId,
      adminUsername: params.adminUsername,
      action: params.action,
      resource: params.resource,
      payload: params.payload,
      result: params.result || 'success',
      errorMessage: params.errorMessage,
      ip: params.ip,
      userAgent: params.userAgent,
    });
  } catch (err) {
    console.error('[AuditLog] Failed to log action:', err);
  }
}

/**
 * Get recent audit logs
 */
export async function getRecentAuditLogs(
  limit: number = 100,
  filters?: {
    adminId?: string;
    action?: AdminAction;
    fromTs?: number;
  }
): Promise<IAdminAuditLog[]> {
  const query: any = {};
  
  if (filters?.adminId) {
    query.adminId = filters.adminId;
  }
  if (filters?.action) {
    query.action = filters.action;
  }
  if (filters?.fromTs) {
    query.ts = { $gte: filters.fromTs };
  }
  
  return AdminAuditLogModel.find(query)
    .sort({ ts: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get audit stats
 */
export async function getAuditStats(windowSec: number = 86400): Promise<{
  totalActions: number;
  byAction: Record<string, number>;
  byAdmin: Record<string, number>;
  failures: number;
}> {
  const minTs = Math.floor(Date.now() / 1000) - windowSec;
  
  const [total, byAction, byAdmin, failures] = await Promise.all([
    AdminAuditLogModel.countDocuments({ ts: { $gte: minTs } }),
    AdminAuditLogModel.aggregate([
      { $match: { ts: { $gte: minTs } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
    ]),
    AdminAuditLogModel.aggregate([
      { $match: { ts: { $gte: minTs } } },
      { $group: { _id: '$adminUsername', count: { $sum: 1 } } },
    ]),
    AdminAuditLogModel.countDocuments({ ts: { $gte: minTs }, result: 'failure' }),
  ]);
  
  return {
    totalActions: total,
    byAction: Object.fromEntries(byAction.map((a: any) => [a._id, a.count])),
    byAdmin: Object.fromEntries(byAdmin.filter((a: any) => a._id).map((a: any) => [a._id, a.count])),
    failures,
  };
}

export default {
  AdminAuditLogModel,
  logAdminAction,
  getRecentAuditLogs,
  getAuditStats,
};
