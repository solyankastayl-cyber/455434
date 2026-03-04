/**
 * Transfers V2 Routes - P0.2 MULTICHAIN
 * 
 * ОБЯЗАТЕЛЬНО: network parameter required
 * 
 * Base path: /api/v2/transfers
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TransferModel } from './transfers.model.js';
import { SUPPORTED_NETWORKS, isValidNetwork, normalizeNetwork } from '../../common/network.types.js';

// ============================================
// SCHEMAS
// ============================================

const NetworkSchema = z.enum(SUPPORTED_NETWORKS as unknown as [string, ...string[]]);
const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/i, 'Invalid address');
const WindowSchema = z.enum(['1h', '24h', '7d', '30d', '90d']).default('7d');

const QuerySchema = z.object({
  network: NetworkSchema,
  address: AddressSchema.optional(),
  direction: z.enum(['in', 'out', 'both']).default('both'),
  transferType: z.enum(['TRANSFER', 'BRIDGE_IN', 'BRIDGE_OUT', 'all']).default('all'),
  window: WindowSchema,
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
});

// ============================================
// HELPERS
// ============================================

function getWindowDate(window: string): Date {
  const now = new Date();
  const hours = {
    '1h': 1,
    '24h': 24,
    '7d': 24 * 7,
    '30d': 24 * 30,
    '90d': 24 * 90,
  }[window] || 24 * 7;
  
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function formatTransferV2(t: any) {
  return {
    id: t._id.toString(),
    txHash: t.txHash,
    blockNumber: t.blockNumber,
    timestamp: t.timestamp,
    from: t.from,
    to: t.to,
    direction: null, // Set by caller relative to subject
    token: t.assetAddress,
    amount: t.amountNormalized,
    amountRaw: t.amountRaw,
    network: t.chain,
    transferType: t.transferType || 'TRANSFER',
    bridgeInfo: t.bridgeInfo || null,
  };
}

// ============================================
// ROUTES
// ============================================

export async function transfersV2Routes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v2/transfers - Query transfers (network REQUIRED)
   */
  app.get('/', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    // Validate network (REQUIRED!)
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required. Supported: ${SUPPORTED_NETWORKS.join(', ')}`,
      });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network "${query.network}". Supported: ${SUPPORTED_NETWORKS.join(', ')}`,
      });
    }
    
    const address = query.address?.toLowerCase();
    const direction = query.direction || 'both';
    const transferType = query.transferType || 'all';
    const window = query.window || '7d';
    const limit = Math.min(parseInt(query.limit || '100', 10), 500);
    
    const since = getWindowDate(window);
    
    // Build query
    const mongoQuery: Record<string, any> = {
      chain: network,
      timestamp: { $gte: since },
    };
    
    if (address) {
      if (direction === 'in') {
        mongoQuery.to = address;
      } else if (direction === 'out') {
        mongoQuery.from = address;
      } else {
        mongoQuery.$or = [{ from: address }, { to: address }];
      }
    }
    
    if (transferType !== 'all') {
      mongoQuery.transferType = transferType;
    }
    
    // Execute query
    const transfers = await TransferModel
      .find(mongoQuery)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    
    const total = await TransferModel.countDocuments(mongoQuery);
    
    // Format with direction relative to address
    const formatted = transfers.map(t => {
      const tf = formatTransferV2(t);
      if (address) {
        tf.direction = t.from === address ? 'OUT' : 'IN';
      }
      return tf;
    });
    
    return {
      ok: true,
      data: {
        transfers: formatted,
        pagination: {
          total,
          limit,
          hasMore: transfers.length === limit,
        },
        meta: {
          network,
          window,
          since: since.toISOString(),
        },
      },
    };
  });

  /**
   * GET /api/v2/transfers/summary - Get transfer stats for address (network REQUIRED)
   */
  app.get('/summary', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    // Validate network
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required.`,
      });
    }
    
    if (!query.address) {
      return reply.status(400).send({
        ok: false,
        error: 'ADDRESS_REQUIRED',
        message: 'Address parameter is required.',
      });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network.`,
      });
    }
    
    const address = query.address.toLowerCase();
    const window = query.window || '7d';
    const since = getWindowDate(window);
    
    // Aggregation pipeline
    const pipeline = [
      {
        $match: {
          chain: network,
          timestamp: { $gte: since },
          $or: [{ from: address }, { to: address }],
        },
      },
      {
        $group: {
          _id: null,
          totalIn: {
            $sum: { $cond: [{ $eq: ['$to', address] }, 1, 0] },
          },
          totalOut: {
            $sum: { $cond: [{ $eq: ['$from', address] }, 1, 0] },
          },
          uniqueCounterparties: {
            $addToSet: {
              $cond: [
                { $eq: ['$from', address] },
                '$to',
                '$from',
              ],
            },
          },
          firstTx: { $min: '$timestamp' },
          lastTx: { $max: '$timestamp' },
        },
      },
      {
        $project: {
          _id: 0,
          totalIn: 1,
          totalOut: 1,
          netFlow: { $subtract: ['$totalIn', '$totalOut'] },
          uniqueCounterparties: { $size: '$uniqueCounterparties' },
          firstTx: 1,
          lastTx: 1,
        },
      },
    ];
    
    const result = await TransferModel.aggregate(pipeline);
    const summary = result[0] || {
      totalIn: 0,
      totalOut: 0,
      netFlow: 0,
      uniqueCounterparties: 0,
      firstTx: null,
      lastTx: null,
    };
    
    return {
      ok: true,
      data: {
        address,
        network,
        window,
        ...summary,
      },
    };
  });

  app.log.info('[TransfersV2] Routes registered with REQUIRED network parameter');
}

export default transfersV2Routes;
