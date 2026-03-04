/**
 * Entities Routes - Real Implementation
 * 
 * API для работы с entities (Exchange / Fund / MM / Protocol)
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { EntityModel } from './entities.model.js';
import { EntityAddressModel } from './entity_address.model.js';
import { seedEntities } from './entities.seed.js';
import * as entityProfileService from './entity_profile.service.js';
import * as aggregation from './entities.aggregation.js';
import * as entityMetrics from './entity_metrics.service.js';
import * as addressExpansion from './address_expansion.service.js';
import * as recentTransactions from './recent_transactions.service.js';
import * as crossChainContext from './cross_chain_context.service.js';

const entitiesRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /entities
   * List all entities with filters and pagination
   */
  fastify.get('/', async (request: FastifyRequest) => {
    const query = request.query as { 
      search?: string; 
      category?: string; 
      limit?: string;
      page?: string;
      status?: string;
      attribution?: string; // 'verified' | 'assumed' | 'all'
      sort?: string; // 'activity' | 'net_flow' | 'holdings' | 'coverage'
    };
    
    const limit = Math.min(parseInt(query.limit || '9'), 100);
    const page = Math.max(parseInt(query.page || '1'), 1);
    const skip = (page - 1) * limit;
    const search = query.search?.toLowerCase();
    const category = query.category;
    const status = query.status || 'live';
    const attribution = query.attribution;
    const sortBy = query.sort || 'coverage';
    
    // Build filter
    const filter: any = {};
    
    if (status && status !== 'all') {
      filter.status = status;
    }
    
    if (category && category !== 'all') {
      filter.category = category;
    }
    
    // Attribution filter
    if (attribution === 'verified') {
      filter['attribution.confidence'] = { $gte: 90 };
    } else if (attribution === 'assumed') {
      filter['attribution.confidence'] = { $lt: 90 };
    }
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
        { tags: { $in: [search] } },
      ];
    }
    
    // Build sort
    let sortOptions: any = { coverage: -1, addressesCount: -1 };
    if (sortBy === 'activity') {
      sortOptions = { volume24h: -1 };
    } else if (sortBy === 'net_flow') {
      sortOptions = { netFlow24h: -1 };
    } else if (sortBy === 'holdings') {
      sortOptions = { totalHoldingsUSD: -1 };
    }
    
    // Get total count
    const total = await EntityModel.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);
    
    // Get entities
    const entities = await EntityModel.find(filter)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .lean();
    
    // Format for frontend
    const formatted = entities.map((e: any) => ({
      id: e._id.toString(),
      name: e.name,
      slug: e.slug,
      logo: e.logo,
      description: e.description,
      category: e.category,
      tags: e.tags,
      addressesCount: e.addressesCount,
      coverage: e.coverage,
      status: e.status,
      netFlow24h: e.netFlow24h,
      volume24h: e.volume24h,
      topTokens: e.topTokens,
      totalHoldingsUSD: e.totalHoldingsUSD,
      // Attribution (Layer 0: verified vs assumed)
      attribution: e.attribution ? {
        method: e.attribution.method,
        confidence: e.attribution.confidence,
        evidence: e.attribution.evidence,
        // Simplified status for UI
        status: e.attribution.confidence >= 90 ? 'verified' : 
                e.attribution.confidence >= 70 ? 'high_confidence' : 'assumed',
      } : {
        method: 'unknown',
        status: 'assumed',
      },
      source: e.source,
      updatedAt: e.updatedAt,
    }));
    
    return {
      ok: true,
      data: {
        entities: formatted,
        // Pagination
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
        // Filters applied
        filters: {
          category: category || 'all',
          attribution: attribution || 'all',
          status: status || 'live',
          sort: sortBy,
        },
        interpretation: {
          headline: `${formatted.length} entities found`,
          description: category && category !== 'all' 
            ? `Showing ${category} entities (page ${page}/${totalPages})`
            : `All entity types included (page ${page}/${totalPages})`,
        },
      },
    };
  });
  
  /**
   * GET /entities/:slug
   * Get entity details
   */
  fastify.get('/:slug', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    
    const entity = await EntityModel.findOne({ slug: slug.toLowerCase() }).lean();
    
    if (!entity) {
      return {
        ok: false,
        error: 'Entity not found',
      };
    }
    
    // Get addresses
    const addresses = await EntityAddressModel.find({ 
      entityId: (entity as any)._id.toString() 
    })
      .sort({ lastSeen: -1 })
      .limit(10)
      .lean();
    
    const e = entity as any;
    
    return {
      ok: true,
      data: {
        entity: {
          id: e._id.toString(),
          name: e.name,
          slug: e.slug,
          logo: e.logo,
          description: e.description,
          category: e.category,
          tags: e.tags,
          addressesCount: e.addressesCount,
          coverage: e.coverage,
          status: e.status,
          netFlow24h: e.netFlow24h,
          volume24h: e.volume24h,
          topTokens: e.topTokens,
          totalHoldingsUSD: e.totalHoldingsUSD,
          source: e.source,
          attribution: e.attribution,
          firstSeen: e.firstSeen,
          lastSeen: e.lastSeen,
          updatedAt: e.updatedAt,
        },
        addresses: addresses.map((a: any) => ({
          chain: a.chain,
          address: a.address,
          role: a.role,
          firstSeen: a.firstSeen,
          lastSeen: a.lastSeen,
        })),
      },
    };
  });
  
  /**
   * GET /entities/:slug/holdings
   * Get entity holdings breakdown (real data from indexed transfers)
   */
  fastify.get('/:slug/holdings', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    
    try {
      const result = await aggregation.calculateEntityHoldings(slug);
      
      return {
        ok: true,
        data: {
          holdings: result.holdings.map(h => ({
            token: h.token,
            tokenAddress: h.tokenAddress,
            balance: h.balance,
            balanceRaw: h.balanceRaw,
            valueUSD: h.valueUSD,
            percentage: h.percentage,
          })),
          total: result.total,
          totalTokens: result.totalTokens,
          lastUpdated: result.lastUpdated,
          source: result.holdings.length > 0 ? 'indexed_transfers' : 'no_data',
          interpretation: {
            headline: result.holdings.length > 0 
              ? `${result.holdings.length} tokens tracked`
              : 'No holdings data available',
            description: 'Holdings calculated from observed inflows minus outflows',
          },
        },
      };
    } catch (error) {
      console.error('[Entities] Holdings aggregation error:', error);
      return {
        ok: true,
        data: {
          holdings: [],
          total: 0,
          totalTokens: 0,
          lastUpdated: new Date(),
          source: 'error',
        },
      };
    }
  });
  
  /**
   * GET /entities/:slug/flows
   * Get entity net flow history with token breakdown (real data)
   */
  fastify.get('/:slug/flows', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const query = request.query as { window?: string };
    
    const windowDays = query.window === '24h' ? 1 : query.window === '30d' ? 30 : 7;
    
    try {
      const result = await aggregation.calculateEntityFlows(slug, windowDays);
      
      return {
        ok: true,
        data: {
          // Daily flows
          flows: result.flows.map(f => ({
            date: f.date,
            netFlow: f.netFlow,
            inflow: f.inflow,
            outflow: f.outflow,
          })),
          // Per-token breakdown
          byToken: result.byToken.map(t => ({
            token: t.token,
            tokenAddress: t.tokenAddress,
            inflow: t.inflow,
            outflow: t.outflow,
            netFlow: t.netFlow,
            inflowUSD: t.inflowUSD,
            outflowUSD: t.outflowUSD,
            netFlowUSD: t.netFlowUSD,
            dominantFlow: t.dominantFlow,
            txCount: t.txCount,
          })),
          summary: {
            totalInflow: result.totalInflow,
            totalOutflow: result.totalOutflow,
            netFlow: result.netFlow,
          },
          window: result.window,
          source: result.flows.some(f => f.inflow > 0 || f.outflow > 0) ? 'indexed_transfers' : 'no_data',
          interpretation: {
            headline: result.netFlow >= 0 
              ? `Net inflow observed: +$${Math.abs(result.netFlow / 1e6).toFixed(1)}M`
              : `Net outflow observed: -$${Math.abs(result.netFlow / 1e6).toFixed(1)}M`,
            description: `${result.window} period analyzed`,
          },
        },
      };
    } catch (error) {
      console.error('[Entities] Flows aggregation error:', error);
      return {
        ok: true,
        data: {
          flows: [],
          byToken: [],
          summary: { totalInflow: 0, totalOutflow: 0, netFlow: 0 },
          window: query.window || '7d',
          source: 'error',
        },
      };
    }
  });
  
  /**
   * GET /entities/:slug/bridges
   * Get cross-chain/bridge activity for entity
   */
  fastify.get('/:slug/bridges', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    
    try {
      const result = await aggregation.calculateEntityBridgeFlows(slug);
      
      return {
        ok: true,
        data: {
          bridges: result.bridges.map(b => ({
            fromChain: b.fromChain,
            toChain: b.toChain,
            asset: b.asset,
            assetAddress: b.assetAddress,
            volume: b.volume,
            volumeUSD: b.volumeUSD,
            direction: b.direction,
            txCount: b.txCount,
          })),
          totalVolume: result.totalVolume,
          summary: result.summary,
          source: result.bridges.length > 0 ? 'indexed_transfers' : 'no_data',
          interpretation: {
            headline: result.bridges.length > 0 
              ? `Cross-chain activity detected: ${result.bridges.length} routes`
              : 'No bridge activity detected',
            description: 'Bridge flows from Ethereum to L2s and cross-chain',
          },
        },
      };
    } catch (error) {
      console.error('[Entities] Bridge aggregation error:', error);
      return {
        ok: true,
        data: {
          bridges: [],
          totalVolume: 0,
          summary: { l1ToL2: 0, crossChain: 0 },
          source: 'error',
        },
      };
    }
  });
  
  /**
   * GET /entities/:slug/transactions
   * Get recent transactions for entity
   */
  fastify.get('/:slug/transactions', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const query = request.query as { limit?: string };
    
    const limit = Math.min(parseInt(query.limit || '20'), 100);
    
    try {
      const transactions = await aggregation.getEntityTransactions(slug, limit);
      
      return {
        ok: true,
        data: {
          transactions,
          total: transactions.length,
          source: transactions.length > 0 ? 'indexed_transfers' : 'no_data',
        },
      };
    } catch (error) {
      console.error('[Entities] Transactions query error:', error);
      return {
        ok: true,
        data: {
          transactions: [],
          total: 0,
          source: 'error',
        },
      };
    }
  });
  
  /**
   * GET /entities/:slug/pattern-bridge
   * Get entity addresses grouped by behavioral patterns (P0 Feature)
   */
  fastify.get('/:slug/pattern-bridge', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    
    try {
      const result = await aggregation.getEntityPatternBridge(slug);
      
      return {
        ok: true,
        data: {
          patterns: result.patterns.map(p => ({
            pattern: p.pattern,
            description: p.description,
            addresses: p.addresses.map(a => ({
              address: a.address,
              shortAddress: `${a.address.slice(0, 6)}...${a.address.slice(-4)}`,
              patternScore: Math.round(a.patternScore),
              txCount: a.txCount,
              avgValue: a.avgValue,
              dominantTokens: a.dominantTokens,
              lastActive: a.lastActive,
            })),
            totalTxCount: p.totalTxCount,
            avgPatternScore: Math.round(p.avgPatternScore),
          })),
          totalAddresses: result.totalAddresses,
          source: result.patterns.length > 0 ? 'indexed_transfers' : 'no_data',
          interpretation: {
            headline: result.patterns.length > 0 
              ? `${result.totalAddresses} addresses grouped into ${result.patterns.length} patterns`
              : 'No pattern data available',
            description: 'Addresses grouped by observed behavioral patterns',
          },
        },
      };
    } catch (error) {
      console.error('[Entities] Pattern bridge error:', error);
      return {
        ok: true,
        data: {
          patterns: [],
          totalAddresses: 0,
          source: 'error',
        },
      };
    }
  });
  
  /**
   * POST /entities/seed
   * Seed initial entities (dev only)
   */
  fastify.post('/seed', async (request, reply) => {
    // Dev only
    if (process.env.NODE_ENV === 'production') {
      return reply.code(403).send({ ok: false, error: 'Seed disabled in production' });
    }
    
    const result = await seedEntities();
    return {
      ok: true,
      data: result,
    };
  });

  /**
   * GET /entities/:id/profile
   * Get comprehensive entity profile
   */
  fastify.get('/:id/profile', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const profile = await entityProfileService.getEntityProfile(id);
    
    return {
      ok: true,
      data: {
        entityId: id,
        profile,
        interpretation: {
          headline: 'Entity profile loaded',
          description: 'Comprehensive entity analysis',
        },
      },
    };
  });
  
  /**
   * GET /entities/:id/actors
   * Get actors belonging to entity
   */
  fastify.get('/:id/actors', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const actors = await entityProfileService.getEntityActors(id);
    
    return {
      ok: true,
      data: {
        entityId: id,
        actors,
      },
    };
  });
  
  /**
   * GET /entities/:id/strategies
   * Get strategies used by entity
   */
  fastify.get('/:id/strategies', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const strategies = await entityProfileService.getEntityStrategies(id);
    
    return {
      ok: true,
      data: {
        entityId: id,
        strategies,
      },
    };
  });
  
  // ============ CORRECTED METRICS (Layer 0/1) ============
  
  /**
   * GET /entities/:slug/net-flow
   * CORRECT Net Flow calculation with proper decimals + USD conversion
   */
  fastify.get('/:slug/net-flow', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const query = request.query as { window?: string };
    
    // Parse window
    let windowHours = 168; // 7d default
    if (query.window === '24h') windowHours = 24;
    if (query.window === '30d') windowHours = 720;
    
    const result = await entityMetrics.calculateNetFlow(slug, windowHours);
    
    return {
      ok: true,
      data: result,
      meta: {
        layer: 'L0',
        description: 'Net flow calculated from indexed transfers with proper decimals normalization',
        disclaimer: 'USD values based on available price data',
      },
    };
  });
  
  /**
   * GET /entities/:slug/coverage
   * CORRECT Data Coverage calculation (addressCoverage + usdCoverage)
   */
  fastify.get('/:slug/coverage', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const query = request.query as { window?: string };
    
    let windowHours = 168;
    if (query.window === '24h') windowHours = 24;
    if (query.window === '30d') windowHours = 720;
    
    const result = await entityMetrics.calculateCoverage(slug, windowHours);
    
    return {
      ok: true,
      data: result,
      meta: {
        layer: 'L0',
        formula: 'dataCoverage = 0.35 × addressCoverage + 0.65 × usdCoverage',
        disclaimer: 'Coverage reflects data completeness, not quality',
      },
    };
  });
  
  /**
   * GET /entities/:slug/token-flows
   * Token Flow Matrix v2 (EPIC 3) - Separate inflow/outflow lists
   */
  fastify.get('/:slug/token-flows', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const query = request.query as { window?: string; limit?: string };
    
    let windowHours = 168;
    if (query.window === '24h') windowHours = 24;
    if (query.window === '30d') windowHours = 720;
    
    const limit = Math.min(parseInt(query.limit || '10'), 20);
    
    const result = await entityMetrics.getTokenFlowMatrixV2(slug, windowHours, limit);
    
    return {
      ok: true,
      data: result,
      meta: {
        layer: 'L0',
        filter: 'ERC20 tokens on Ethereum only',
        minThreshold: '$100,000 USD',
        disclaimer: 'Excludes weakly attributed addresses. BTC/SOL excluded unless via bridge contracts.',
      },
    };
  });
  
  /**
   * GET /entities/:slug/similarity
   * CORRECT Cross-Entity Similarity with confidence buckets
   */
  fastify.get('/:slug/similarity', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const query = request.query as { window?: string };
    
    let windowHours = 168;
    if (query.window === '24h') windowHours = 24;
    if (query.window === '30d') windowHours = 720;
    
    const result = await entityMetrics.calculateEntitySimilarity(slug, windowHours);
    
    return {
      ok: true,
      data: result,
      meta: {
        layer: 'L1',
        formula: 'similarity = 0.5×cos(netflow) + 0.3×vol_ratio + 0.2×coverage_sim',
        disclaimer: 'Pattern similarity, not coordination',
      },
    };
  });
  
  // ============ EPIC 1: ADDRESS EXPANSION ============
  
  /**
   * POST /entities/:slug/expand-addresses
   * Run address expansion for an entity
   */
  fastify.post('/:slug/expand-addresses', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    
    const result = await addressExpansion.runFullExpansion(slug);
    
    return {
      ok: true,
      data: result,
      meta: {
        layer: 'L0',
        description: 'Expanded entity addresses using verified sources and correlation',
      },
    };
  });
  
  /**
   * GET /entities/:slug/address-stats
   * Get address statistics for an entity
   */
  fastify.get('/:slug/address-stats', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    
    const stats = await addressExpansion.getAddressStats(slug);
    
    return {
      ok: true,
      data: stats,
      meta: {
        layer: 'L0',
        description: 'Address breakdown by confidence level',
        safetyNote: 'Only verified + attributed addresses are used in aggregates',
      },
    };
  });
  
  // ============ EPIC 5: CROSS-CHAIN CONTEXT ============
  
  /**
   * GET /entities/:slug/cross-chain-context
   * Cross-chain activity for CONTEXT ONLY
   * 
   * 🚨 ML SAFETY GUARD:
   * This endpoint returns CONTEXTUAL information only.
   * Data from this endpoint MUST NOT be used in:
   * - Engine aggregation (Layer 1)
   * - ML feature extraction (Layer 2)
   * - Confidence calculations
   * - Net flow or coverage metrics
   * 
   * Layer: L0 (Research) - CONTEXT ONLY, NOT METRICS
   */
  fastify.get('/:slug/cross-chain-context', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    
    const result = await crossChainContext.getCrossChainContext(slug);
    
    return {
      ok: true,
      data: result,
      meta: {
        layer: 'L0',
        type: 'context_only',
        description: 'Cross-chain activity shown for context only',
        // 🚨 ML SAFETY GUARD - explicit prohibition
        mlSafety: {
          usableInEngine: false,
          usableInML: false,
          reason: 'Cross-chain data lacks reliable attribution for analytical use',
        },
        disclaimers: [
          'This data is for contextual understanding only.',
          'Cross-chain flows are NOT included in entity metrics.',
          'USD values and net flows are intentionally excluded.',
          'Do not use this data for trading decisions.',
        ],
      },
    };
  });
  
  // ============ EPIC 4: RECENT TRANSACTIONS v2 ============
  
  /**
   * GET /entities/:slug/recent-transactions
   * Token-aware, Volume-weighted sampling
   * 
   * Layer: L0 (Research) - FACTS ONLY
   */
  fastify.get('/:slug/recent-transactions', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const query = request.query as { window?: string };
    
    let windowHours = 24; // Default 24h for recent
    if (query.window === '7d') windowHours = 168;
    if (query.window === '30d') windowHours = 720;
    
    const result = await recentTransactions.getRecentTransactions(slug, windowHours);
    
    return {
      ok: true,
      data: result,
      meta: {
        layer: 'L0',
        method: 'Token-aware sampling',
        description: 'Recent transactions sampled by token volume distribution',
        constraints: {
          maxTokens: 7,
          txPerToken: 3,
          minUSD: '$50K',
        },
        disclaimer: 'Facts only. No signals, no predictions, no confidence scores.',
      },
    };
  });
  
  console.log('Entities routes registered');
};

export default entitiesRoutes;
