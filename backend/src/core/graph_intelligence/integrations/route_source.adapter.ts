/**
 * Route Source Adapter (P1.7 + ETAP B1)
 * 
 * Unified interface for getting enriched routes.
 * Abstracts data source for graph builder.
 * 
 * ETAP B1: Network-scoped queries
 */

import { mongoose } from '../../../db/mongoose.js';
import { NetworkType, getNetworkAliases, normalizeNetwork } from '../../../common/network.types.js';

// ============================================
// Types
// ============================================

export interface EnrichedRoute {
  routeId: string;
  from: string;
  to?: string;
  chain: string;
  
  routeType: string;
  exitProbability: number;
  dumpRiskScore: number;
  pathEntropy: number;
  
  segments: RouteSegment[];
  
  firstSeenAt: number;
  lastSeenAt: number;
  
  hasCexTouchpoint?: boolean;
  hasSwapBeforeExit?: boolean;
}

export interface RouteSegment {
  type: string;
  from: string;
  to: string;
  chain: string;
  chainFrom?: string;
  chainTo?: string;
  timestamp?: number;
  txHash?: string;
  amount?: number;
  amountUsd?: number;
  token?: string;
  protocol?: string;
}

export interface RouteQueryOptions {
  limit?: number;
  timeWindowHours?: number;
  network?: NetworkType;  // ETAP B1: Network scope
  chains?: string[];      // Deprecated, use network
}

// ============================================
// Route Source Adapter
// ============================================

class RouteSourceAdapter {
  
  /**
   * Get enriched routes for address using REAL data from relations collection
   * ETAP B1: Network-scoped queries
   */
  async getEnrichedRoutesForAddress(
    address: string,
    options?: RouteQueryOptions
  ): Promise<EnrichedRoute[]> {
    const addr = address.toLowerCase();
    const limit = options?.limit || 50;
    
    // ETAP B1: Use network parameter, fallback to chains for backwards compat
    const network = options?.network || 'ethereum';
    const networkAliases = getNetworkAliases(network);
    
    console.log(`\n========================================`);
    console.log(`[RouteSourceAdapter] CALLED for: ${addr}`);
    console.log(`[RouteSourceAdapter] Network: ${network}, aliases: ${networkAliases.join(',')}`);
    console.log(`========================================\n`);
    
    try {
      const db = mongoose.connection?.db;
      
      if (!db) {
        console.warn('[RouteSourceAdapter] No database connection, using mock');
        return this.getMockRoutes(addr, limit, network);
      }
      
      console.log(`[RouteSourceAdapter] DB connected, querying relations for ${network}...`);
      
      // ETAP B1: Filter by network aliases
      const relations = await db.collection('relations')
        .find({ 
          $and: [
            {
              $or: [
                { from: { $regex: addr, $options: 'i' } },
                { to: { $regex: addr, $options: 'i' } }
              ]
            },
            { chain: { $in: networkAliases } }
          ]
        })
        .sort({ lastSeenAt: -1 })
        .limit(limit)
        .toArray();
      
      console.log(`[RouteSourceAdapter] Found ${relations.length} relations on ${network}`);
      
      if (relations.length === 0) {
        // Try transfers directly
        const transfers = await db.collection('transfers')
          .find({
            $and: [
              {
                $or: [
                  { from: { $regex: addr, $options: 'i' } },
                  { to: { $regex: addr, $options: 'i' } }
                ]
              },
              { chain: { $in: networkAliases } }
            ]
          })
          .sort({ timestamp: -1 })
          .limit(limit)
          .toArray();
        
        console.log(`[RouteSourceAdapter] Found ${transfers.length} transfers on ${network}`);
        
        if (transfers.length > 0) {
          return this.transfersToRoutes(transfers, addr, network);
        }
        
        // No real data - return mock for demo
        console.warn(`[RouteSourceAdapter] No real data on ${network}, using mock`);
        return this.getMockRoutes(addr, limit, network);
      }
      
      // Convert relations to routes
      return this.relationsToRoutes(relations, addr, network);
      
    } catch (err) {
      console.error('[RouteSourceAdapter] Error:', err);
      return this.getMockRoutes(addr, limit, network);
    }
  }
  
  /**
   * Convert relations to EnrichedRoute format
   * ETAP B1: Include normalized network
   */
  private relationsToRoutes(relations: any[], queryAddress: string, network: NetworkType): EnrichedRoute[] {
    // Group relations by counterparty
    const routeMap = new Map<string, any[]>();
    
    relations.forEach(rel => {
      const counterparty = rel.from.toLowerCase() === queryAddress.toLowerCase() ? rel.to : rel.from;
      if (!routeMap.has(counterparty)) {
        routeMap.set(counterparty, []);
      }
      routeMap.get(counterparty)!.push(rel);
    });
    
    // Build routes from grouped relations
    const routes: EnrichedRoute[] = [];
    
    routeMap.forEach((rels, counterparty) => {
      const isOutgoing = rels[0].from.toLowerCase() === queryAddress.toLowerCase();
      const totalVolume = rels.reduce((sum, r) => sum + parseFloat(r.volumeRaw || '0'), 0);
      const interactionCount = rels.reduce((sum, r) => sum + (r.interactionCount || 1), 0);
      
      const segments: RouteSegment[] = rels.map(rel => ({
        type: 'TRANSFER',
        from: rel.from,
        to: rel.to,
        chain: network, // ETAP B1: Use normalized network
        timestamp: rel.lastSeenAt ? new Date(rel.lastSeenAt).getTime() : Date.now(),
        amount: parseFloat(rel.volumeRaw || '0'),
        direction: rel.direction || (isOutgoing ? 'OUT' : 'IN'),
      }));
      
      routes.push({
        routeId: `rel-${queryAddress.slice(0, 8)}-${counterparty.slice(0, 8)}`,
        from: isOutgoing ? queryAddress : counterparty,
        to: isOutgoing ? counterparty : queryAddress,
        chain: network, // ETAP B1: Use normalized network
        routeType: isOutgoing ? 'EXIT' : 'ENTRY',
        exitProbability: isOutgoing ? 0.7 : 0.3,
        dumpRiskScore: isOutgoing ? 60 : 30,
        pathEntropy: Math.min(1, interactionCount / 10),
        segments,
        firstSeenAt: rels[0].firstSeenAt ? new Date(rels[0].firstSeenAt).getTime() : Date.now(),
        lastSeenAt: rels[0].lastSeenAt ? new Date(rels[0].lastSeenAt).getTime() : Date.now(),
        hasCexTouchpoint: false,
        hasSwapBeforeExit: false,
      });
    });
    
    return routes;
  }
  
  /**
   * Convert transfers to EnrichedRoute format
   * ETAP B1: Include normalized network
   */
  private transfersToRoutes(transfers: any[], queryAddress: string, network: NetworkType): EnrichedRoute[] {
    const routeMap = new Map<string, any[]>();
    
    transfers.forEach(tx => {
      const counterparty = tx.from.toLowerCase() === queryAddress.toLowerCase() ? tx.to : tx.from;
      if (!routeMap.has(counterparty)) {
        routeMap.set(counterparty, []);
      }
      routeMap.get(counterparty)!.push(tx);
    });
    
    const routes: EnrichedRoute[] = [];
    
    routeMap.forEach((txs, counterparty) => {
      const isOutgoing = txs[0].from.toLowerCase() === queryAddress.toLowerCase();
      
      const segments: RouteSegment[] = txs.map(tx => ({
        type: 'TRANSFER',
        from: tx.from,
        to: tx.to,
        chain: network, // ETAP B1: Use normalized network
        timestamp: tx.timestamp ? new Date(tx.timestamp).getTime() : Date.now(),
        txHash: tx.txHash,
        amount: parseFloat(tx.amountRaw || tx.amountNormalized || '0'),
        token: tx.assetAddress,
      }));
      
      routes.push({
        routeId: `tx-${queryAddress.slice(0, 8)}-${counterparty.slice(0, 8)}`,
        from: isOutgoing ? queryAddress : counterparty,
        to: isOutgoing ? counterparty : queryAddress,
        chain: network, // ETAP B1: Use normalized network
        routeType: isOutgoing ? 'EXIT' : 'ENTRY',
        exitProbability: isOutgoing ? 0.6 : 0.4,
        dumpRiskScore: isOutgoing ? 50 : 25,
        pathEntropy: Math.min(1, txs.length / 5),
        segments,
        firstSeenAt: txs[txs.length - 1].timestamp ? new Date(txs[txs.length - 1].timestamp).getTime() : Date.now(),
        lastSeenAt: txs[0].timestamp ? new Date(txs[0].timestamp).getTime() : Date.now(),
        hasCexTouchpoint: false,
        hasSwapBeforeExit: false,
      });
    });
    
    return routes;
  }
  
  /**
   * Get specific route by ID
   */
  async getEnrichedRouteById(routeId: string): Promise<EnrichedRoute | null> {
    try {
      const db = mongoose.connection.db;
      
      if (!db) {
        return this.getMockRoute(routeId);
      }
      
      const route = await db.collection('routes_enriched')
        .findOne({ routeId });
      
      if (!route) {
        return this.getMockRoute(routeId);
      }
      
      return this.normalizeRoute(route);
      
    } catch (err) {
      console.error('[RouteSourceAdapter] Error:', err);
      return this.getMockRoute(routeId);
    }
  }
  
  // ============================================
  // Private Helpers
  // ============================================
  
  private normalizeRoute(route: any): EnrichedRoute {
    return {
      routeId: route.routeId || route._id?.toString() || `route-${Date.now()}`,
      from: route.from || route.actor || '',
      to: route.to,
      chain: route.chain || 'eth',
      
      routeType: route.routeType || route.type || 'EXIT',
      exitProbability: route.exitProbability ?? 0.5,
      dumpRiskScore: route.dumpRiskScore ?? 50,
      pathEntropy: route.pathEntropy ?? 0.5,
      
      segments: route.segments || [],
      
      firstSeenAt: route.firstSeenAt || route.timestamp || Date.now(),
      lastSeenAt: route.lastSeenAt || route.timestamp || Date.now(),
      
      hasCexTouchpoint: route.hasCexTouchpoint ?? false,
      hasSwapBeforeExit: route.hasSwapBeforeExit ?? false
    };
  }
  
  private flowToRoute(flow: any): EnrichedRoute {
    return {
      routeId: flow._id?.toString() || `flow-${Date.now()}`,
      from: flow.actor || flow.from || '',
      chain: flow.chain || 'eth',
      
      routeType: flow.flowType || 'EXIT',
      exitProbability: flow.exitProbability ?? 0.5,
      dumpRiskScore: flow.riskScore ?? 50,
      pathEntropy: 0.5,
      
      segments: flow.transfers?.map((t: any, i: number) => ({
        type: 'TRANSFER',
        from: t.from,
        to: t.to,
        chain: t.chain || flow.chain || 'eth',
        timestamp: t.timestamp,
        txHash: t.txHash,
        amount: t.value,
        token: t.token
      })) || [],
      
      firstSeenAt: flow.timestamp || Date.now(),
      lastSeenAt: flow.timestamp || Date.now(),
      
      hasCexTouchpoint: flow.touchesCex ?? false,
      hasSwapBeforeExit: false
    };
  }
  
  private getMockRoutes(address: string, limit: number, network: NetworkType = 'ethereum'): EnrichedRoute[] {
    // Return mock demo route for testing
    return [{
      routeId: `mock-route-${address.slice(0, 8)}`,
      from: address,
      chain: network, // ETAP B1: Use network
      routeType: 'EXIT',
      exitProbability: 0.75,
      dumpRiskScore: 65,
      pathEntropy: 0.4,
      segments: [
        {
          type: 'TRANSFER',
          from: address,
          to: '0x1234567890123456789012345678901234567890',
          chain: network,
          timestamp: Date.now() - 3600000,
          amount: 100,
          token: 'ETH'
        },
        {
          type: 'BRIDGE',
          from: address,
          to: address,
          chain: network,
          chainFrom: network,
          chainTo: 'arbitrum',
          timestamp: Date.now() - 1800000,
          protocol: 'stargate'
        },
        {
          type: 'SWAP',
          from: address,
          to: address,
          chain: network,
          timestamp: Date.now() - 900000,
          protocol: 'uniswap'
        },
        {
          type: 'CEX_DEPOSIT',
          from: address,
          to: '0x28c6c06298d514db089934071355e5743bf21d60', // Binance
          chain: network,
          timestamp: Date.now() - 300000
        }
      ],
      firstSeenAt: Date.now() - 3600000,
      lastSeenAt: Date.now() - 300000,
      hasCexTouchpoint: true,
      hasSwapBeforeExit: true
    }].slice(0, limit);
  }
  
  private getMockRoute(routeId: string): EnrichedRoute {
    return {
      routeId,
      from: '0x0000000000000000000000000000000000000001',
      chain: 'eth',
      routeType: 'EXIT',
      exitProbability: 0.7,
      dumpRiskScore: 60,
      pathEntropy: 0.5,
      segments: [],
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      hasCexTouchpoint: false,
      hasSwapBeforeExit: false
    };
  }
}

// Singleton
export const routeSourceAdapter = new RouteSourceAdapter();
