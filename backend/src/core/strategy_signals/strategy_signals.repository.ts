/**
 * Strategy Signals Repository
 * Data access layer for strategy_signals collection
 */
import {
  StrategySignalModel,
  IStrategySignal,
  StrategySignalType,
} from './strategy_signals.model.js';

export interface CreateStrategySignalInput {
  actorAddress: string;
  chain: string;
  window: '7d' | '30d' | '90d';
  type: StrategySignalType;
  strategyType: string;
  previousStrategyType?: string;
  severity: number;
  confidence: number;
  stability: number;
  dedupKey: string;
  dedupUntil: Date;
  explanation: string;
  evidence: IStrategySignal['evidence'];
}

export interface StrategySignalFilters {
  type?: StrategySignalType;
  window?: '7d' | '30d' | '90d';
  strategyType?: string;
  minSeverity?: number;
  minConfidence?: number;
  actorAddress?: string;
}

/**
 * Create a new strategy signal
 */
export async function createStrategySignal(
  input: CreateStrategySignalInput
): Promise<IStrategySignal> {
  const signal = new StrategySignalModel(input);
  return signal.save();
}

/**
 * Create multiple strategy signals
 */
export async function createManyStrategySignals(
  inputs: CreateStrategySignalInput[]
): Promise<IStrategySignal[]> {
  if (inputs.length === 0) return [];
  return StrategySignalModel.insertMany(inputs);
}

/**
 * Check if signal is deduplicated (already exists and not expired)
 */
export async function isDuplicate(dedupKey: string): Promise<boolean> {
  const existing = await StrategySignalModel.findOne({
    dedupKey,
    dedupUntil: { $gt: new Date() },
  }).lean();
  
  return existing !== null;
}

/**
 * Get latest strategy signals
 */
export async function getLatestStrategySignals(
  filters: StrategySignalFilters = {},
  limit: number = 50,
  offset: number = 0
): Promise<IStrategySignal[]> {
  const query: Record<string, unknown> = {};
  
  if (filters.type) query.type = filters.type;
  if (filters.window) query.window = filters.window;
  if (filters.strategyType) query.strategyType = filters.strategyType;
  if (filters.minSeverity !== undefined) query.severity = { $gte: filters.minSeverity };
  if (filters.minConfidence !== undefined) query.confidence = { $gte: filters.minConfidence };
  if (filters.actorAddress) query.actorAddress = filters.actorAddress.toLowerCase();
  
  return StrategySignalModel
    .find(query)
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(limit)
    .lean();
}

/**
 * Get strategy signals for specific address
 */
export async function getStrategySignalsByAddress(
  address: string,
  limit: number = 50
): Promise<IStrategySignal[]> {
  return StrategySignalModel
    .find({ actorAddress: address.toLowerCase() })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get strategy signals by type
 */
export async function getStrategySignalsByType(
  type: StrategySignalType,
  limit: number = 50
): Promise<IStrategySignal[]> {
  return StrategySignalModel
    .find({ type })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get strategy signals stats
 */
export async function getStrategySignalsStats(): Promise<{
  total: number;
  last24h: number;
  byType: Record<string, number>;
  byStrategy: Record<string, number>;
  avgSeverity: number;
  avgConfidence: number;
}> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const [total, last24h, byTypeAgg, byStrategyAgg, avgStats] = await Promise.all([
    StrategySignalModel.countDocuments(),
    StrategySignalModel.countDocuments({ createdAt: { $gte: yesterday } }),
    StrategySignalModel.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    StrategySignalModel.aggregate([
      { $group: { _id: '$strategyType', count: { $sum: 1 } } },
    ]),
    StrategySignalModel.aggregate([
      {
        $group: {
          _id: null,
          avgSeverity: { $avg: '$severity' },
          avgConfidence: { $avg: '$confidence' },
        },
      },
    ]),
  ]);
  
  const byType: Record<string, number> = {};
  for (const item of byTypeAgg) {
    byType[item._id] = item.count;
  }
  
  const byStrategy: Record<string, number> = {};
  for (const item of byStrategyAgg) {
    byStrategy[item._id] = item.count;
  }
  
  return {
    total,
    last24h,
    byType,
    byStrategy,
    avgSeverity: avgStats[0]?.avgSeverity || 0,
    avgConfidence: avgStats[0]?.avgConfidence || 0,
  };
}

/**
 * Count strategy signals
 */
export async function countStrategySignals(
  filters: StrategySignalFilters = {}
): Promise<number> {
  const query: Record<string, unknown> = {};
  
  if (filters.type) query.type = filters.type;
  if (filters.window) query.window = filters.window;
  if (filters.strategyType) query.strategyType = filters.strategyType;
  if (filters.minSeverity !== undefined) query.severity = { $gte: filters.minSeverity };
  if (filters.actorAddress) query.actorAddress = filters.actorAddress.toLowerCase();
  
  return StrategySignalModel.countDocuments(query);
}
