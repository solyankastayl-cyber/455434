/**
 * Signals Repository
 * Database operations for signals
 */
import { 
  SignalModel, 
  ISignal, 
  SignalType, 
  SignalEntityType,
  SignalSeverity,
  getSeverityFromScore,
  calculateSeverityScore,
  generateExplanation
} from './signals.model.js';
import { FilterQuery, SortOrder } from 'mongoose';

export interface SignalFilter {
  entityType?: SignalEntityType;
  entityId?: string;
  signalType?: SignalType;
  severity?: SignalSeverity;
  minSeverityScore?: number;
  window?: string;
  chain?: string;
  acknowledged?: boolean;
  since?: Date;
  until?: Date;
}

export interface SignalSort {
  field: 'triggeredAt' | 'severityScore' | 'confidence';
  order: 'asc' | 'desc';
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

/**
 * Build MongoDB filter
 */
function buildFilter(filter: SignalFilter): FilterQuery<ISignal> {
  const query: FilterQuery<ISignal> = {};

  if (filter.entityType) query.entityType = filter.entityType;
  if (filter.entityId) query.entityId = filter.entityId.toLowerCase();
  if (filter.signalType) query.signalType = filter.signalType;
  if (filter.severity) query.severity = filter.severity;
  if (filter.window) query.window = filter.window;
  if (filter.chain) query.chain = filter.chain;
  if (filter.acknowledged !== undefined) query.acknowledged = filter.acknowledged;

  if (filter.minSeverityScore !== undefined) {
    query.severityScore = { $gte: filter.minSeverityScore };
  }

  if (filter.since || filter.until) {
    query.triggeredAt = {};
    if (filter.since) query.triggeredAt.$gte = filter.since;
    if (filter.until) query.triggeredAt.$lte = filter.until;
  }

  return query;
}

/**
 * Signals Repository Class
 */
export class SignalsRepository {
  /**
   * Find signal by ID
   */
  async findById(id: string): Promise<ISignal | null> {
    return SignalModel.findById(id).lean<ISignal>();
  }

  /**
   * Find signals with filters
   */
  async findMany(
    filter: SignalFilter,
    sort: SignalSort = { field: 'triggeredAt', order: 'desc' },
    pagination: PaginationOptions = { limit: 50, offset: 0 }
  ): Promise<{ signals: ISignal[]; total: number }> {
    const query = buildFilter(filter);
    const sortObj: Record<string, SortOrder> = {
      [sort.field]: sort.order === 'asc' ? 1 : -1,
    };

    const [signals, total] = await Promise.all([
      SignalModel.find(query)
        .sort(sortObj)
        .skip(pagination.offset)
        .limit(pagination.limit)
        .lean<ISignal[]>(),
      SignalModel.countDocuments(query),
    ]);

    return { signals, total };
  }

  /**
   * Find latest signals
   */
  async findLatest(
    options: {
      limit?: number;
      signalType?: SignalType;
      severity?: SignalSeverity;
      minSeverityScore?: number;
      window?: string;
      acknowledged?: boolean;
      since?: Date;
    } = {}
  ): Promise<ISignal[]> {
    const filter: SignalFilter = {};
    if (options.signalType) filter.signalType = options.signalType;
    if (options.severity) filter.severity = options.severity;
    if (options.minSeverityScore) filter.minSeverityScore = options.minSeverityScore;
    if (options.window) filter.window = options.window;
    if (options.acknowledged !== undefined) filter.acknowledged = options.acknowledged;
    if (options.since) filter.since = options.since;

    return SignalModel.find(buildFilter(filter))
      .sort({ triggeredAt: -1 })
      .limit(options.limit || 50)
      .lean<ISignal[]>();
  }

  /**
   * Find signals for entity
   */
  async findForEntity(
    entityType: SignalEntityType,
    entityId: string,
    options: {
      limit?: number;
      signalType?: SignalType;
      since?: Date;
    } = {}
  ): Promise<ISignal[]> {
    const query: FilterQuery<ISignal> = {
      entityType,
      entityId: entityId.toLowerCase(),
    };

    if (options.signalType) query.signalType = options.signalType;
    if (options.since) query.triggeredAt = { $gte: options.since };

    return SignalModel.find(query)
      .sort({ triggeredAt: -1 })
      .limit(options.limit || 50)
      .lean<ISignal[]>();
  }

  /**
   * Find signals for address (as participant)
   */
  async findForAddress(
    address: string,
    options: {
      limit?: number;
      signalType?: SignalType;
      severity?: SignalSeverity;
      since?: Date;
    } = {}
  ): Promise<ISignal[]> {
    const addr = address.toLowerCase();
    const query: FilterQuery<ISignal> = {
      $or: [
        { entityId: addr },
        { relatedAddresses: addr },
      ],
    };

    if (options.signalType) query.signalType = options.signalType;
    if (options.severity) query.severity = options.severity;
    if (options.since) query.triggeredAt = { $gte: options.since };

    return SignalModel.find(query)
      .sort({ triggeredAt: -1 })
      .limit(options.limit || 50)
      .lean<ISignal[]>();
  }

  /**
   * Find signals for corridor
   */
  async findForCorridor(
    from: string,
    to: string,
    options: {
      limit?: number;
      signalType?: SignalType;
      since?: Date;
    } = {}
  ): Promise<ISignal[]> {
    const corridorId = `${from.toLowerCase()}:${to.toLowerCase()}`;
    const reverseCorridorId = `${to.toLowerCase()}:${from.toLowerCase()}`;

    const query: FilterQuery<ISignal> = {
      entityType: 'corridor',
      $or: [
        { entityId: corridorId },
        { entityId: reverseCorridorId },
      ],
    };

    if (options.signalType) query.signalType = options.signalType;
    if (options.since) query.triggeredAt = { $gte: options.since };

    return SignalModel.find(query)
      .sort({ triggeredAt: -1 })
      .limit(options.limit || 50)
      .lean<ISignal[]>();
  }

  /**
   * Create signal
   */
  async create(data: {
    entityType: SignalEntityType;
    entityId: string;
    signalType: SignalType;
    prevBundleType?: string | null;
    newBundleType?: string | null;
    prevIntensity?: number | null;
    newIntensity?: number | null;
    confidence: number;
    window: string;
    chain?: string;
    relatedAddresses?: string[];
  }): Promise<ISignal> {
    const intensityDelta = (data.newIntensity || 0) - (data.prevIntensity || 0);
    const severityScore = calculateSeverityScore(
      data.signalType,
      data.confidence,
      intensityDelta
    );
    const severity = getSeverityFromScore(severityScore);
    const explanation = generateExplanation(
      data.signalType,
      data.entityType,
      data.prevBundleType || null,
      data.newBundleType || null,
      data.confidence
    );

    const signal = new SignalModel({
      entityType: data.entityType,
      entityId: data.entityId.toLowerCase(),
      signalType: data.signalType,
      prevBundleType: data.prevBundleType || null,
      newBundleType: data.newBundleType || null,
      prevIntensity: data.prevIntensity ?? null,
      newIntensity: data.newIntensity ?? null,
      confidence: data.confidence,
      severityScore,
      severity,
      window: data.window,
      chain: data.chain || 'ethereum',
      triggeredAt: new Date(),
      explanation,
      relatedAddresses: (data.relatedAddresses || []).map(a => a.toLowerCase()),
      acknowledged: false,
    });

    return signal.save();
  }

  /**
   * Check if similar signal exists recently (dedup)
   */
  async existsRecent(
    entityId: string,
    signalType: SignalType,
    window: string,
    withinMinutes: number = 60
  ): Promise<boolean> {
    const since = new Date(Date.now() - withinMinutes * 60 * 1000);
    const count = await SignalModel.countDocuments({
      entityId: entityId.toLowerCase(),
      signalType,
      window,
      triggeredAt: { $gte: since },
    });
    return count > 0;
  }

  /**
   * Acknowledge signal
   */
  async acknowledge(id: string): Promise<ISignal | null> {
    return SignalModel.findByIdAndUpdate(
      id,
      { $set: { acknowledged: true, acknowledgedAt: new Date() } },
      { new: true }
    ).lean<ISignal>();
  }

  /**
   * Bulk acknowledge signals
   */
  async bulkAcknowledge(ids: string[]): Promise<number> {
    const result = await SignalModel.updateMany(
      { _id: { $in: ids } },
      { $set: { acknowledged: true, acknowledgedAt: new Date() } }
    );
    return result.modifiedCount;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalSignals: number;
    unacknowledged: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    last24h: number;
  }> {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, unack, byType, bySeverity, recent] = await Promise.all([
      SignalModel.countDocuments(),
      SignalModel.countDocuments({ acknowledged: false }),
      SignalModel.aggregate([
        { $group: { _id: '$signalType', count: { $sum: 1 } } },
      ]),
      SignalModel.aggregate([
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ]),
      SignalModel.countDocuments({ triggeredAt: { $gte: yesterday } }),
    ]);

    const typeStats: Record<string, number> = {};
    byType.forEach((t) => { typeStats[t._id] = t.count; });

    const severityStats: Record<string, number> = {};
    bySeverity.forEach((s) => { severityStats[s._id] = s.count; });

    return {
      totalSignals: total,
      unacknowledged: unack,
      byType: typeStats,
      bySeverity: severityStats,
      last24h: recent,
    };
  }
}

// Export singleton instance
export const signalsRepository = new SignalsRepository();
