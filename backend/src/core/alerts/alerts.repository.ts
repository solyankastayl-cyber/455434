/**
 * Alerts Repository
 * Data access layer for alerts collection
 */
import { AlertModel } from './alerts.model.js';
import type { IAlert, AlertSource } from './alerts.model.js';
import type { AlertScope } from './alert_rules.model.js';

export interface CreateAlertInput {
  userId: string;
  source: AlertSource;
  scope: AlertScope;
  targetId: string;
  signalType: string;
  strategyType?: string;
  severity: number;
  confidence: number;
  stability?: number;
  title: string;
  message: string;
  ruleId: string;
}

/**
 * Create alert
 */
export async function createAlert(input: CreateAlertInput): Promise<IAlert> {
  const alert = new AlertModel(input);
  return alert.save();
}

/**
 * Create many alerts (batch)
 */
export async function createManyAlerts(
  inputs: CreateAlertInput[]
): Promise<IAlert[]> {
  if (inputs.length === 0) return [];
  
  try {
    return await AlertModel.insertMany(inputs, { ordered: false });
  } catch (err: unknown) {
    // Handle duplicate key errors gracefully
    if (err && typeof err === 'object' && 'insertedDocs' in err) {
      return (err as { insertedDocs: IAlert[] }).insertedDocs;
    }
    throw err;
  }
}

/**
 * Get alert by ID
 */
export async function getAlertById(id: string): Promise<IAlert | null> {
  return AlertModel.findById(id).lean();
}

/**
 * Get user's alerts (feed)
 */
export async function getAlertsByUser(
  userId: string,
  options: {
    unacknowledgedOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<IAlert[]> {
  const query: Record<string, unknown> = { userId };
  
  if (options.unacknowledgedOnly) {
    query.acknowledgedAt = null;
  }
  
  return AlertModel
    .find(query)
    .sort({ createdAt: -1 })
    .skip(options.offset || 0)
    .limit(options.limit || 50)
    .lean();
}

/**
 * Get last alert for throttle checking
 */
export async function getLastAlertForThrottle(
  userId: string,
  ruleId: string,
  signalType: string
): Promise<IAlert | null> {
  return AlertModel
    .findOne({
      userId,
      ruleId,
      signalType,
    })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * Check if alert exists (dedup)
 */
export async function alertExists(
  userId: string,
  signalId: string,
  ruleId: string
): Promise<boolean> {
  const alert = await AlertModel.findOne({
    userId,
    'source.signalId': signalId,
    ruleId,
  }).lean();
  
  return alert !== null;
}

/**
 * Acknowledge alert
 */
export async function acknowledgeAlert(id: string): Promise<IAlert | null> {
  return AlertModel.findByIdAndUpdate(
    id,
    { $set: { acknowledgedAt: new Date() } },
    { new: true }
  ).lean();
}

/**
 * Acknowledge all alerts for user
 */
export async function acknowledgeAllAlerts(userId: string): Promise<number> {
  const result = await AlertModel.updateMany(
    { userId, acknowledgedAt: null },
    { $set: { acknowledgedAt: new Date() } }
  );
  return result.modifiedCount;
}

/**
 * Get unacknowledged count
 */
export async function getUnacknowledgedCount(userId: string): Promise<number> {
  return AlertModel.countDocuments({ userId, acknowledgedAt: null });
}

/**
 * Get alerts stats
 */
export async function getAlertsStats(userId?: string): Promise<{
  total: number;
  unacknowledged: number;
  last24h: number;
  bySignalType: Record<string, number>;
}> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const query: Record<string, unknown> = {};
  if (userId) query.userId = userId;
  
  const [total, unacknowledged, last24h, byTypeAgg] = await Promise.all([
    AlertModel.countDocuments(query),
    AlertModel.countDocuments({ ...query, acknowledgedAt: null }),
    AlertModel.countDocuments({ ...query, createdAt: { $gte: yesterday } }),
    AlertModel.aggregate([
      { $match: query },
      { $group: { _id: '$signalType', count: { $sum: 1 } } },
    ]),
  ]);
  
  const bySignalType: Record<string, number> = {};
  for (const item of byTypeAgg) {
    bySignalType[item._id] = item.count;
  }
  
  return { total, unacknowledged, last24h, bySignalType };
}
