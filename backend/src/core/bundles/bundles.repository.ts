/**
 * Bundles Repository
 * Database operations for bundles
 */
import { 
  BundleModel, 
  IBundle, 
  BundleType, 
  BundleWindow, 
  BundleChain,
  calculateIntensityScore,
  getNetflowDirection
} from './bundles.model.js';
import { FilterQuery, SortOrder } from 'mongoose';

export interface BundleFilter {
  from?: string;
  to?: string;
  address?: string;  // from OR to
  window?: BundleWindow;
  bundleType?: BundleType;
  chain?: BundleChain;
  minIntensity?: number;
  minConfidence?: number;
}

export interface BundleSort {
  field: 'intensityScore' | 'densityScore' | 'confidence' | 'lastSeenAt';
  order: 'asc' | 'desc';
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

/**
 * Build MongoDB filter
 */
function buildFilter(filter: BundleFilter): FilterQuery<IBundle> {
  const query: FilterQuery<IBundle> = {};

  if (filter.address) {
    const addr = filter.address.toLowerCase();
    query.$or = [
      { from: addr },
      { to: addr },
    ];
  } else {
    if (filter.from) query.from = filter.from.toLowerCase();
    if (filter.to) query.to = filter.to.toLowerCase();
  }

  if (filter.window) query.window = filter.window;
  if (filter.bundleType) query.bundleType = filter.bundleType;
  if (filter.chain) query.chain = filter.chain;

  if (filter.minIntensity !== undefined) {
    query.intensityScore = { $gte: filter.minIntensity };
  }

  if (filter.minConfidence !== undefined) {
    query.confidence = { $gte: filter.minConfidence };
  }

  return query;
}

/**
 * Bundles Repository Class
 */
export class BundlesRepository {
  /**
   * Find bundle by ID
   */
  async findById(id: string): Promise<IBundle | null> {
    return BundleModel.findById(id).lean<IBundle>();
  }

  /**
   * Find bundle by corridor + window
   */
  async findByCorridor(
    from: string,
    to: string,
    window: BundleWindow,
    chain: BundleChain = 'ethereum'
  ): Promise<IBundle | null> {
    return BundleModel.findOne({
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      window,
      chain,
    }).lean<IBundle>();
  }

  /**
   * Find bundles with filters
   */
  async findMany(
    filter: BundleFilter,
    sort: BundleSort = { field: 'intensityScore', order: 'desc' },
    pagination: PaginationOptions = { limit: 50, offset: 0 }
  ): Promise<{ bundles: IBundle[]; total: number }> {
    const query = buildFilter(filter);
    const sortObj: Record<string, SortOrder> = {
      [sort.field]: sort.order === 'asc' ? 1 : -1,
    };

    const [bundles, total] = await Promise.all([
      BundleModel.find(query)
        .sort(sortObj)
        .skip(pagination.offset)
        .limit(pagination.limit)
        .lean<IBundle[]>(),
      BundleModel.countDocuments(query),
    ]);

    return { bundles, total };
  }

  /**
   * Find active bundles (high intensity)
   */
  async findActive(
    window: BundleWindow = '7d',
    options: {
      bundleType?: BundleType;
      minIntensity?: number;
      minConfidence?: number;
      limit?: number;
    } = {}
  ): Promise<IBundle[]> {
    const query: FilterQuery<IBundle> = { window };

    if (options.bundleType) query.bundleType = options.bundleType;
    if (options.minIntensity) query.intensityScore = { $gte: options.minIntensity };
    if (options.minConfidence) query.confidence = { $gte: options.minConfidence };

    return BundleModel.find(query)
      .sort({ intensityScore: -1 })
      .limit(options.limit || 50)
      .lean<IBundle[]>();
  }

  /**
   * Find bundles for address
   */
  async findForAddress(
    address: string,
    options: {
      window?: BundleWindow;
      direction?: 'in' | 'out' | 'both';
      bundleType?: BundleType;
      limit?: number;
    } = {}
  ): Promise<IBundle[]> {
    const addr = address.toLowerCase();
    const { window = '7d', direction = 'both', limit = 50 } = options;

    let query: FilterQuery<IBundle>;

    if (direction === 'out') {
      query = { from: addr, window };
    } else if (direction === 'in') {
      query = { to: addr, window };
    } else {
      query = { $or: [{ from: addr }, { to: addr }], window };
    }

    if (options.bundleType) query.bundleType = options.bundleType;

    return BundleModel.find(query)
      .sort({ intensityScore: -1 })
      .limit(limit)
      .lean<IBundle[]>();
  }

  /**
   * Upsert bundle
   */
  async upsert(data: {
    from: string;
    to: string;
    chain: BundleChain;
    window: BundleWindow;
    bundleType: BundleType;
    confidence: number;
    interactionCount: number;
    densityScore: number;
    netflowRaw: string;
    consistencyScore: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
    sourceRelationIds?: string[];
  }): Promise<IBundle> {
    const intensityScore = calculateIntensityScore(data.densityScore, data.netflowRaw);
    const netflowDirection = getNetflowDirection(data.netflowRaw);

    const result = await BundleModel.findOneAndUpdate(
      {
        from: data.from.toLowerCase(),
        to: data.to.toLowerCase(),
        window: data.window,
        chain: data.chain,
      },
      {
        $set: {
          bundleType: data.bundleType,
          confidence: data.confidence,
          interactionCount: data.interactionCount,
          densityScore: data.densityScore,
          netflowRaw: data.netflowRaw,
          netflowDirection,
          intensityScore,
          consistencyScore: data.consistencyScore,
          firstSeenAt: data.firstSeenAt,
          lastSeenAt: data.lastSeenAt,
          sourceRelationIds: data.sourceRelationIds || [],
          processedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    ).lean<IBundle>();

    return result as IBundle;
  }

  /**
   * Bulk upsert bundles
   */
  async bulkUpsert(
    bundles: Array<{
      from: string;
      to: string;
      chain: BundleChain;
      window: BundleWindow;
      bundleType: BundleType;
      confidence: number;
      interactionCount: number;
      densityScore: number;
      netflowRaw: string;
      consistencyScore: number;
      firstSeenAt: Date;
      lastSeenAt: Date;
      sourceRelationIds?: string[];
    }>
  ): Promise<{ upsertedCount: number; modifiedCount: number }> {
    if (bundles.length === 0) {
      return { upsertedCount: 0, modifiedCount: 0 };
    }

    const bulkOps = bundles.map((b) => {
      const intensityScore = calculateIntensityScore(b.densityScore, b.netflowRaw);
      const netflowDirection = getNetflowDirection(b.netflowRaw);

      return {
        updateOne: {
          filter: {
            from: b.from.toLowerCase(),
            to: b.to.toLowerCase(),
            window: b.window,
            chain: b.chain,
          },
          update: {
            $set: {
              bundleType: b.bundleType,
              confidence: b.confidence,
              interactionCount: b.interactionCount,
              densityScore: b.densityScore,
              netflowRaw: b.netflowRaw,
              netflowDirection,
              intensityScore,
              consistencyScore: b.consistencyScore,
              firstSeenAt: b.firstSeenAt,
              lastSeenAt: b.lastSeenAt,
              sourceRelationIds: b.sourceRelationIds || [],
              processedAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    });

    const result = await BundleModel.bulkWrite(bulkOps, { ordered: false });

    return {
      upsertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalBundles: number;
    byType: Record<string, number>;
    byWindow: Record<string, number>;
    avgIntensity: number;
    avgConfidence: number;
  }> {
    const [total, byType, byWindow, stats] = await Promise.all([
      BundleModel.countDocuments(),
      BundleModel.aggregate([
        { $group: { _id: '$bundleType', count: { $sum: 1 } } },
      ]),
      BundleModel.aggregate([
        { $group: { _id: '$window', count: { $sum: 1 } } },
      ]),
      BundleModel.aggregate([
        {
          $group: {
            _id: null,
            avgIntensity: { $avg: '$intensityScore' },
            avgConfidence: { $avg: '$confidence' },
          },
        },
      ]),
    ]);

    const typeStats: Record<string, number> = {};
    byType.forEach((t) => { typeStats[t._id] = t.count; });

    const windowStats: Record<string, number> = {};
    byWindow.forEach((w) => { windowStats[w._id] = w.count; });

    return {
      totalBundles: total,
      byType: typeStats,
      byWindow: windowStats,
      avgIntensity: stats[0]?.avgIntensity || 0,
      avgConfidence: stats[0]?.avgConfidence || 0,
    };
  }
}

// Export singleton instance
export const bundlesRepository = new BundlesRepository();
