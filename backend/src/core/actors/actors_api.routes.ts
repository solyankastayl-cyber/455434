/**
 * Actors API Routes - LIVE DATA
 * 
 * Serves actor cards with real aggregated data.
 * Philosophy: Observed structure, not predictions.
 * 
 * Memory-safe: All aggregations at DB level.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { EntityModel } from '../entities/entities.model.js';
import { EntityAddressModel } from '../entities/entity_address.model.js';
import { TransferModel } from '../transfers/transfers.model.js';

// ============ LIMITS ============
const LIMITS = {
  MAX_ACTORS: 50,
  MAX_TX_SAMPLE: 2000,
  CACHE_TTL_MS: 5 * 60 * 1000,
};

// ============ CACHE ============
const actorsCache = new Map<string, { data: any; timestamp: number }>();

function getCached(key: string): any | null {
  const entry = actorsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > LIMITS.CACHE_TTL_MS) {
    actorsCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: any): void {
  actorsCache.set(key, { data, timestamp: Date.now() });
}

// ============ TYPE CLASSIFICATION ============
function classifyActorType(category: string, patterns: any): string {
  if (category === 'custody' || category === 'exchange') return 'Exchange';
  if (category === 'fund' || category === 'vc') return 'Fund';
  if (category === 'market_maker') return 'Market Maker';
  if (patterns?.dominant === 'whale') return 'Whale';
  if (patterns?.dominant === 'active_trader') return 'Trader';
  if (patterns?.dominant === 'accumulator') return 'Accumulator';
  if (patterns?.dominant === 'distributor') return 'Distributor';
  return 'Unknown';
}

// ============ TAG GENERATION ============
function generateTags(entity: any, metrics: any): string[] {
  const tags: string[] = [];
  
  // Based on category
  if (entity.category === 'fund' || entity.category === 'vc') {
    tags.push('Institutional');
  }
  
  // Based on flow patterns
  if (metrics.netFlow > 1000000) {
    tags.push('Net Accumulator');
  } else if (metrics.netFlow < -1000000) {
    tags.push('Net Distributor');
  }
  
  // Based on activity
  if (metrics.txCount > 100) {
    tags.push('High Activity');
  }
  
  // Based on wallet count
  if (entity.addressesCount >= 10) {
    tags.push('Multi-Wallet');
  }
  
  return tags.slice(0, 4); // Max 4 tags
}

// ============ SCORE CALCULATION ============
function calculateEdgeScore(metrics: any, maxTotalFlow: number): number {
  if (!metrics || maxTotalFlow === 0) return 0;
  
  const flowScore = Math.log10(metrics.totalFlow + 1) / Math.log10(maxTotalFlow + 1) * 50;
  const activityScore = Math.min(50, metrics.txCount / 10);
  
  return Math.round(flowScore + activityScore);
}

// ============ MAIN API ============
export const actorsApiRoutes: FastifyPluginAsync = async (fastify) => {
  
  /**
   * GET /actors
   * Returns list of actors with aggregated metrics
   */
  fastify.get('/', async (request: FastifyRequest) => {
    const query = request.query as { 
      sort?: string; 
      q?: string;
      type?: string;
      hasSignals?: string;
      limit?: string;
    };
    
    const cacheKey = `actors:${JSON.stringify(query)}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return { ok: true, data: cached, cached: true };
    }
    
    try {
      // Get entities
      const entities = await EntityModel.find({ status: 'live' })
        .limit(LIMITS.MAX_ACTORS)
        .lean();
      
      // Calculate metrics for each entity (DB-level aggregation)
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const actors = [];
      let maxTotalFlow = 0;
      
      for (const entity of entities) {
        const e = entity as any;
        
        // Get addresses
        const addresses = await EntityAddressModel.find({ entityId: e._id.toString() })
          .select('address')
          .lean();
        const addressList = (addresses as any[]).map(a => a.address.toLowerCase());
        
        // DB-level flow aggregation
        let inflow = 0, outflow = 0, txCount = 0;
        
        if (addressList.length > 0) {
          const [inflowAgg, outflowAgg] = await Promise.all([
            TransferModel.aggregate([
              { $match: { to: { $in: addressList }, timestamp: { $gte: cutoff } } },
              { $sample: { size: LIMITS.MAX_TX_SAMPLE } },
              { $group: { _id: null, total: { $sum: { $toDouble: '$amountNormalized' } }, count: { $sum: 1 } } }
            ]),
            TransferModel.aggregate([
              { $match: { from: { $in: addressList }, timestamp: { $gte: cutoff } } },
              { $sample: { size: LIMITS.MAX_TX_SAMPLE } },
              { $group: { _id: null, total: { $sum: { $toDouble: '$amountNormalized' } }, count: { $sum: 1 } } }
            ])
          ]);
          
          inflow = inflowAgg[0]?.total || 0;
          outflow = outflowAgg[0]?.total || 0;
          txCount = (inflowAgg[0]?.count || 0) + (outflowAgg[0]?.count || 0);
        }
        
        const metrics = {
          inflow,
          outflow,
          totalFlow: inflow + outflow,
          netFlow: inflow - outflow,
          txCount,
        };
        
        if (metrics.totalFlow > maxTotalFlow) {
          maxTotalFlow = metrics.totalFlow;
        }
        
        actors.push({
          id: e.slug,
          name: e.name,
          slug: e.slug,
          logo: e.logo || null,
          actorType: classifyActorType(e.category, null),
          category: e.category,
          walletCount: e.addressesCount || addressList.length,
          metrics,
          tags: generateTags(e, metrics),
          badges: e.confidence >= 80 ? ['Confirmed'] : [],
          // Replaced WinRate/PnL with fact-based metrics
          highlights: [
            { 
              label: 'Participation', 
              value: `${txCount} tx`,
              tooltip: 'Transaction count in 7d window'
            },
            { 
              label: 'Flow Volume', 
              value: formatUSD(metrics.totalFlow),
              tooltip: 'Total in+out flow volume (7d)'
            },
            { 
              label: 'Net Position', 
              value: `${metrics.netFlow >= 0 ? '+' : ''}${formatUSD(metrics.netFlow)}`,
              tooltip: 'Net flow direction (inflow - outflow)'
            },
          ],
        });
      }
      
      // Calculate scores after we know max
      for (const actor of actors) {
        actor.edgeScore = calculateEdgeScore(actor.metrics, maxTotalFlow);
      }
      
      // Apply filters
      let result = actors;
      
      if (query.q) {
        const q = query.q.toLowerCase();
        result = result.filter(a => 
          a.name.toLowerCase().includes(q) ||
          a.tags.some((t: string) => t.toLowerCase().includes(q)) ||
          a.actorType.toLowerCase().includes(q)
        );
      }
      
      if (query.type) {
        result = result.filter(a => a.actorType.toLowerCase() === query.type.toLowerCase());
      }
      
      // Sort
      if (query.sort === 'edgeScore' || !query.sort) {
        result.sort((a, b) => b.edgeScore - a.edgeScore);
      } else if (query.sort === 'walletCount') {
        result.sort((a, b) => b.walletCount - a.walletCount);
      } else if (query.sort === 'activity') {
        result.sort((a, b) => b.metrics.txCount - a.metrics.txCount);
      }
      
      // Limit
      const limit = Math.min(parseInt(query.limit || '20'), LIMITS.MAX_ACTORS);
      result = result.slice(0, limit);
      
      // Cache
      setCache(cacheKey, { actors: result, total: actors.length });
      
      return {
        ok: true,
        data: {
          actors: result,
          total: actors.length,
          interpretation: {
            headline: `${result.length} actors with observed activity`,
            disclaimer: 'Scores reflect network position and data coverage, not performance predictions',
          },
        },
      };
      
    } catch (error) {
      console.error('[Actors API] Error:', error);
      return { ok: false, error: 'Failed to load actors' };
    }
  });

  /**
   * GET /actors/:slug
   * Returns detailed actor profile
   */
  fastify.get('/:slug', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    
    try {
      const entity = await EntityModel.findOne({ slug, status: 'live' }).lean();
      if (!entity) {
        return { ok: false, error: 'Actor not found' };
      }
      
      const e = entity as any;
      
      // Get addresses
      const addresses = await EntityAddressModel.find({ entityId: e._id.toString() }).lean();
      const addressList = (addresses as any[]).map(a => a.address.toLowerCase());
      
      // Get flow metrics
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const [inflowAgg, outflowAgg] = await Promise.all([
        TransferModel.aggregate([
          { $match: { to: { $in: addressList }, timestamp: { $gte: cutoff } } },
          { $sample: { size: LIMITS.MAX_TX_SAMPLE } },
          { $group: { _id: null, total: { $sum: { $toDouble: '$amountNormalized' } }, count: { $sum: 1 } } }
        ]),
        TransferModel.aggregate([
          { $match: { from: { $in: addressList }, timestamp: { $gte: cutoff } } },
          { $sample: { size: LIMITS.MAX_TX_SAMPLE } },
          { $group: { _id: null, total: { $sum: { $toDouble: '$amountNormalized' } }, count: { $sum: 1 } } }
        ])
      ]);
      
      const metrics = {
        inflow: inflowAgg[0]?.total || 0,
        outflow: outflowAgg[0]?.total || 0,
        totalFlow: (inflowAgg[0]?.total || 0) + (outflowAgg[0]?.total || 0),
        netFlow: (inflowAgg[0]?.total || 0) - (outflowAgg[0]?.total || 0),
        txCount: (inflowAgg[0]?.count || 0) + (outflowAgg[0]?.count || 0),
      };
      
      return {
        ok: true,
        data: {
          id: e.slug,
          name: e.name,
          slug: e.slug,
          logo: e.logo,
          actorType: classifyActorType(e.category, null),
          category: e.category,
          description: e.description,
          walletCount: addressList.length,
          addresses: addressList.slice(0, 10), // Show first 10
          metrics,
          tags: generateTags(e, metrics),
          badges: e.confidence >= 80 ? ['Confirmed'] : [],
          highlights: [
            { label: 'Participation', value: `${metrics.txCount} tx`, tooltip: '7d transactions' },
            { label: 'Flow Volume', value: formatUSD(metrics.totalFlow), tooltip: 'Total volume 7d' },
            { label: 'Net Position', value: formatUSD(metrics.netFlow), tooltip: 'Net flow 7d' },
          ],
        },
      };
      
    } catch (error) {
      console.error('[Actors API] Profile error:', error);
      return { ok: false, error: 'Failed to load actor profile' };
    }
  });

  console.log('[Actors API] Routes registered');
};

// Helper
function formatUSD(value: number): string {
  if (!value) return '$0';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export default actorsApiRoutes;
