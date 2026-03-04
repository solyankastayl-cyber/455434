/**
 * Actors V2 API - P1.1 MULTICHAIN
 * 
 * Network-aware actor queries and aggregation.
 * 
 * Base path: /api/v2/actors
 */

import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { SUPPORTED_NETWORKS, normalizeNetwork } from '../../common/network.types.js';
import { ActorModel } from './actor.model.js';
import { TransferModel } from '../transfers/transfers.model.js';
import { RelationModel } from '../relations/relations.model.js';

// ============================================
// ACTOR SCORES MODEL (Network-aware)
// ============================================

interface IActorScore {
  actorId: string;
  network: string;
  window: string;
  
  // Flow metrics
  inflowCount: number;
  outflowCount: number;
  inflowVolume: number;
  outflowVolume: number;
  netFlow: number;
  
  // Participation metrics
  uniqueCounterparties: number;
  transactionCount: number;
  avgTxSize: number;
  
  // Flow role
  flowRole: 'ACCUMULATOR' | 'DISTRIBUTOR' | 'ROUTER' | 'INACTIVE';
  flowRoleConfidence: number;
  
  // Time
  firstActivity: Date | null;
  lastActivity: Date | null;
  
  computedAt: Date;
}

const ActorScoreSchema = new mongoose.Schema<IActorScore>({
  actorId: { type: String, required: true, index: true },
  network: { type: String, required: true, index: true },
  window: { type: String, required: true },
  
  inflowCount: { type: Number, default: 0 },
  outflowCount: { type: Number, default: 0 },
  inflowVolume: { type: Number, default: 0 },
  outflowVolume: { type: Number, default: 0 },
  netFlow: { type: Number, default: 0 },
  
  uniqueCounterparties: { type: Number, default: 0 },
  transactionCount: { type: Number, default: 0 },
  avgTxSize: { type: Number, default: 0 },
  
  flowRole: { 
    type: String, 
    enum: ['ACCUMULATOR', 'DISTRIBUTOR', 'ROUTER', 'INACTIVE'],
    default: 'INACTIVE'
  },
  flowRoleConfidence: { type: Number, default: 0 },
  
  firstActivity: { type: Date, default: null },
  lastActivity: { type: Date, default: null },
  
  computedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  collection: 'actor_scores_v2',
});

ActorScoreSchema.index({ network: 1, actorId: 1, window: 1 }, { unique: true });
ActorScoreSchema.index({ network: 1, flowRole: 1, netFlow: -1 });

const ActorScoreV2Model = mongoose.models.ActorScoreV2 || 
  mongoose.model<IActorScore>('ActorScoreV2', ActorScoreSchema);

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

function determineFlowRole(
  inflowCount: number, 
  outflowCount: number,
  netFlow: number
): { role: 'ACCUMULATOR' | 'DISTRIBUTOR' | 'ROUTER' | 'INACTIVE'; confidence: number } {
  const total = inflowCount + outflowCount;
  
  if (total === 0) {
    return { role: 'INACTIVE', confidence: 100 };
  }
  
  const inflowRatio = inflowCount / total;
  const outflowRatio = outflowCount / total;
  
  // Router: balanced in/out (40-60% each side)
  if (inflowRatio >= 0.4 && inflowRatio <= 0.6) {
    return { role: 'ROUTER', confidence: Math.round((1 - Math.abs(inflowRatio - 0.5) * 2) * 100) };
  }
  
  // Accumulator: mostly inflow
  if (inflowRatio > 0.6) {
    return { role: 'ACCUMULATOR', confidence: Math.round(inflowRatio * 100) };
  }
  
  // Distributor: mostly outflow
  return { role: 'DISTRIBUTOR', confidence: Math.round(outflowRatio * 100) };
}

// ============================================
// ROUTES
// ============================================

export async function actorsV2Routes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v2/actors - List actors with network filter (network REQUIRED)
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
    const flowRole = query.flowRole; // ACCUMULATOR | DISTRIBUTOR | ROUTER
    const minActivity = parseInt(query.minActivity || '1', 10);
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    const sortBy = query.sortBy || 'netFlow'; // netFlow | transactionCount | uniqueCounterparties
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    
    // Build query
    const mongoQuery: Record<string, any> = {
      network,
      window,
      transactionCount: { $gte: minActivity },
    };
    
    if (flowRole) {
      mongoQuery.flowRole = flowRole;
    }
    
    const scores = await ActorScoreV2Model
      .find(mongoQuery)
      .sort({ [sortBy]: sortOrder })
      .limit(limit)
      .lean();
    
    const total = await ActorScoreV2Model.countDocuments(mongoQuery);
    
    // Enrich with actor names
    const actorIds = scores.map(s => s.actorId);
    const actors = await ActorModel.find({ id: { $in: actorIds } }).lean();
    const actorMap = new Map(actors.map(a => [a.id, a]));
    
    const enriched = scores.map(s => {
      const actor = actorMap.get(s.actorId);
      return {
        ...s,
        _id: undefined,
        actorName: actor?.name || s.actorId,
        actorType: actor?.type || 'unknown',
      };
    });
    
    return {
      ok: true,
      data: {
        actors: enriched,
        pagination: {
          total,
          limit,
          hasMore: scores.length === limit,
        },
        meta: {
          network,
          window,
        },
      },
    };
  });

  /**
   * GET /api/v2/actors/compute - Compute actor scores for network (network REQUIRED)
   */
  app.post('/compute', async (request, reply) => {
    const body = request.body as Record<string, string>;
    
    if (!body.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required.`,
      });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(body.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network.`,
      });
    }
    
    const window = body.window || '7d';
    const since = getWindowDate(window);
    
    // Get all active addresses from transfers
    const addressPipeline = [
      {
        $match: {
          chain: network,
          timestamp: { $gte: since },
        },
      },
      {
        $group: {
          _id: null,
          fromAddrs: { $addToSet: '$from' },
          toAddrs: { $addToSet: '$to' },
        },
      },
    ];
    
    const addressResult = await TransferModel.aggregate(addressPipeline);
    if (!addressResult[0]) {
      return { ok: true, data: { computed: 0, network, window } };
    }
    
    const allAddresses = new Set([
      ...addressResult[0].fromAddrs,
      ...addressResult[0].toAddrs,
    ]);
    
    // Compute scores for each address
    let computed = 0;
    const batchSize = 100;
    const addressArray = Array.from(allAddresses);
    
    for (let i = 0; i < addressArray.length; i += batchSize) {
      const batch = addressArray.slice(i, i + batchSize);
      const ops: any[] = [];
      
      for (const address of batch) {
        // Aggregate inflow
        const inflowPipeline = [
          {
            $match: {
              chain: network,
              timestamp: { $gte: since },
              to: address,
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              counterparties: { $addToSet: '$from' },
              firstActivity: { $min: '$timestamp' },
              lastActivity: { $max: '$timestamp' },
            },
          },
        ];
        
        // Aggregate outflow
        const outflowPipeline = [
          {
            $match: {
              chain: network,
              timestamp: { $gte: since },
              from: address,
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              counterparties: { $addToSet: '$to' },
            },
          },
        ];
        
        const [inflowResult, outflowResult] = await Promise.all([
          TransferModel.aggregate(inflowPipeline),
          TransferModel.aggregate(outflowPipeline),
        ]);
        
        const inflow = inflowResult[0] || { count: 0, counterparties: [] };
        const outflow = outflowResult[0] || { count: 0, counterparties: [] };
        
        const uniqueCps = new Set([...inflow.counterparties, ...outflow.counterparties]);
        const { role, confidence } = determineFlowRole(inflow.count, outflow.count, inflow.count - outflow.count);
        
        ops.push({
          updateOne: {
            filter: { actorId: address, network, window },
            update: {
              $set: {
                inflowCount: inflow.count,
                outflowCount: outflow.count,
                netFlow: inflow.count - outflow.count,
                transactionCount: inflow.count + outflow.count,
                uniqueCounterparties: uniqueCps.size,
                flowRole: role,
                flowRoleConfidence: confidence,
                firstActivity: inflow.firstActivity || null,
                lastActivity: inflow.lastActivity || null,
                computedAt: new Date(),
              },
            },
            upsert: true,
          },
        });
      }
      
      if (ops.length > 0) {
        await ActorScoreV2Model.bulkWrite(ops);
        computed += ops.length;
      }
    }
    
    return {
      ok: true,
      data: {
        computed,
        network,
        window,
        totalAddresses: allAddresses.size,
      },
    };
  });

  /**
   * GET /api/v2/actors/:address - Get actor detail (network REQUIRED)
   */
  app.get('/:address', async (request, reply) => {
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
    
    // Get score
    const score = await ActorScoreV2Model.findOne({ actorId: address, network, window }).lean();
    
    // Get actor info if exists
    const actor = await ActorModel.findOne({ addresses: address }).lean();
    
    if (!score && !actor) {
      return reply.status(404).send({
        ok: false,
        error: 'ACTOR_NOT_FOUND',
        message: `No data found for address ${address} on ${network}`,
      });
    }
    
    return {
      ok: true,
      data: {
        address,
        network,
        window,
        actor: actor ? {
          id: actor.id,
          name: actor.name,
          type: actor.type,
          sourceLevel: actor.sourceLevel,
        } : null,
        score: score ? {
          inflowCount: score.inflowCount,
          outflowCount: score.outflowCount,
          netFlow: score.netFlow,
          transactionCount: score.transactionCount,
          uniqueCounterparties: score.uniqueCounterparties,
          flowRole: score.flowRole,
          flowRoleConfidence: score.flowRoleConfidence,
          firstActivity: score.firstActivity,
          lastActivity: score.lastActivity,
          computedAt: score.computedAt,
        } : null,
      },
    };
  });

  /**
   * GET /api/v2/actors/stats/summary - Actor statistics by network
   */
  app.get('/stats/summary', async (request, reply) => {
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
    
    // Aggregate by flow role
    const pipeline = [
      {
        $match: { network, window },
      },
      {
        $group: {
          _id: '$flowRole',
          count: { $sum: 1 },
          avgNetFlow: { $avg: '$netFlow' },
          avgTxCount: { $avg: '$transactionCount' },
        },
      },
    ];
    
    const roleStats = await ActorScoreV2Model.aggregate(pipeline);
    
    const total = roleStats.reduce((sum, r) => sum + r.count, 0);
    
    return {
      ok: true,
      data: {
        network,
        window,
        total,
        byFlowRole: roleStats.map(r => ({
          role: r._id,
          count: r.count,
          percentage: Math.round((r.count / total) * 100),
          avgNetFlow: Math.round(r.avgNetFlow),
          avgTxCount: Math.round(r.avgTxCount),
        })),
      },
    };
  });

  app.log.info('[P1.1] Actors V2 routes registered with REQUIRED network parameter');
}

export default actorsV2Routes;
export { ActorScoreV2Model };
