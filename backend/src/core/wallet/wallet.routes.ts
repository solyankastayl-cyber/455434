/**
 * Wallet API - P0.4 MULTICHAIN
 * 
 * Wallet view: balances, transfers, bridges per network
 * NO GRAPH - таблицы и метрики
 * 
 * Base path: /api/v2/wallet
 */
import type { FastifyInstance } from 'fastify';
import { SUPPORTED_NETWORKS, normalizeNetwork, NetworkType } from '../../common/network.types.js';
import { TransferModel } from '../transfers/transfers.model.js';
import { BridgeEventModel } from '../bridges/bridges.routes.js';

// ============================================
// HELPERS
// ============================================

function getWindowDate(window: string): Date {
  const now = new Date();
  const hours: Record<string, number> = {
    '1h': 1,
    '24h': 24,
    '7d': 24 * 7,
    '30d': 24 * 30,
    '90d': 24 * 90,
  };
  return new Date(now.getTime() - (hours[window] || 24 * 7) * 60 * 60 * 1000);
}

interface NetworkSummary {
  network: string;
  transfersIn: number;
  transfersOut: number;
  netFlow: number;
  uniqueCounterparties: number;
  bridgesIn: number;
  bridgesOut: number;
  lastActivity: Date | null;
}

// ============================================
// ROUTES
// ============================================

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v2/wallet/summary - Multi-network wallet summary
   * 
   * Supports: network=all (aggregates all networks)
   */
  app.get('/summary', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.address) {
      return reply.status(400).send({
        ok: false,
        error: 'ADDRESS_REQUIRED',
        message: 'Address parameter is required.',
      });
    }
    
    const address = query.address.toLowerCase();
    const window = query.window || '7d';
    const since = getWindowDate(window);
    
    // If network specified, return single network
    // If network=all or not specified, return all networks
    const networks = query.network && query.network !== 'all' 
      ? [normalizeNetwork(query.network)]
      : SUPPORTED_NETWORKS;
    
    const summaries: NetworkSummary[] = [];
    
    for (const network of networks) {
      // Get transfer stats
      const transferPipeline = [
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
            transfersIn: { $sum: { $cond: [{ $eq: ['$to', address] }, 1, 0] } },
            transfersOut: { $sum: { $cond: [{ $eq: ['$from', address] }, 1, 0] } },
            counterparties: {
              $addToSet: { $cond: [{ $eq: ['$from', address] }, '$to', '$from'] },
            },
            lastActivity: { $max: '$timestamp' },
          },
        },
      ];
      
      const transferResult = await TransferModel.aggregate(transferPipeline);
      const transferStats = transferResult[0] || {
        transfersIn: 0,
        transfersOut: 0,
        counterparties: [],
        lastActivity: null,
      };
      
      // Get bridge stats
      const bridgePipeline = [
        {
          $match: {
            timestamp: { $gte: since },
            $or: [
              { sender: address, fromNetwork: network },
              { recipient: address, toNetwork: network },
            ],
          },
        },
        {
          $group: {
            _id: null,
            bridgesIn: {
              $sum: { $cond: [{ $and: [{ $eq: ['$recipient', address] }, { $eq: ['$toNetwork', network] }] }, 1, 0] },
            },
            bridgesOut: {
              $sum: { $cond: [{ $and: [{ $eq: ['$sender', address] }, { $eq: ['$fromNetwork', network] }] }, 1, 0] },
            },
          },
        },
      ];
      
      const bridgeResult = await BridgeEventModel.aggregate(bridgePipeline);
      const bridgeStats = bridgeResult[0] || { bridgesIn: 0, bridgesOut: 0 };
      
      // Only include networks with activity
      if (transferStats.transfersIn > 0 || transferStats.transfersOut > 0 || bridgeStats.bridgesIn > 0 || bridgeStats.bridgesOut > 0) {
        summaries.push({
          network,
          transfersIn: transferStats.transfersIn,
          transfersOut: transferStats.transfersOut,
          netFlow: transferStats.transfersIn - transferStats.transfersOut,
          uniqueCounterparties: transferStats.counterparties?.length || 0,
          bridgesIn: bridgeStats.bridgesIn,
          bridgesOut: bridgeStats.bridgesOut,
          lastActivity: transferStats.lastActivity,
        });
      }
    }
    
    // Calculate totals
    const totals = summaries.reduce((acc, s) => ({
      transfersIn: acc.transfersIn + s.transfersIn,
      transfersOut: acc.transfersOut + s.transfersOut,
      netFlow: acc.netFlow + s.netFlow,
      bridgesIn: acc.bridgesIn + s.bridgesIn,
      bridgesOut: acc.bridgesOut + s.bridgesOut,
    }), { transfersIn: 0, transfersOut: 0, netFlow: 0, bridgesIn: 0, bridgesOut: 0 });
    
    return {
      ok: true,
      data: {
        address,
        window,
        networks: summaries,
        totals,
        activeNetworks: summaries.map(s => s.network),
      },
    };
  });

  /**
   * GET /api/v2/wallet/timeline - Activity timeline for address (network REQUIRED)
   */
  app.get('/timeline', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required for timeline. Use /summary for multi-network overview.`,
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
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    const since = getWindowDate(window);
    
    // Get transfers
    const transfers = await TransferModel
      .find({
        chain: network,
        timestamp: { $gte: since },
        $or: [{ from: address }, { to: address }],
      })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    
    // Get bridges
    const bridges = await BridgeEventModel
      .find({
        timestamp: { $gte: since },
        $or: [
          { sender: address, fromNetwork: network },
          { recipient: address, toNetwork: network },
        ],
      })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    
    // Merge and sort by timestamp
    const timeline = [
      ...transfers.map(t => ({
        type: 'TRANSFER' as const,
        id: (t as any)._id.toString(),
        timestamp: t.timestamp,
        txHash: t.txHash,
        direction: t.from === address ? 'OUT' : 'IN',
        counterparty: t.from === address ? t.to : t.from,
        token: t.assetAddress,
        amount: t.amountNormalized,
        network,
      })),
      ...bridges.map(b => ({
        type: 'BRIDGE' as const,
        id: (b as any)._id.toString(),
        timestamp: b.timestamp,
        txHash: b.txHash,
        direction: b.sender === address ? 'OUT' : 'IN',
        counterparty: b.sender === address ? b.recipient : b.sender,
        fromNetwork: b.fromNetwork,
        toNetwork: b.toNetwork,
        bridgeName: b.bridgeName,
        token: b.token,
        amount: b.amount,
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
     .slice(0, limit);
    
    return {
      ok: true,
      data: {
        address,
        network,
        window,
        timeline,
        counts: {
          transfers: transfers.length,
          bridges: bridges.length,
        },
      },
    };
  });

  /**
   * GET /api/v2/wallet/counterparties - Top counterparties (network REQUIRED)
   */
  app.get('/counterparties', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
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
    const window = query.window || '30d';
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    const direction = query.direction as 'in' | 'out' | undefined;
    const since = getWindowDate(window);
    
    // Build match query
    const matchQuery: Record<string, any> = {
      chain: network,
      timestamp: { $gte: since },
    };
    
    if (direction === 'in') {
      matchQuery.to = address;
    } else if (direction === 'out') {
      matchQuery.from = address;
    } else {
      matchQuery.$or = [{ from: address }, { to: address }];
    }
    
    // Aggregation for top counterparties
    const pipeline = [
      { $match: matchQuery },
      {
        $group: {
          _id: {
            $cond: [{ $eq: ['$from', address] }, '$to', '$from'],
          },
          txCount: { $sum: 1 },
          firstSeen: { $min: '$timestamp' },
          lastSeen: { $max: '$timestamp' },
          direction: {
            $first: { $cond: [{ $eq: ['$from', address] }, 'OUT', 'IN'] },
          },
        },
      },
      { $sort: { txCount: -1 } },
      { $limit: limit },
    ];
    
    const counterparties = await TransferModel.aggregate(pipeline);
    
    return {
      ok: true,
      data: {
        address,
        network,
        window,
        counterparties: counterparties.map(c => ({
          address: c._id,
          txCount: c.txCount,
          direction: c.direction,
          firstSeen: c.firstSeen,
          lastSeen: c.lastSeen,
        })),
      },
    };
  });

  app.log.info('[WalletV2] Routes registered');
}

export default walletRoutes;
