/**
 * Relations V2 API - P1.2 MULTICHAIN
 * 
 * Network-aware relations and corridor analysis.
 * 
 * Base path: /api/v2/relations
 */

import type { FastifyInstance } from 'fastify';
import { SUPPORTED_NETWORKS, normalizeNetwork } from '../../common/network.types.js';
import { RelationModel } from './relations.model.js';
import { TransferModel } from '../transfers/transfers.model.js';

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

interface CorridorSummary {
  from: string;
  to: string;
  network: string;
  window: string;
  totalTxCount: number;
  totalVolume: number;
  avgTxSize: number;
  firstSeen: Date | null;
  lastSeen: Date | null;
  densityScore: number;
  direction: 'OUTBOUND' | 'INBOUND' | 'BIDIRECTIONAL';
}

// ============================================
// ROUTES
// ============================================

export async function relationsV2Routes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v2/relations - Get top relations (network REQUIRED)
   */
  app.get('/', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
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
        message: `Invalid network.`,
      });
    }
    
    const window = query.window || '7d';
    const minDensity = parseFloat(query.minDensity || '0');
    const limit = Math.min(parseInt(query.limit || '100', 10), 500);
    const sortBy = query.sortBy || 'densityScore';
    
    const relations = await RelationModel
      .find({
        chain: network,
        window,
        densityScore: { $gte: minDensity },
      })
      .sort({ [sortBy]: -1 })
      .limit(limit)
      .lean();
    
    const total = await RelationModel.countDocuments({
      chain: network,
      window,
      densityScore: { $gte: minDensity },
    });
    
    return {
      ok: true,
      data: {
        relations: relations.map(r => ({
          id: (r as any)._id.toString(),
          from: r.from,
          to: r.to,
          network: r.chain,
          window: r.window,
          interactionCount: r.interactionCount,
          volumeRaw: r.volumeRaw,
          densityScore: r.densityScore,
          direction: r.direction,
          firstSeenAt: r.firstSeenAt,
          lastSeenAt: r.lastSeenAt,
        })),
        pagination: {
          total,
          limit,
          hasMore: relations.length === limit,
        },
        meta: {
          network,
          window,
          minDensity,
        },
      },
    };
  });

  /**
   * GET /api/v2/relations/corridors - Get top corridors (aggregated pairs)
   */
  app.get('/corridors', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required.`,
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
    
    const window = query.window || '7d';
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    const since = getWindowDate(window);
    
    // Aggregate corridors from transfers
    const pipeline = [
      {
        $match: {
          chain: network,
          timestamp: { $gte: since },
        },
      },
      {
        $group: {
          _id: {
            // Normalize pair order for bidirectional
            pair: {
              $cond: [
                { $lt: ['$from', '$to'] },
                { a: '$from', b: '$to' },
                { a: '$to', b: '$from' },
              ],
            },
          },
          totalTxCount: { $sum: 1 },
          fromToCount: {
            $sum: { $cond: [{ $lt: ['$from', '$to'] }, 1, 0] },
          },
          toFromCount: {
            $sum: { $cond: [{ $gte: ['$from', '$to'] }, 1, 0] },
          },
          firstSeen: { $min: '$timestamp' },
          lastSeen: { $max: '$timestamp' },
        },
      },
      {
        $project: {
          _id: 0,
          addressA: '$_id.pair.a',
          addressB: '$_id.pair.b',
          totalTxCount: 1,
          fromToCount: 1,
          toFromCount: 1,
          firstSeen: 1,
          lastSeen: 1,
          // Bidirectional if both directions have significant traffic
          isBidirectional: {
            $and: [
              { $gte: ['$fromToCount', { $multiply: ['$totalTxCount', 0.2] }] },
              { $gte: ['$toFromCount', { $multiply: ['$totalTxCount', 0.2] }] },
            ],
          },
        },
      },
      { $sort: { totalTxCount: -1 } },
      { $limit: limit },
    ];
    
    const corridors = await TransferModel.aggregate(pipeline);
    
    return {
      ok: true,
      data: {
        corridors: corridors.map(c => ({
          addressA: c.addressA,
          addressB: c.addressB,
          totalTxCount: c.totalTxCount,
          aToB: c.fromToCount,
          bToA: c.toFromCount,
          direction: c.isBidirectional ? 'BIDIRECTIONAL' : (c.fromToCount > c.toFromCount ? 'A_TO_B' : 'B_TO_A'),
          firstSeen: c.firstSeen,
          lastSeen: c.lastSeen,
        })),
        meta: {
          network,
          window,
          count: corridors.length,
        },
      },
    };
  });

  /**
   * GET /api/v2/relations/corridor/:from/:to - Get specific corridor detail
   */
  app.get('/corridor/:from/:to', async (request, reply) => {
    const params = request.params as { from: string; to: string };
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required.`,
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
    
    const from = params.from.toLowerCase();
    const to = params.to.toLowerCase();
    const window = query.window || '7d';
    const since = getWindowDate(window);
    
    // Get transfers in both directions
    const [fromToTransfers, toFromTransfers] = await Promise.all([
      TransferModel.find({
        chain: network,
        timestamp: { $gte: since },
        from,
        to,
      }).sort({ timestamp: -1 }).limit(50).lean(),
      TransferModel.find({
        chain: network,
        timestamp: { $gte: since },
        from: to,
        to: from,
      }).sort({ timestamp: -1 }).limit(50).lean(),
    ]);
    
    // Get aggregated stats
    const statsPipeline = [
      {
        $match: {
          chain: network,
          timestamp: { $gte: since },
          $or: [
            { from, to },
            { from: to, to: from },
          ],
        },
      },
      {
        $group: {
          _id: { from: '$from', to: '$to' },
          count: { $sum: 1 },
          firstSeen: { $min: '$timestamp' },
          lastSeen: { $max: '$timestamp' },
        },
      },
    ];
    
    const stats = await TransferModel.aggregate(statsPipeline);
    
    const fromToStats = stats.find(s => s._id.from === from && s._id.to === to) || { count: 0 };
    const toFromStats = stats.find(s => s._id.from === to && s._id.to === from) || { count: 0 };
    
    const totalCount = fromToStats.count + toFromStats.count;
    const isBidirectional = fromToStats.count > 0 && toFromStats.count > 0;
    
    return {
      ok: true,
      data: {
        corridor: {
          from,
          to,
          network,
          window,
        },
        summary: {
          totalTxCount: totalCount,
          fromToCount: fromToStats.count,
          toFromCount: toFromStats.count,
          direction: isBidirectional ? 'BIDIRECTIONAL' : (fromToStats.count > 0 ? 'FROM_TO' : 'TO_FROM'),
          firstSeen: fromToStats.firstSeen || toFromStats.firstSeen,
          lastSeen: fromToStats.lastSeen || toFromStats.lastSeen,
        },
        recentTransfers: {
          fromTo: fromToTransfers.slice(0, 10).map(t => ({
            txHash: t.txHash,
            timestamp: t.timestamp,
            amount: t.amountNormalized,
            token: t.assetAddress,
          })),
          toFrom: toFromTransfers.slice(0, 10).map(t => ({
            txHash: t.txHash,
            timestamp: t.timestamp,
            amount: t.amountNormalized,
            token: t.assetAddress,
          })),
        },
      },
    };
  });

  /**
   * GET /api/v2/relations/address/:address - Get relations for address
   */
  app.get('/address/:address', async (request, reply) => {
    const params = request.params as { address: string };
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required.`,
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
    
    const address = params.address.toLowerCase();
    const window = query.window || '7d';
    const direction = query.direction as 'in' | 'out' | 'both' || 'both';
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    
    // Build query
    const mongoQuery: Record<string, any> = {
      chain: network,
      window,
    };
    
    if (direction === 'in') {
      mongoQuery.to = address;
    } else if (direction === 'out') {
      mongoQuery.from = address;
    } else {
      mongoQuery.$or = [{ from: address }, { to: address }];
    }
    
    const relations = await RelationModel
      .find(mongoQuery)
      .sort({ densityScore: -1 })
      .limit(limit)
      .lean();
    
    // Calculate summary
    const inbound = relations.filter(r => r.to === address);
    const outbound = relations.filter(r => r.from === address);
    
    return {
      ok: true,
      data: {
        address,
        network,
        window,
        summary: {
          totalRelations: relations.length,
          inboundCount: inbound.length,
          outboundCount: outbound.length,
          totalInteractions: relations.reduce((sum, r) => sum + r.interactionCount, 0),
          avgDensity: relations.length > 0 
            ? Math.round(relations.reduce((sum, r) => sum + r.densityScore, 0) / relations.length * 100) / 100
            : 0,
        },
        relations: relations.map(r => ({
          id: (r as any)._id.toString(),
          counterparty: r.from === address ? r.to : r.from,
          direction: r.from === address ? 'OUT' : 'IN',
          interactionCount: r.interactionCount,
          densityScore: r.densityScore,
          lastSeenAt: r.lastSeenAt,
        })),
      },
    };
  });

  /**
   * GET /api/v2/relations/stats - Relation statistics (network REQUIRED)
   */
  app.get('/stats', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required.`,
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
    
    const window = query.window || '7d';
    
    // Aggregate stats
    const pipeline = [
      {
        $match: { chain: network, window },
      },
      {
        $group: {
          _id: null,
          totalRelations: { $sum: 1 },
          totalInteractions: { $sum: '$interactionCount' },
          avgDensity: { $avg: '$densityScore' },
          maxDensity: { $max: '$densityScore' },
          uniqueAddresses: { $addToSet: '$from' },
        },
      },
    ];
    
    const result = await RelationModel.aggregate(pipeline);
    const stats = result[0] || {
      totalRelations: 0,
      totalInteractions: 0,
      avgDensity: 0,
      maxDensity: 0,
      uniqueAddresses: [],
    };
    
    // Get density distribution
    const densityBuckets = await RelationModel.aggregate([
      { $match: { chain: network, window } },
      {
        $bucket: {
          groupBy: '$densityScore',
          boundaries: [0, 1, 5, 10, 50, 100, 500, 1000, Infinity],
          default: 'high',
          output: { count: { $sum: 1 } },
        },
      },
    ]);
    
    return {
      ok: true,
      data: {
        network,
        window,
        totalRelations: stats.totalRelations,
        totalInteractions: stats.totalInteractions,
        uniqueAddresses: stats.uniqueAddresses?.length || 0,
        avgDensity: Math.round(stats.avgDensity * 100) / 100,
        maxDensity: Math.round(stats.maxDensity * 100) / 100,
        densityDistribution: densityBuckets.map(b => ({
          bucket: b._id,
          count: b.count,
        })),
      },
    };
  });

  app.log.info('[P1.2] Relations V2 routes registered with REQUIRED network parameter');
}

export default relationsV2Routes;
