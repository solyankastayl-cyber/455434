/**
 * Relations Repository
 * Database operations for aggregated relations
 */
import { 
  RelationModel, 
  IRelation, 
  RelationWindow, 
  RelationDirection, 
  RelationChain,
  RelationSource,
  calculateDensityScore 
} from './relations.model.js';
import { FilterQuery, SortOrder } from 'mongoose';

export interface RelationFilter {
  from?: string;
  to?: string;
  address?: string;  // from OR to
  window?: RelationWindow;
  direction?: RelationDirection;
  chain?: RelationChain;
  source?: RelationSource;
  minDensity?: number;
  maxDensity?: number;
}

export interface RelationSort {
  field: 'densityScore' | 'interactionCount' | 'lastSeenAt';
  order: 'asc' | 'desc';
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

/**
 * Build MongoDB filter
 */
function buildFilter(filter: RelationFilter): FilterQuery<IRelation> {
  const query: FilterQuery<IRelation> = {};

  // Address filter
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
  if (filter.direction) query.direction = filter.direction;
  if (filter.chain) query.chain = filter.chain;
  if (filter.source) query.source = filter.source;

  // Density range
  if (filter.minDensity !== undefined || filter.maxDensity !== undefined) {
    query.densityScore = {};
    if (filter.minDensity !== undefined) query.densityScore.$gte = filter.minDensity;
    if (filter.maxDensity !== undefined) query.densityScore.$lte = filter.maxDensity;
  }

  return query;
}

/**
 * Relations Repository Class
 */
export class RelationsRepository {
  /**
   * Find relation by ID
   */
  async findById(id: string): Promise<IRelation | null> {
    return RelationModel.findById(id).lean<IRelation>();
  }

  /**
   * Find unique relation by pair + window
   */
  async findByPair(
    from: string,
    to: string,
    window: RelationWindow,
    chain: RelationChain = 'ethereum'
  ): Promise<IRelation | null> {
    return RelationModel.findOne({
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      window,
      chain,
    }).lean<IRelation>();
  }

  /**
   * Find corridor (both directions)
   */
  async findCorridor(
    addressA: string,
    addressB: string,
    window: RelationWindow = '7d'
  ): Promise<IRelation[]> {
    const a = addressA.toLowerCase();
    const b = addressB.toLowerCase();

    return RelationModel.find({
      $or: [
        { from: a, to: b, window },
        { from: b, to: a, window },
      ],
    })
      .sort({ densityScore: -1 })
      .lean<IRelation[]>();
  }

  /**
   * Find relations with filters
   */
  async findMany(
    filter: RelationFilter,
    sort: RelationSort = { field: 'densityScore', order: 'desc' },
    pagination: PaginationOptions = { limit: 100, offset: 0 }
  ): Promise<{ relations: IRelation[]; total: number }> {
    const query = buildFilter(filter);
    const sortObj: Record<string, SortOrder> = {
      [sort.field]: sort.order === 'asc' ? 1 : -1,
    };

    const [relations, total] = await Promise.all([
      RelationModel.find(query)
        .sort(sortObj)
        .skip(pagination.offset)
        .limit(pagination.limit)
        .lean<IRelation[]>(),
      RelationModel.countDocuments(query),
    ]);

    return { relations, total };
  }

  /**
   * Find top relations by density (for graph)
   */
  async findTopByDensity(
    window: RelationWindow = '7d',
    minDensity: number = 0,
    limit: number = 100
  ): Promise<IRelation[]> {
    return RelationModel.find({
      window,
      densityScore: { $gte: minDensity },
    })
      .sort({ densityScore: -1 })
      .limit(limit)
      .lean<IRelation[]>();
  }

  /**
   * Find relations for address
   */
  async findForAddress(
    address: string,
    options: {
      window?: RelationWindow;
      direction?: 'in' | 'out' | 'both';
      minDensity?: number;
      limit?: number;
    } = {}
  ): Promise<IRelation[]> {
    const addr = address.toLowerCase();
    const { window = '7d', direction = 'both', minDensity = 0, limit = 50 } = options;

    let query: FilterQuery<IRelation>;

    if (direction === 'out') {
      query = { from: addr, window };
    } else if (direction === 'in') {
      query = { to: addr, window };
    } else {
      query = { $or: [{ from: addr }, { to: addr }], window };
    }

    if (minDensity > 0) {
      query.densityScore = { $gte: minDensity };
    }

    return RelationModel.find(query)
      .sort({ densityScore: -1 })
      .limit(limit)
      .lean<IRelation[]>();
  }

  /**
   * Upsert relation (main operation for build job)
   */
  async upsert(data: {
    from: string;
    to: string;
    chain: RelationChain;
    window: RelationWindow;
    direction: RelationDirection;
    interactionCount: number;
    volumeRaw: string;
    firstSeenAt: Date;
    lastSeenAt: Date;
    source: RelationSource;
    lastTransferProcessed?: string;
  }): Promise<IRelation> {
    const densityScore = calculateDensityScore(
      data.interactionCount,
      data.volumeRaw,
      data.window
    );

    const result = await RelationModel.findOneAndUpdate(
      {
        from: data.from.toLowerCase(),
        to: data.to.toLowerCase(),
        window: data.window,
        chain: data.chain,
      },
      {
        $set: {
          direction: data.direction,
          interactionCount: data.interactionCount,
          volumeRaw: data.volumeRaw,
          firstSeenAt: data.firstSeenAt,
          lastSeenAt: data.lastSeenAt,
          densityScore,
          source: data.source,
          lastTransferProcessed: data.lastTransferProcessed,
          processedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    ).lean<IRelation>();

    return result as IRelation;
  }

  /**
   * Bulk upsert relations
   */
  async bulkUpsert(
    relations: Array<{
      from: string;
      to: string;
      chain: RelationChain;
      window: RelationWindow;
      direction: RelationDirection;
      interactionCount: number;
      volumeRaw: string;
      firstSeenAt: Date;
      lastSeenAt: Date;
      source: RelationSource;
    }>
  ): Promise<{ upsertedCount: number; modifiedCount: number }> {
    if (relations.length === 0) {
      return { upsertedCount: 0, modifiedCount: 0 };
    }

    const bulkOps = relations.map((r) => {
      const densityScore = calculateDensityScore(
        r.interactionCount,
        r.volumeRaw,
        r.window
      );

      return {
        updateOne: {
          filter: {
            from: r.from.toLowerCase(),
            to: r.to.toLowerCase(),
            window: r.window,
            chain: r.chain,
          },
          update: {
            $set: {
              direction: r.direction,
              interactionCount: r.interactionCount,
              volumeRaw: r.volumeRaw,
              firstSeenAt: r.firstSeenAt,
              lastSeenAt: r.lastSeenAt,
              densityScore,
              source: r.source,
              processedAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    });

    const result = await RelationModel.bulkWrite(bulkOps, { ordered: false });

    return {
      upsertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalRelations: number;
    byWindow: Record<string, number>;
    avgDensity: number;
    maxDensity: number;
  }> {
    const [total, byWindow, stats] = await Promise.all([
      RelationModel.countDocuments(),
      RelationModel.aggregate([
        { $group: { _id: '$window', count: { $sum: 1 } } },
      ]),
      RelationModel.aggregate([
        {
          $group: {
            _id: null,
            avgDensity: { $avg: '$densityScore' },
            maxDensity: { $max: '$densityScore' },
          },
        },
      ]),
    ]);

    const windowStats: Record<string, number> = {};
    byWindow.forEach((w) => { windowStats[w._id] = w.count; });

    return {
      totalRelations: total,
      byWindow: windowStats,
      avgDensity: stats[0]?.avgDensity || 0,
      maxDensity: stats[0]?.maxDensity || 0,
    };
  }

  /**
   * Delete old relations
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const result = await RelationModel.deleteMany({
      lastSeenAt: { $lt: date },
    });
    return result.deletedCount;
  }
}

// Export singleton instance
export const relationsRepository = new RelationsRepository();
