/**
 * Transfers Service
 * Business logic for normalized transfers
 * 
 * This is a READ-ONLY service for external access.
 * Writing is done by build jobs (ERC20 → transfers, ETH → transfers, etc.)
 */
import {
  transfersRepository,
  TransferFilter,
  TransferSort,
  PaginationOptions,
} from './transfers.repository.js';
import { ITransfer, AssetType, Chain } from './transfers.model.js';

/**
 * Format transfer for API response
 */
export function formatTransfer(transfer: ITransfer) {
  return {
    id: transfer._id.toString(),
    txHash: transfer.txHash,
    logIndex: transfer.logIndex,
    blockNumber: transfer.blockNumber,
    timestamp: transfer.timestamp,
    from: transfer.from,
    to: transfer.to,
    assetType: transfer.assetType,
    assetAddress: transfer.assetAddress,
    amountRaw: transfer.amountRaw,
    amountNormalized: transfer.amountNormalized,
    chain: transfer.chain,
    source: transfer.source,
  };
}

/**
 * Transfers Service Class
 */
export class TransfersService {
  /**
   * Get transfer by ID
   */
  async getById(id: string): Promise<ITransfer | null> {
    return transfersRepository.findById(id);
  }

  /**
   * Query transfers by address
   */
  async queryByAddress(
    address: string,
    options: {
      direction?: 'in' | 'out' | 'both';
      assetAddress?: string;
      assetType?: AssetType;
      chain?: Chain;
      since?: Date;
      until?: Date;
      limit?: number;
      offset?: number;
      sortBy?: 'timestamp' | 'blockNumber' | 'amountNormalized';
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<{ transfers: ITransfer[]; total: number }> {
    const filter: TransferFilter = {};

    // Direction filter
    if (options.direction === 'in') {
      filter.to = address;
    } else if (options.direction === 'out') {
      filter.from = address;
    } else {
      filter.address = address;
    }

    if (options.assetAddress) filter.assetAddress = options.assetAddress;
    if (options.assetType) filter.assetType = options.assetType;
    if (options.chain) filter.chain = options.chain;
    if (options.since) filter.since = options.since;
    if (options.until) filter.until = options.until;

    const sort: TransferSort = {
      field: options.sortBy || 'timestamp',
      order: options.sortOrder || 'desc',
    };

    const pagination: PaginationOptions = {
      limit: options.limit || 100,
      offset: options.offset || 0,
    };

    return transfersRepository.findMany(filter, sort, pagination);
  }

  /**
   * Query transfers by asset
   */
  async queryByAsset(
    assetAddress: string,
    options: {
      from?: string;
      to?: string;
      since?: Date;
      until?: Date;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ transfers: ITransfer[]; total: number }> {
    const filter: TransferFilter = {
      assetAddress,
    };

    if (options.from) filter.from = options.from;
    if (options.to) filter.to = options.to;
    if (options.since) filter.since = options.since;
    if (options.until) filter.until = options.until;

    return transfersRepository.findMany(
      filter,
      { field: 'timestamp', order: 'desc' },
      { limit: options.limit || 100, offset: options.offset || 0 }
    );
  }

  /**
   * Get transfers between two addresses (corridor)
   */
  async getCorridor(
    addressA: string,
    addressB: string,
    options: {
      assetAddress?: string;
      since?: Date;
      until?: Date;
      limit?: number;
    } = {}
  ): Promise<{
    transfers: ITransfer[];
    summary: {
      totalCount: number;
      aToB: number;
      bToA: number;
    };
  }> {
    const transfers = await transfersRepository.findCorridor(
      addressA,
      addressB,
      options
    );

    // Calculate summary
    let aToB = 0;
    let bToA = 0;
    const addrA = addressA.toLowerCase();
    const addrB = addressB.toLowerCase();

    transfers.forEach((t) => {
      if (t.from === addrA && t.to === addrB) aToB++;
      else if (t.from === addrB && t.to === addrA) bToA++;
    });

    return {
      transfers,
      summary: {
        totalCount: transfers.length,
        aToB,
        bToA,
      },
    };
  }

  /**
   * Get netflow for address
   */
  async getNetflow(
    address: string,
    options: {
      assetAddress?: string;
      since?: Date;
      until?: Date;
    } = {}
  ): Promise<{
    address: string;
    inflow: string;
    outflow: string;
    netflow: string;
    transferCount: number;
    isPositive: boolean;
  }> {
    const result = await transfersRepository.getNetflow(address, options);

    return {
      address: address.toLowerCase(),
      inflow: result.inflow,
      outflow: result.outflow,
      netflow: result.netflow,
      transferCount: result.count,
      isPositive: BigInt(result.netflow) >= 0n,
    };
  }

  /**
   * Get counterparties for address
   */
  async getCounterparties(
    address: string,
    options: {
      direction?: 'in' | 'out' | 'both';
      limit?: number;
    } = {}
  ): Promise<Array<{ address: string; transferCount: number; direction: 'in' | 'out' }>> {
    return transfersRepository.getCounterparties(address, options);
  }

  /**
   * Get unprocessed transfers (for relations/bundles jobs)
   */
  async getUnprocessed(limit: number = 1000): Promise<ITransfer[]> {
    return transfersRepository.findUnprocessed(limit);
  }

  /**
   * Mark transfers as processed
   */
  async markProcessed(ids: string[]): Promise<number> {
    return transfersRepository.markProcessed(ids);
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
    return transfersRepository.getStats();
  }
}

// Export singleton instance
export const transfersService = new TransfersService();
