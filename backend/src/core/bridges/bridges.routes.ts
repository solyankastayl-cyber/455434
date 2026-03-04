/**
 * Bridges API - P0.3 MULTICHAIN
 * 
 * Bridge events as separate entity (NOT graph!)
 * 
 * ОБЯЗАТЕЛЬНО: network parameter required
 * 
 * Base path: /api/v2/bridges
 */
import type { FastifyInstance } from 'fastify';
import mongoose, { Schema } from 'mongoose';
import { SUPPORTED_NETWORKS, normalizeNetwork } from '../../common/network.types.js';

// ============================================
// BRIDGE REGISTRY (Known bridges)
// ============================================

interface BridgeConfig {
  name: string;
  addresses: Record<string, string[]>; // network -> contract addresses
  targetNetworks: string[];
}

const BRIDGE_REGISTRY: BridgeConfig[] = [
  {
    name: 'Arbitrum Bridge',
    addresses: {
      ethereum: ['0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a'],
      arbitrum: ['0x0000000000000000000000000000000000000064'],
    },
    targetNetworks: ['arbitrum'],
  },
  {
    name: 'Optimism Bridge',
    addresses: {
      ethereum: ['0x99c9fc46f92e8a1c0dec1b1747d010903e884be1'],
      optimism: ['0x4200000000000000000000000000000000000010'],
    },
    targetNetworks: ['optimism'],
  },
  {
    name: 'Base Bridge',
    addresses: {
      ethereum: ['0x49048044d57e1c92a77f79988d21fa8faf74e97e'],
      base: ['0x4200000000000000000000000000000000000010'],
    },
    targetNetworks: ['base'],
  },
  {
    name: 'Polygon Bridge',
    addresses: {
      ethereum: ['0xa0c68c638235ee32657e8f720a23cec1bfc77c77'],
      polygon: ['0x0000000000000000000000000000000000001001'],
    },
    targetNetworks: ['polygon'],
  },
  {
    name: 'zkSync Bridge',
    addresses: {
      ethereum: ['0x32400084c286cf3e17e7b677ea9583e60a000324'],
    },
    targetNetworks: ['zksync'],
  },
  {
    name: 'Across Protocol',
    addresses: {
      ethereum: ['0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5'],
      arbitrum: ['0xe35e9842fceaca96570b734083f4a58e8f7c5f2a'],
      optimism: ['0x6f26bf09b1c792e3228e5467807a900a503c0281'],
      polygon: ['0x69b5c72837769ef1e7c164abc6515dcff217f920'],
      base: ['0x09aea4b2242abc8bb4bb78d537a67a245a7bec64'],
    },
    targetNetworks: ['ethereum', 'arbitrum', 'optimism', 'polygon', 'base'],
  },
  {
    name: 'Stargate',
    addresses: {
      ethereum: ['0x8731d54e9d02c286767d56ac03e8037c07e01e98'],
      arbitrum: ['0x53bf833a5d6c4dda888f69c22c88c9f356a41614'],
      optimism: ['0xb0d502e938ed5f4df2e681fe6e419ff29631d62b'],
      polygon: ['0x45a01e4e04f14f7a4a6702c74187c5f6222033cd'],
      bnb: ['0x4a364f8c717caad9a442737eb7b8a55cc6cf18d8'],
    },
    targetNetworks: ['ethereum', 'arbitrum', 'optimism', 'polygon', 'bnb'],
  },
];

// ============================================
// BRIDGE EVENT MODEL
// ============================================

interface IBridgeEvent {
  txHash: string;
  blockNumber: number;
  timestamp: Date;
  fromNetwork: string;
  toNetwork: string;
  bridgeName: string;
  sender: string;
  recipient: string;
  token: string;
  amount: string;
  amountUsd: number | null;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
}

const BridgeEventSchema = new Schema<IBridgeEvent>({
  txHash: { type: String, required: true, index: true },
  blockNumber: { type: Number, required: true },
  timestamp: { type: Date, required: true, index: true },
  fromNetwork: { type: String, required: true, index: true },
  toNetwork: { type: String, required: true, index: true },
  bridgeName: { type: String, required: true },
  sender: { type: String, required: true, lowercase: true, index: true },
  recipient: { type: String, required: true, lowercase: true, index: true },
  token: { type: String, required: true, lowercase: true },
  amount: { type: String, required: true },
  amountUsd: { type: Number, default: null },
  status: { type: String, enum: ['PENDING', 'COMPLETED', 'FAILED'], default: 'COMPLETED' },
}, {
  timestamps: true,
  collection: 'bridge_events',
});

BridgeEventSchema.index({ sender: 1, timestamp: -1 });
BridgeEventSchema.index({ recipient: 1, timestamp: -1 });
BridgeEventSchema.index({ fromNetwork: 1, toNetwork: 1, timestamp: -1 });

const BridgeEventModel = mongoose.models.BridgeEvent || mongoose.model<IBridgeEvent>('BridgeEvent', BridgeEventSchema);

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

function isBridgeAddress(address: string, network: string): BridgeConfig | null {
  const lower = address.toLowerCase();
  for (const bridge of BRIDGE_REGISTRY) {
    const networkAddresses = bridge.addresses[network] || [];
    if (networkAddresses.some(a => a.toLowerCase() === lower)) {
      return bridge;
    }
  }
  return null;
}

// ============================================
// ROUTES
// ============================================

export async function bridgesRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v2/bridges - Get bridge history for address (network REQUIRED)
   */
  app.get('/', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    // Validate network
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
    
    const address = query.address?.toLowerCase();
    const window = query.window || '90d';
    const limit = Math.min(parseInt(query.limit || '100', 10), 500);
    const direction = query.direction; // 'in' | 'out' | undefined (both)
    
    const since = getWindowDate(window);
    
    // Build query
    const mongoQuery: Record<string, any> = {
      timestamp: { $gte: since },
      $or: [
        { fromNetwork: network },
        { toNetwork: network },
      ],
    };
    
    if (address) {
      if (direction === 'in') {
        mongoQuery.recipient = address;
        mongoQuery.toNetwork = network;
        delete mongoQuery.$or;
      } else if (direction === 'out') {
        mongoQuery.sender = address;
        mongoQuery.fromNetwork = network;
        delete mongoQuery.$or;
      } else {
        mongoQuery.$and = [
          { $or: [{ sender: address }, { recipient: address }] },
        ];
      }
    }
    
    const events = await BridgeEventModel
      .find(mongoQuery)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    
    const total = await BridgeEventModel.countDocuments(mongoQuery);
    
    return {
      ok: true,
      data: {
        bridges: events.map(e => ({
          id: (e as any)._id.toString(),
          txHash: e.txHash,
          timestamp: e.timestamp,
          fromNetwork: e.fromNetwork,
          toNetwork: e.toNetwork,
          bridgeName: e.bridgeName,
          sender: e.sender,
          recipient: e.recipient,
          token: e.token,
          amount: e.amount,
          amountUsd: e.amountUsd,
          status: e.status,
          direction: address ? (e.sender === address ? 'OUT' : 'IN') : null,
        })),
        pagination: {
          total,
          limit,
          hasMore: events.length === limit,
        },
        meta: {
          network,
          window,
        },
      },
    };
  });

  /**
   * GET /api/v2/bridges/registry - Get known bridges
   */
  app.get('/registry', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const network = query.network ? normalizeNetwork(query.network) : null;
    
    const bridges = BRIDGE_REGISTRY.map(b => ({
      name: b.name,
      addresses: network ? (b.addresses[network] || []) : b.addresses,
      targetNetworks: b.targetNetworks,
    }));
    
    return {
      ok: true,
      data: {
        bridges,
        networks: SUPPORTED_NETWORKS,
      },
    };
  });

  /**
   * GET /api/v2/bridges/stats - Bridge statistics (network REQUIRED)
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
    const since = getWindowDate(window);
    
    // Aggregation for bridge stats
    const pipeline = [
      {
        $match: {
          timestamp: { $gte: since },
          $or: [{ fromNetwork: network }, { toNetwork: network }],
        },
      },
      {
        $group: {
          _id: {
            bridge: '$bridgeName',
            direction: {
              $cond: [{ $eq: ['$fromNetwork', network] }, 'OUT', 'IN'],
            },
          },
          count: { $sum: 1 },
          totalUsd: { $sum: { $ifNull: ['$amountUsd', 0] } },
        },
      },
      {
        $group: {
          _id: '$_id.bridge',
          directions: {
            $push: {
              direction: '$_id.direction',
              count: '$count',
              totalUsd: '$totalUsd',
            },
          },
          totalCount: { $sum: '$count' },
          totalUsd: { $sum: '$totalUsd' },
        },
      },
      { $sort: { totalUsd: -1 } },
    ];
    
    const stats = await BridgeEventModel.aggregate(pipeline);
    
    // Calculate network-level totals
    const totalIn = stats.reduce((sum, s) => {
      const inDir = s.directions.find((d: any) => d.direction === 'IN');
      return sum + (inDir?.totalUsd || 0);
    }, 0);
    
    const totalOut = stats.reduce((sum, s) => {
      const outDir = s.directions.find((d: any) => d.direction === 'OUT');
      return sum + (outDir?.totalUsd || 0);
    }, 0);
    
    return {
      ok: true,
      data: {
        network,
        window,
        summary: {
          totalIn,
          totalOut,
          netFlow: totalIn - totalOut,
          bridgeCount: stats.length,
        },
        byBridge: stats.map(s => ({
          bridge: s._id,
          totalCount: s.totalCount,
          totalUsd: s.totalUsd,
          in: s.directions.find((d: any) => d.direction === 'IN') || { count: 0, totalUsd: 0 },
          out: s.directions.find((d: any) => d.direction === 'OUT') || { count: 0, totalUsd: 0 },
        })),
      },
    };
  });

  app.log.info('[BridgesV2] Routes registered with REQUIRED network parameter');
}

export default bridgesRoutes;
export { BridgeEventModel, BRIDGE_REGISTRY, isBridgeAddress };
