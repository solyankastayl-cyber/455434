/**
 * Transfers Repository
 * Database operations for normalized transfers
 */
import { TransferModel, ITransfer, AssetType, Chain, TransferSource } from './transfers.model.js';
import { FilterQuery, SortOrder } from 'mongoose';

export interface TransferFilter {
  from?: string;
  to?: string;
  address?: string;  // from OR to
  assetAddress?: string;
  assetType?: AssetType;
  chain?: Chain;
  source?: TransferSource;
  processed?: boolean;
  since?: Date;
  until?: Date;
  minBlockNumber?: number;
  maxBlockNumber?: number;
}

export interface TransferSort {
  field: 'timestamp' | 'blockNumber' | 'amountNormalized';
  order: 'asc' | 'desc';
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

/**
 * Build MongoDB filter
 */
function buildFilter(filter: TransferFilter): FilterQuery<ITransfer> {
  const query: FilterQuery<ITransfer> = {};

  // Address filter (from OR to)
  if (filter.address) {
    query.$or = [
      { from: filter.address.toLowerCase() },
      { to: filter.address.toLowerCase() },
    ];
  } else {
    if (filter.from) query.from = filter.from.toLowerCase();
    if (filter.to) query.to = filter.to.toLowerCase();
  }

  if (filter.assetAddress) query.assetAddress = filter.assetAddress.toLowerCase();
  if (filter.assetType) query.assetType = filter.assetType;
  if (filter.chain) query.chain = filter.chain;
  if (filter.source) query.source = filter.source;
  if (filter.processed !== undefined) query.processed = filter.processed;

  // Time range
  if (filter.since || filter.until) {
    query.timestamp = {};
    if (filter.since) query.timestamp.$gte = filter.since;
    if (filter.until) query.timestamp.$lte = filter.until;
  }

  // Block range
  if (filter.minBlockNumber || filter.maxBlockNumber) {
    query.blockNumber = {};
    if (filter.minBlockNumber) query.blockNumber.$gte = filter.minBlockNumber;
    if (filter.maxBlockNumber) query.blockNumber.$lte = filter.maxBlockNumber;
  }

  return query;
}

/**
 * Transfers Repository Class
 */
export class TransfersRepository {
  /**
   * Find transfer by ID
   */
  async findById(id: string): Promise<ITransfer | null> {
    return TransferModel.findById(id).lean<ITransfer>();
  }

  /**
   * Find transfer by source reference
   */
  async findBySourceId(sourceId: string, source: TransferSource): Promise<ITransfer | null> {
    return TransferModel.findOne({ sourceId, source }).lean<ITransfer>();
  }

  /**
   * Check if transfer exists
   */
  async exists(txHash: string, logIndex: number | null, source: TransferSource): Promise<boolean> {
    const count = await TransferModel.countDocuments({ txHash, logIndex, source });
    return count > 0;
  }

  /**
   * Find transfers with filters
   */
  async findMany(
    filter: TransferFilter,
    sort: TransferSort = { field: 'timestamp', order: 'desc' },
    pagination: PaginationOptions = { limit: 100, offset: 0 }
  ): Promise<{ transfers: ITransfer[]; total: number }> {
    const query = buildFilter(filter);
    const sortObj: Record<string, SortOrder> = {
      [sort.field]: sort.order === 'asc' ? 1 : -1,
    };

    const [transfers, total] = await Promise.all([
      TransferModel.find(query)
        .sort(sortObj)
        .skip(pagination.offset)
        .limit(pagination.limit)
        .lean<ITransfer[]>(),
      TransferModel.countDocuments(query),
    ]);

    return { transfers, total };
  }

  /**
   * Find transfers between two addresses (corridor)
   */
  async findCorridor(
    from: string,
    to: string,
    options: {
      assetAddress?: string;
      since?: Date;
      until?: Date;
      limit?: number;
    } = {}
  ): Promise<ITransfer[]> {
    const query: FilterQuery<ITransfer> = {
      $or: [
        { from: from.toLowerCase(), to: to.toLowerCase() },
        { from: to.toLowerCase(), to: from.toLowerCase() },
      ],
    };

    if (options.assetAddress) {
      query.assetAddress = options.assetAddress.toLowerCase();
    }

    if (options.since || options.until) {
      query.timestamp = {};
      if (options.since) query.timestamp.$gte = options.since;
      if (options.until) query.timestamp.$lte = options.until;
    }

    return TransferModel.find(query)
      .sort({ timestamp: -1 })
      .limit(options.limit || 100)
      .lean<ITransfer[]>();
  }

  /**
   * Find unprocessed transfers (for relations/bundles jobs)
   */
  async findUnprocessed(limit: number = 1000): Promise<ITransfer[]> {
    return TransferModel.find({ processed: false })
      .sort({ timestamp: 1 })
      .limit(limit)
      .lean<ITransfer[]>();
  }

  /**
   * Create transfer
   */
  async create(data: Omit<ITransfer, '_id' | 'createdAt' | 'updatedAt'>): Promise<ITransfer> {
    const transfer = new TransferModel(data);
    return transfer.save();
  }

  /**
   * Bulk create transfers (upsert)
   */
  async bulkUpsert(
    transfers: Array<{
      txHash: string;
      logIndex: number | null;
      blockNumber: number;
      timestamp: Date;
      from: string;
      to: string;
      assetType: AssetType;
      assetAddress: string;
      amountRaw: string;
      amountNormalized?: number | null;
      chain: Chain;
      source: TransferSource;
      sourceId: string;
    }>
  ): Promise<{ insertedCount: number; modifiedCount: number }> {
    if (transfers.length === 0) {
      return { insertedCount: 0, modifiedCount: 0 };
    }

    const bulkOps = transfers.map((t) => ({
      updateOne: {
        filter: { txHash: t.txHash.toLowerCase(), logIndex: t.logIndex, source: t.source },
        update: {
          $setOnInsert: {
            txHash: t.txHash.toLowerCase(),
            logIndex: t.logIndex,
            blockNumber: t.blockNumber,
            timestamp: t.timestamp,
            from: t.from.toLowerCase(),
            to: t.to.toLowerCase(),
            assetType: t.assetType,
            assetAddress: t.assetAddress.toLowerCase(),
            amountRaw: t.amountRaw,
            amountNormalized: t.amountNormalized ?? null,
            chain: t.chain,
            source: t.source,
            sourceId: t.sourceId,
            processed: false,
            processedAt: null,
          },
        },
        upsert: true,
      },
    }));

    const result = await TransferModel.bulkWrite(bulkOps, { ordered: false });

    return {
      insertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  /**
   * Mark transfers as processed
   */
  async markProcessed(ids: string[]): Promise<number> {
    const result = await TransferModel.updateMany(
      { _id: { $in: ids } },
      { $set: { processed: true, processedAt: new Date() } }
    );
    return result.modifiedCount;
  }

  /**
   * Get netflow for address (in - out)
   */
  async getNetflow(
    address: string,
    options: {
      assetAddress?: string;
      since?: Date;
      until?: Date;
    } = {}
  ): Promise<{ inflow: string; outflow: string; netflow: string; count: number }> {
    const addr = address.toLowerCase();
    
    const matchStage: FilterQuery<ITransfer> = {};
    if (options.assetAddress) matchStage.assetAddress = options.assetAddress.toLowerCase();
    if (options.since || options.until) {
      matchStage.timestamp = {};
      if (options.since) matchStage.timestamp.$gte = options.since;
      if (options.until) matchStage.timestamp.$lte = options.until;
    }

    const [inflowResult, outflowResult] = await Promise.all([
      // Inflow: transfers TO this address
      TransferModel.aggregate([
        { $match: { to: addr, ...matchStage } },
        {
          $group: {
            _id: null,
            total: { $sum: { $toDouble: '$amountRaw' } },
            count: { $sum: 1 },
          },
        },
      ]),
      // Outflow: transfers FROM this address
      TransferModel.aggregate([
        { $match: { from: addr, ...matchStage } },
        {
          $group: {
            _id: null,
            total: { $sum: { $toDouble: '$amountRaw' } },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const inflow = inflowResult[0]?.total || 0;
    const outflow = outflowResult[0]?.total || 0;
    const inflowCount = inflowResult[0]?.count || 0;
    const outflowCount = outflowResult[0]?.count || 0;

    return {
      inflow: BigInt(Math.floor(inflow)).toString(),
      outflow: BigInt(Math.floor(outflow)).toString(),
      netflow: BigInt(Math.floor(inflow - outflow)).toString(),
      count: inflowCount + outflowCount,
    };
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalTransfers: number;
    bySource: Record<string, number>;
    byAssetType: Record<string, number>;
    processedCount: number;
    unprocessedCount: number;
    latestBlock: number | null;
    latestTimestamp: Date | null;
  }> {
    const [total, bySource, byAssetType, processed, latest] = await Promise.all([
      TransferModel.countDocuments(),
      TransferModel.aggregate([
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]),
      TransferModel.aggregate([
        { $group: { _id: '$assetType', count: { $sum: 1 } } },
      ]),
      TransferModel.aggregate([
        { $group: { _id: '$processed', count: { $sum: 1 } } },
      ]),
      TransferModel.findOne().sort({ blockNumber: -1 }).lean<ITransfer>(),
    ]);

    const sourceStats: Record<string, number> = {};
    bySource.forEach((s) => { sourceStats[s._id] = s.count; });

    const assetStats: Record<string, number> = {};
    byAssetType.forEach((a) => { assetStats[a._id] = a.count; });

    let processedCount = 0;
    let unprocessedCount = 0;
    processed.forEach((p) => {
      if (p._id === true) processedCount = p.count;
      else unprocessedCount = p.count;
    });

    return {
      totalTransfers: total,
      bySource: sourceStats,
      byAssetType: assetStats,
      processedCount,
      unprocessedCount,
      latestBlock: latest?.blockNumber || null,
      latestTimestamp: latest?.timestamp || null,
    };
  }

  /**
   * Get unique counterparties for an address
   */
  async getCounterparties(
    address: string,
    options: {
      direction?: 'in' | 'out' | 'both';
      limit?: number;
    } = {}
  ): Promise<Array<{ address: string; transferCount: number; direction: 'in' | 'out' }>> {
    const addr = address.toLowerCase();
    const { direction = 'both', limit = 100 } = options;

    const results: Array<{ address: string; transferCount: number; direction: 'in' | 'out' }> = [];

    if (direction === 'out' || direction === 'both') {
      const outgoing = await TransferModel.aggregate([
        { $match: { from: addr } },
        { $group: { _id: '$to', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]);
      outgoing.forEach((o) => {
        results.push({ address: o._id, transferCount: o.count, direction: 'out' });
      });
    }

    if (direction === 'in' || direction === 'both') {
      const incoming = await TransferModel.aggregate([
        { $match: { to: addr } },
        { $group: { _id: '$from', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]);
      incoming.forEach((i) => {
        results.push({ address: i._id, transferCount: i.count, direction: 'in' });
      });
    }

    return results;
  }
}

// Export singleton instance
export const transfersRepository = new TransfersRepository();
