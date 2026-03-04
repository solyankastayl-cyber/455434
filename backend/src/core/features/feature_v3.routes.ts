/**
 * V3.0 Pack A - Feature API Routes
 * 
 * Endpoints for accessing V3 features (CEX Pressure, Zones, Corridors)
 */

import type { FastifyInstance } from 'fastify';
import { FeatureMarketModel, FeatureCorridorModel } from './feature.models.js';
import { getCorridorV3Summary } from './corridor_feature_v3.builder.js';
import { runMarketFeatureV3Builder } from './market_feature_v3.builder.js';
import { runCorridorFeatureV3Builder } from './corridor_feature_v3.builder.js';
import { SUPPORTED_NETWORKS, normalizeNetwork } from '../../common/network.types.js';

export async function featureV3Routes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v3/features/market/:network - Get V3 market features for a network
   */
  app.get('/market/:network', async (request, reply) => {
    const params = request.params as { network: string };
    
    let network: string;
    try {
      network = normalizeNetwork(params.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network. Supported: ${SUPPORTED_NETWORKS.join(', ')}`,
      });
    }
    
    // Get latest market features
    const latest = await FeatureMarketModel.findOne(
      { network },
      { _id: 0 }
    )
      .sort({ bucketTs: -1 })
      .lean();
    
    if (!latest) {
      return {
        ok: true,
        data: null,
        message: 'No V3 features computed yet for this network',
      };
    }
    
    return {
      ok: true,
      data: {
        network,
        bucketTs: (latest as any).bucketTs,
        
        // V3 CEX Pressure
        cexPressureV3: (latest as any).cexPressureV3 || null,
        
        // V3 Zones
        zonesV3: (latest as any).zonesV3 || null,
        
        // Legacy fields for compatibility
        cexPressure: (latest as any).cexPressure,
        zones: (latest as any).zones,
        
        meta: (latest as any).meta,
      },
    };
  });

  /**
   * GET /api/v3/features/corridors/:network - Get V3 corridor summary for a network
   */
  app.get('/corridors/:network', async (request, reply) => {
    const params = request.params as { network: string };
    
    let network: string;
    try {
      network = normalizeNetwork(params.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network.`,
      });
    }
    
    const summary = await getCorridorV3Summary(network);
    
    return {
      ok: true,
      data: {
        network,
        ...summary,
      },
    };
  });

  /**
   * GET /api/v3/features/corridors/:network/details - Get detailed V3 corridor features
   */
  app.get('/corridors/:network/details', async (request, reply) => {
    const params = request.params as { network: string };
    const query = request.query as { limit?: string };
    
    let network: string;
    try {
      network = normalizeNetwork(params.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network.`,
      });
    }
    
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    
    // Get latest corridors with V3 features
    const corridors = await FeatureCorridorModel.find(
      { network, 'corridorV3.qualityScore': { $exists: true } },
      { _id: 0 }
    )
      .sort({ bucketTs: -1, 'corridorV3.qualityScore': -1 })
      .limit(limit)
      .lean();
    
    return {
      ok: true,
      data: {
        network,
        count: corridors.length,
        corridors: corridors.map((c: any) => ({
          corridorKey: c.corridorKey,
          bucketTs: c.bucketTs,
          flow: c.flow,
          corridorV3: c.corridorV3,
        })),
      },
    };
  });

  /**
   * GET /api/v3/features/spikes - Get recent CEX spikes across all networks
   */
  app.get('/spikes', async (request, reply) => {
    const query = request.query as { minLevel?: string };
    const minLevel = query.minLevel || 'MEDIUM';
    
    // Find recent spikes
    const since = Math.floor(Date.now() / 1000) - 24 * 60 * 60; // Last 24h
    
    const spikes = await FeatureMarketModel.find(
      {
        bucketTs: { $gte: since },
        'cexPressureV3.spikeLevel': { $in: minLevel === 'HIGH' ? ['HIGH'] : ['MEDIUM', 'HIGH'] },
      },
      { _id: 0, network: 1, bucketTs: 1, cexPressureV3: 1 }
    )
      .sort({ bucketTs: -1 })
      .limit(50)
      .lean();
    
    return {
      ok: true,
      data: {
        count: spikes.length,
        minLevel,
        since: new Date(since * 1000).toISOString(),
        spikes: spikes.map((s: any) => ({
          network: s.network,
          timestamp: new Date(s.bucketTs * 1000).toISOString(),
          level: s.cexPressureV3?.spikeLevel,
          direction: s.cexPressureV3?.spikeDirection,
          pressure_5m: s.cexPressureV3?.pressure_5m,
          pressure_1h: s.cexPressureV3?.pressure_1h,
        })),
      },
    };
  });

  /**
   * POST /api/v3/features/compute - Manually trigger V3 feature computation
   * (Admin only)
   */
  app.post('/compute', async (request, reply) => {
    const body = request.body as { type?: string; network?: string };
    
    const results: any = { market: null, corridors: null };
    
    if (!body.type || body.type === 'market' || body.type === 'all') {
      const marketResults = await runMarketFeatureV3Builder();
      results.market = {
        networks: marketResults.filter(r => r.success).length,
        spikes: marketResults.filter(r => r.cexSpike && r.cexSpike !== 'NONE').length,
        details: marketResults,
      };
    }
    
    if (!body.type || body.type === 'corridors' || body.type === 'all') {
      const corridorResults = await runCorridorFeatureV3Builder();
      results.corridors = {
        networks: corridorResults.filter(r => r.count > 0).length,
        totalCorridors: corridorResults.reduce((sum, r) => sum + r.count, 0),
        details: corridorResults,
      };
    }
    
    return {
      ok: true,
      data: results,
      message: 'V3 features computed successfully',
    };
  });

  /**
   * GET /api/v3/features/status - Get V3 feature computation status
   */
  app.get('/status', async (request, reply) => {
    // Get latest computation times per network
    const latestMarket = await FeatureMarketModel.aggregate([
      { $match: { 'cexPressureV3': { $exists: true } } },
      { $sort: { bucketTs: -1 } },
      {
        $group: {
          _id: '$network',
          lastBucketTs: { $first: '$bucketTs' },
          lastComputedAt: { $first: '$meta.computedAtTs' },
          spikeLevel: { $first: '$cexPressureV3.spikeLevel' },
          zoneQuality: { $first: '$zonesV3.qualityScore' },
        },
      },
    ]);
    
    const latestCorridor = await FeatureCorridorModel.aggregate([
      { $match: { 'corridorV3': { $exists: true } } },
      { $sort: { bucketTs: -1 } },
      {
        $group: {
          _id: '$network',
          lastBucketTs: { $first: '$bucketTs' },
          corridorCount: { $sum: 1 },
        },
      },
    ]);
    
    return {
      ok: true,
      data: {
        market: latestMarket.map((m: any) => ({
          network: m._id,
          lastUpdate: new Date(m.lastComputedAt * 1000).toISOString(),
          currentSpike: m.spikeLevel || 'NONE',
          zoneQuality: m.zoneQuality || 0,
        })),
        corridors: latestCorridor.map((c: any) => ({
          network: c._id,
          corridorCount: c.corridorCount,
          lastBucket: new Date(c.lastBucketTs * 1000).toISOString(),
        })),
        version: 'V3.0.0',
      },
    };
  });

  app.log.info('[V3.0] Feature API routes registered');
}

export default featureV3Routes;
