/**
 * Accumulation/Distribution Zones API - P1.5 MULTICHAIN
 * 
 * Detect clusters of accumulation and distribution activity.
 * Key signal for market analysis.
 * 
 * Base path: /api/v2/zones
 */

import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { SUPPORTED_NETWORKS, normalizeNetwork } from '../../common/network.types.js';
import { TransferModel } from '../transfers/transfers.model.js';
import { ActorScoreV2Model } from '../actors/actors.v2.routes.js';

// ============================================
// ZONE TYPES
// ============================================

type ZoneType = 'ACCUMULATION' | 'DISTRIBUTION' | 'MIXED';
type ZoneStrength = 'STRONG' | 'MODERATE' | 'WEAK';

interface AccumulationZone {
  zoneId: string;
  network: string;
  type: ZoneType;
  strength: ZoneStrength;
  
  // Core addresses in zone
  coreAddresses: string[];
  
  // Flow metrics
  totalInflow: number;
  totalOutflow: number;
  netFlow: number;
  flowRatio: number; // inflow / outflow
  
  // Activity metrics
  totalTxCount: number;
  uniqueParticipants: number;
  avgTxSize: number;
  
  // Time
  firstActivity: Date;
  lastActivity: Date;
  activityDensity: number; // tx per hour
  
  // Confidence
  confidence: number;
  
  computedAt: Date;
}

// ============================================
// ZONE MODEL
// ============================================

const ZoneSchema = new mongoose.Schema<AccumulationZone>({
  zoneId: { type: String, required: true, index: true },
  network: { type: String, required: true, index: true },
  type: { type: String, enum: ['ACCUMULATION', 'DISTRIBUTION', 'MIXED'], required: true },
  strength: { type: String, enum: ['STRONG', 'MODERATE', 'WEAK'], required: true },
  
  coreAddresses: [{ type: String }],
  
  totalInflow: { type: Number, default: 0 },
  totalOutflow: { type: Number, default: 0 },
  netFlow: { type: Number, default: 0 },
  flowRatio: { type: Number, default: 1 },
  
  totalTxCount: { type: Number, default: 0 },
  uniqueParticipants: { type: Number, default: 0 },
  avgTxSize: { type: Number, default: 0 },
  
  firstActivity: { type: Date },
  lastActivity: { type: Date },
  activityDensity: { type: Number, default: 0 },
  
  confidence: { type: Number, default: 0 },
  
  computedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  collection: 'accumulation_zones',
});

ZoneSchema.index({ network: 1, type: 1, strength: -1 });
ZoneSchema.index({ network: 1, netFlow: -1 });

const ZoneModel = mongoose.models.AccumulationZone || 
  mongoose.model<AccumulationZone>('AccumulationZone', ZoneSchema);

// ============================================
// HELPERS
// ============================================

function getWindowDate(window: string): Date {
  const now = new Date();
  const hours: Record<string, number> = {
    '1h': 1,
    '4h': 4,
    '24h': 24,
    '7d': 24 * 7,
    '30d': 24 * 30,
  };
  return new Date(now.getTime() - (hours[window] || 24 * 7) * 60 * 60 * 1000);
}

function classifyZone(
  inflow: number, 
  outflow: number
): { type: ZoneType; strength: ZoneStrength; confidence: number } {
  const total = inflow + outflow;
  if (total === 0) {
    return { type: 'MIXED', strength: 'WEAK', confidence: 0 };
  }
  
  const ratio = inflow / (outflow || 1);
  const netFlow = inflow - outflow;
  const netRatio = Math.abs(netFlow) / total;
  
  let type: ZoneType;
  let strength: ZoneStrength;
  let confidence: number;
  
  if (ratio > 2) {
    // Strong accumulation: inflow >> outflow
    type = 'ACCUMULATION';
    confidence = Math.min(95, 50 + netRatio * 50);
    strength = ratio > 5 ? 'STRONG' : ratio > 3 ? 'MODERATE' : 'WEAK';
  } else if (ratio < 0.5) {
    // Strong distribution: outflow >> inflow
    type = 'DISTRIBUTION';
    confidence = Math.min(95, 50 + netRatio * 50);
    strength = ratio < 0.2 ? 'STRONG' : ratio < 0.33 ? 'MODERATE' : 'WEAK';
  } else {
    // Mixed zone
    type = 'MIXED';
    strength = 'WEAK';
    confidence = 30;
  }
  
  return { type, strength, confidence: Math.round(confidence) };
}

// ============================================
// ROUTES
// ============================================

export async function zonesRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v2/zones - Get accumulation/distribution zones (network REQUIRED)
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
    
    const zoneType = query.type as ZoneType | undefined;
    const minStrength = query.minStrength as ZoneStrength | undefined;
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    
    // Build query
    const mongoQuery: Record<string, any> = { network };
    
    if (zoneType) {
      mongoQuery.type = zoneType;
    }
    
    if (minStrength) {
      const strengthOrder = ['STRONG', 'MODERATE', 'WEAK'];
      const minIndex = strengthOrder.indexOf(minStrength);
      mongoQuery.strength = { $in: strengthOrder.slice(0, minIndex + 1) };
    }
    
    const zones = await ZoneModel
      .find(mongoQuery)
      .sort({ confidence: -1, netFlow: -1 })
      .limit(limit)
      .lean();
    
    const total = await ZoneModel.countDocuments(mongoQuery);
    
    return {
      ok: true,
      data: {
        zones: zones.map(z => ({
          zoneId: z.zoneId,
          type: z.type,
          strength: z.strength,
          coreAddresses: z.coreAddresses,
          netFlow: z.netFlow,
          flowRatio: Math.round(z.flowRatio * 100) / 100,
          totalTxCount: z.totalTxCount,
          uniqueParticipants: z.uniqueParticipants,
          confidence: z.confidence,
          lastActivity: z.lastActivity,
        })),
        pagination: {
          total,
          limit,
          hasMore: zones.length === limit,
        },
        meta: {
          network,
        },
      },
    };
  });

  /**
   * POST /api/v2/zones/detect - Detect zones from current data (network REQUIRED)
   */
  app.post('/detect', async (request, reply) => {
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
    
    const window = body.window || '24h';
    const minTxCount = parseInt(body.minTxCount || '10', 10);
    const since = getWindowDate(window);
    
    // Find addresses with significant activity
    const activityPipeline = [
      {
        $match: {
          chain: network,
          timestamp: { $gte: since },
        },
      },
      {
        $facet: {
          // Inflow aggregation
          inflows: [
            { $group: { _id: '$to', count: { $sum: 1 } } },
            { $match: { count: { $gte: minTxCount } } },
          ],
          // Outflow aggregation
          outflows: [
            { $group: { _id: '$from', count: { $sum: 1 } } },
            { $match: { count: { $gte: minTxCount } } },
          ],
        },
      },
    ];
    
    const activityResult = await TransferModel.aggregate(activityPipeline);
    
    if (!activityResult[0]) {
      return { ok: true, data: { detected: 0, network, window } };
    }
    
    const inflowMap = new Map(activityResult[0].inflows.map((i: any) => [i._id, i.count]));
    const outflowMap = new Map(activityResult[0].outflows.map((o: any) => [o._id, o.count]));
    
    // Combine addresses
    const allAddresses = new Set([...inflowMap.keys(), ...outflowMap.keys()]);
    
    // Classify each address
    const zones: AccumulationZone[] = [];
    let zoneCounter = 0;
    
    for (const address of allAddresses) {
      const inflow = inflowMap.get(address) || 0;
      const outflow = outflowMap.get(address) || 0;
      const total = inflow + outflow;
      
      if (total < minTxCount) continue;
      
      const { type, strength, confidence } = classifyZone(inflow, outflow);
      
      // Skip mixed/weak zones
      if (type === 'MIXED' && strength === 'WEAK') continue;
      
      zones.push({
        zoneId: `zone_${network}_${++zoneCounter}`,
        network,
        type,
        strength,
        coreAddresses: [address],
        totalInflow: inflow,
        totalOutflow: outflow,
        netFlow: inflow - outflow,
        flowRatio: inflow / (outflow || 1),
        totalTxCount: total,
        uniqueParticipants: 1,
        avgTxSize: 0,
        firstActivity: since,
        lastActivity: new Date(),
        activityDensity: total / (parseInt(window) || 24),
        confidence,
        computedAt: new Date(),
      });
    }
    
    // Save zones
    if (zones.length > 0) {
      // Clear old zones for this network
      await ZoneModel.deleteMany({ network });
      await ZoneModel.insertMany(zones);
    }
    
    // Summary
    const accumulationZones = zones.filter(z => z.type === 'ACCUMULATION');
    const distributionZones = zones.filter(z => z.type === 'DISTRIBUTION');
    
    return {
      ok: true,
      data: {
        detected: zones.length,
        network,
        window,
        summary: {
          accumulation: {
            total: accumulationZones.length,
            strong: accumulationZones.filter(z => z.strength === 'STRONG').length,
            moderate: accumulationZones.filter(z => z.strength === 'MODERATE').length,
          },
          distribution: {
            total: distributionZones.length,
            strong: distributionZones.filter(z => z.strength === 'STRONG').length,
            moderate: distributionZones.filter(z => z.strength === 'MODERATE').length,
          },
        },
      },
    };
  });

  /**
   * GET /api/v2/zones/signal - Get market signal from zones (network REQUIRED)
   */
  app.get('/signal', async (request, reply) => {
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
    
    // Get zone counts
    const [accumulationZones, distributionZones] = await Promise.all([
      ZoneModel.find({ network, type: 'ACCUMULATION' }).lean(),
      ZoneModel.find({ network, type: 'DISTRIBUTION' }).lean(),
    ]);
    
    // Calculate signal
    const accStrong = accumulationZones.filter(z => z.strength === 'STRONG').length;
    const accModerate = accumulationZones.filter(z => z.strength === 'MODERATE').length;
    const distStrong = distributionZones.filter(z => z.strength === 'STRONG').length;
    const distModerate = distributionZones.filter(z => z.strength === 'MODERATE').length;
    
    // Weighted score: strong = 3, moderate = 1
    const accScore = accStrong * 3 + accModerate;
    const distScore = distStrong * 3 + distModerate;
    
    const totalScore = accScore + distScore;
    let signal: 'STRONG_ACCUMULATION' | 'ACCUMULATION' | 'NEUTRAL' | 'DISTRIBUTION' | 'STRONG_DISTRIBUTION';
    let signalStrength: number;
    
    if (totalScore === 0) {
      signal = 'NEUTRAL';
      signalStrength = 0;
    } else {
      const ratio = accScore / totalScore;
      signalStrength = Math.abs(ratio - 0.5) * 2 * 100; // 0-100
      
      if (ratio > 0.7) signal = 'STRONG_ACCUMULATION';
      else if (ratio > 0.55) signal = 'ACCUMULATION';
      else if (ratio < 0.3) signal = 'STRONG_DISTRIBUTION';
      else if (ratio < 0.45) signal = 'DISTRIBUTION';
      else signal = 'NEUTRAL';
    }
    
    return {
      ok: true,
      data: {
        network,
        signal,
        signalStrength: Math.round(signalStrength),
        breakdown: {
          accumulation: {
            total: accumulationZones.length,
            strong: accStrong,
            moderate: accModerate,
            score: accScore,
          },
          distribution: {
            total: distributionZones.length,
            strong: distStrong,
            moderate: distModerate,
            score: distScore,
          },
        },
        interpretation: signal === 'STRONG_ACCUMULATION' 
          ? 'Strong buying pressure detected - smart money is accumulating'
          : signal === 'ACCUMULATION'
          ? 'Moderate accumulation activity - potential buying interest'
          : signal === 'STRONG_DISTRIBUTION'
          ? 'Strong selling pressure detected - smart money is distributing'
          : signal === 'DISTRIBUTION'
          ? 'Moderate distribution activity - potential selling interest'
          : 'No clear accumulation or distribution pattern',
      },
    };
  });

  /**
   * GET /api/v2/zones/:address - Check if address is in a zone
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
    
    const zone = await ZoneModel.findOne({
      network,
      coreAddresses: address,
    }).lean();
    
    if (!zone) {
      return {
        ok: true,
        data: {
          address,
          network,
          inZone: false,
          zone: null,
        },
      };
    }
    
    return {
      ok: true,
      data: {
        address,
        network,
        inZone: true,
        zone: {
          zoneId: zone.zoneId,
          type: zone.type,
          strength: zone.strength,
          netFlow: zone.netFlow,
          confidence: zone.confidence,
        },
      },
    };
  });

  app.log.info('[P1.5] Zones (Accumulation/Distribution) routes registered');
}

export default zonesRoutes;
export { ZoneModel };
