/**
 * Actor Detail API Routes
 * 
 * Structural profile of on-chain actor behavior.
 * Philosophy: WHO they are, HOW they act, WHERE their influence.
 * 
 * NO predictions, NO verdicts, NO trading signals.
 * Only observed patterns.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { EntityModel } from '../entities/entities.model.js';
import { EntityAddressModel } from '../entities/entity_address.model.js';
import { TransferModel } from '../transfers/transfers.model.js';

// ============ LIMITS ============
const LIMITS = {
  MAX_TX_SAMPLE: 2000,
  CACHE_TTL_MS: 5 * 60 * 1000,
};

// ============ CACHE ============
const cache = new Map<string, { data: any; timestamp: number }>();

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > LIMITS.CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// ============ HELPERS ============
function formatUSD(value: number): string {
  if (!value) return '$0';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function classifyActorType(category: string): string {
  if (category === 'custody' || category === 'exchange') return 'Exchange';
  if (category === 'fund' || category === 'vc') return 'Fund';
  if (category === 'market_maker') return 'Market Maker';
  return 'Unknown';
}

// ============ ROUTES ============
export const actorDetailRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /actor/:slug/summary
   * Actor Behavior Summary - observed patterns, not predictions
   */
  fastify.get('/:slug/summary', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const cacheKey = `actor:${slug}:summary`;
    const cached = getCached(cacheKey);
    if (cached) return { ok: true, data: cached, cached: true };
    
    try {
      const entity = await EntityModel.findOne({ slug, status: 'live' }).lean();
      if (!entity) return { ok: false, error: 'Actor not found' };
      const e = entity as any;
      
      const addresses = await EntityAddressModel.find({ entityId: e._id.toString() })
        .select('address').lean();
      const addressList = (addresses as any[]).map(a => a.address.toLowerCase());
      
      const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      // DB aggregation for flows
      const [inflowAgg, outflowAgg] = await Promise.all([
        TransferModel.aggregate([
          { $match: { to: { $in: addressList }, timestamp: { $gte: cutoff7d } } },
          { $sample: { size: LIMITS.MAX_TX_SAMPLE } },
          { $group: { _id: null, total: { $sum: { $toDouble: '$amountNormalized' } }, count: { $sum: 1 } } }
        ]),
        TransferModel.aggregate([
          { $match: { from: { $in: addressList }, timestamp: { $gte: cutoff7d } } },
          { $sample: { size: LIMITS.MAX_TX_SAMPLE } },
          { $group: { _id: null, total: { $sum: { $toDouble: '$amountNormalized' } }, count: { $sum: 1 } } }
        ])
      ]);
      
      const inflow = inflowAgg[0]?.total || 0;
      const outflow = outflowAgg[0]?.total || 0;
      const netFlow = inflow - outflow;
      const txCount = (inflowAgg[0]?.count || 0) + (outflowAgg[0]?.count || 0);
      
      // Determine observed patterns
      const patterns: string[] = [];
      if (netFlow > 100000) patterns.push('Net inflow detected');
      else if (netFlow < -100000) patterns.push('Net outflow detected');
      else patterns.push('Balanced flow pattern');
      
      if (txCount > 100) patterns.push('High activity intensity');
      else if (txCount > 10) patterns.push('Moderate activity');
      else patterns.push('Low activity');
      
      const result = {
        name: e.name,
        slug: e.slug,
        logo: e.logo,
        actorType: classifyActorType(e.category),
        walletCount: addressList.length,
        confirmed: e.confidence >= 80,
        period: '7d',
        observedPatterns: patterns,
        metrics: {
          inflow: formatUSD(inflow),
          outflow: formatUSD(outflow),
          netFlow: formatUSD(netFlow),
          netFlowRaw: netFlow,
          txCount,
        },
        interpretation: 'Summary describes observed on-chain behavior, not intent or strategy.',
      };
      
      setCache(cacheKey, result);
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, error: 'Failed to load summary' };
    }
  });

  /**
   * GET /actor/:slug/tags
   * Strategy/Behavior Tags - rule-based
   */
  fastify.get('/:slug/tags', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const cacheKey = `actor:${slug}:tags`;
    const cached = getCached(cacheKey);
    if (cached) return { ok: true, data: cached, cached: true };
    
    try {
      const entity = await EntityModel.findOne({ slug, status: 'live' }).lean();
      if (!entity) return { ok: false, error: 'Actor not found' };
      const e = entity as any;
      
      const addresses = await EntityAddressModel.find({ entityId: e._id.toString() })
        .select('address').lean();
      const addressList = (addresses as any[]).map(a => a.address.toLowerCase());
      
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      // Get flow metrics for tagging
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
      
      const inflow = inflowAgg[0]?.total || 0;
      const outflow = outflowAgg[0]?.total || 0;
      const txCount = (inflowAgg[0]?.count || 0) + (outflowAgg[0]?.count || 0);
      
      // Rule-based tags
      const tags: { name: string; tooltip: string; color: string }[] = [];
      
      if (inflow > outflow * 1.5) {
        tags.push({ name: 'Accumulator', tooltip: 'Net inflow exceeds outflow by 50%+', color: 'emerald' });
      }
      if (outflow > inflow * 1.5) {
        tags.push({ name: 'Distributor', tooltip: 'Net outflow exceeds inflow by 50%+', color: 'red' });
      }
      if (txCount > 500) {
        tags.push({ name: 'High Activity', tooltip: '500+ transactions in 7d', color: 'blue' });
      }
      if (addressList.length >= 10) {
        tags.push({ name: 'Multi-Wallet', tooltip: '10+ addresses in cluster', color: 'purple' });
      }
      if (e.category === 'fund' || e.category === 'vc') {
        tags.push({ name: 'Institutional', tooltip: 'Fund or VC entity', color: 'indigo' });
      }
      
      const result = {
        tags,
        disclaimer: 'Tags reflect observed behavior patterns, not trading recommendations.',
      };
      
      setCache(cacheKey, result);
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, error: 'Failed to load tags' };
    }
  });

  /**
   * GET /actor/:slug/flows
   * Flow Analysis - net flow, flows by token
   */
  fastify.get('/:slug/flows', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const cacheKey = `actor:${slug}:flows`;
    const cached = getCached(cacheKey);
    if (cached) return { ok: true, data: cached, cached: true };
    
    try {
      const entity = await EntityModel.findOne({ slug, status: 'live' }).lean();
      if (!entity) return { ok: false, error: 'Actor not found' };
      const e = entity as any;
      
      const addresses = await EntityAddressModel.find({ entityId: e._id.toString() })
        .select('address').lean();
      const addressList = (addresses as any[]).map(a => a.address.toLowerCase());
      
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      // Flows by token (DB aggregation)
      const [inflowByToken, outflowByToken] = await Promise.all([
        TransferModel.aggregate([
          { $match: { to: { $in: addressList }, timestamp: { $gte: cutoff } } },
          { $sample: { size: LIMITS.MAX_TX_SAMPLE } },
          { $group: { 
            _id: '$assetAddress', 
            total: { $sum: { $toDouble: '$amountNormalized' } },
            count: { $sum: 1 }
          }},
          { $sort: { total: -1 } },
          { $limit: 10 }
        ]),
        TransferModel.aggregate([
          { $match: { from: { $in: addressList }, timestamp: { $gte: cutoff } } },
          { $sample: { size: LIMITS.MAX_TX_SAMPLE } },
          { $group: { 
            _id: '$assetAddress', 
            total: { $sum: { $toDouble: '$amountNormalized' } },
            count: { $sum: 1 }
          }},
          { $sort: { total: -1 } },
          { $limit: 10 }
        ])
      ]);
      
      // Merge into flow by token
      const tokenMap = new Map<string, { inflow: number; outflow: number; txCount: number }>();
      
      for (const t of inflowByToken as any[]) {
        tokenMap.set(t._id, { inflow: t.total, outflow: 0, txCount: t.count });
      }
      for (const t of outflowByToken as any[]) {
        const existing = tokenMap.get(t._id) || { inflow: 0, outflow: 0, txCount: 0 };
        existing.outflow = t.total;
        existing.txCount += t.count;
        tokenMap.set(t._id, existing);
      }
      
      const flowsByToken = Array.from(tokenMap.entries())
        .map(([address, data]) => ({
          tokenAddress: address,
          symbol: resolveTokenSymbol(address),
          inflow: data.inflow,
          outflow: data.outflow,
          netFlow: data.inflow - data.outflow,
          txCount: data.txCount,
        }))
        .sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow))
        .slice(0, 10);
      
      const totalInflow = flowsByToken.reduce((s, t) => s + t.inflow, 0);
      const totalOutflow = flowsByToken.reduce((s, t) => s + t.outflow, 0);
      
      const result = {
        period: '7d',
        summary: {
          totalInflow: formatUSD(totalInflow),
          totalOutflow: formatUSD(totalOutflow),
          netFlow: formatUSD(totalInflow - totalOutflow),
          netFlowRaw: totalInflow - totalOutflow,
        },
        flowsByToken,
        interpretation: 'Flow data represents observed token movements, not trading activity.',
      };
      
      setCache(cacheKey, result);
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, error: 'Failed to load flows' };
    }
  });

  /**
   * GET /actor/:slug/cohorts
   * Wallet Cohorts - Early/Mid/New
   */
  fastify.get('/:slug/cohorts', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const cacheKey = `actor:${slug}:cohorts`;
    const cached = getCached(cacheKey);
    if (cached) return { ok: true, data: cached, cached: true };
    
    try {
      const entity = await EntityModel.findOne({ slug, status: 'live' }).lean();
      if (!entity) return { ok: false, error: 'Actor not found' };
      const e = entity as any;
      
      const addresses = await EntityAddressModel.find({ entityId: e._id.toString() }).lean();
      const addressList = (addresses as any[]).map(a => ({
        address: a.address.toLowerCase(),
        firstSeen: a.firstSeen || new Date()
      }));
      
      // Classify by first seen date
      const now = Date.now();
      const day90 = now - 90 * 24 * 60 * 60 * 1000;
      const day30 = now - 30 * 24 * 60 * 60 * 1000;
      
      const cohorts = {
        early: { wallets: 0, percentage: 0 },
        mid: { wallets: 0, percentage: 0 },
        new: { wallets: 0, percentage: 0 },
      };
      
      for (const addr of addressList) {
        const firstSeenTime = new Date(addr.firstSeen).getTime();
        if (firstSeenTime < day90) cohorts.early.wallets++;
        else if (firstSeenTime < day30) cohorts.mid.wallets++;
        else cohorts.new.wallets++;
      }
      
      const total = addressList.length || 1;
      cohorts.early.percentage = Math.round(cohorts.early.wallets / total * 100);
      cohorts.mid.percentage = Math.round(cohorts.mid.wallets / total * 100);
      cohorts.new.percentage = Math.round(cohorts.new.wallets / total * 100);
      
      const result = {
        cohorts: [
          { name: 'Early', ...cohorts.early, description: 'First seen 90+ days ago', color: 'emerald' },
          { name: 'Mid', ...cohorts.mid, description: 'First seen 30-90 days ago', color: 'amber' },
          { name: 'New', ...cohorts.new, description: 'First seen within 30 days', color: 'blue' },
        ],
        interpretation: 'Cohorts show wallet age distribution, indicating historical vs recent activity.',
      };
      
      setCache(cacheKey, result);
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, error: 'Failed to load cohorts' };
    }
  });

  /**
   * GET /actor/:slug/similar
   * Related Actors - similarity, NOT coordination
   */
  fastify.get('/:slug/similar', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    
    try {
      // Get all other entities
      const entities = await EntityModel.find({ slug: { $ne: slug }, status: 'live' })
        .limit(10).lean();
      
      const similar = (entities as any[]).map(e => ({
        id: e.slug,
        name: e.name,
        logo: e.logo,
        actorType: classifyActorType(e.category),
        reason: 'Similar category',
      }));
      
      return {
        ok: true,
        data: {
          similar: similar.slice(0, 5),
          interpretation: 'Actors with similar observed patterns (not coordination).',
        },
      };
    } catch (error) {
      return { ok: false, error: 'Failed to load similar actors' };
    }
  });

  console.log('[Actor Detail] Routes registered');
};

// Token symbol resolver
function resolveTokenSymbol(address: string): string {
  const known: Record<string, string> = {
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
    '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
    '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
  };
  return known[address?.toLowerCase()] || `${address?.slice(0, 6)}...${address?.slice(-4)}`;
}

export default actorDetailRoutes;
