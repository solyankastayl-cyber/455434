/**
 * Engine Signals Routes (Layer 1)
 * 
 * API endpoints for Engine signals and rankings.
 * 
 * Endpoints:
 * - GET /api/engine-signals              - List active signals
 * - GET /api/engine-signals/:id          - Get signal details
 * - POST /api/engine-signals/scan        - Trigger signal scan
 * - GET /api/engine-signals/rankings/accumulation - Top tokens by accumulation
 * - GET /api/engine-signals/rankings/smart-money  - Top tokens by smart money overlap
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { EngineSignalModel } from './engine_signal.model.js';
import {
  runCoordinatedAccumulationScan,
  scanForCoordinatedAccumulation,
  analyzeTokenAccumulation,
} from './coordinated_accumulation.service.js';
import {
  runSmartMoneyOverlapScan,
  analyzeSmartMoneyOverlap,
  getTopWalletsByVolume,
} from './smart_money_overlap.service.js';

export async function engineSignalsRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/engine-signals
   * List active engine signals
   */
  app.get('/engine-signals', async (request: FastifyRequest) => {
    const query = request.query as {
      type?: string;
      chainId?: string;
      status?: string;
      limit?: string;
    };
    
    const filter: any = {};
    
    if (query.type) {
      filter.signalType = query.type;
    }
    
    if (query.chainId) {
      filter.chainId = parseInt(query.chainId);
    }
    
    filter.status = query.status || 'active';
    
    const limit = Math.min(parseInt(query.limit || '50'), 100);
    
    const signals = await EngineSignalModel.find(filter)
      .sort({ score: -1, detectedAt: -1 })
      .limit(limit)
      .select('-__v')
      .lean();
    
    // Get counts by type
    const counts = await EngineSignalModel.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$signalType', count: { $sum: 1 } } },
    ]);
    
    const countByType = counts.reduce((acc, c) => {
      acc[c._id] = c.count;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      ok: true,
      data: {
        signals: signals.map((s: any) => ({
          id: s.signalId,
          type: s.signalType,
          targetType: s.targetType,
          targetAddress: s.targetAddress,
          targetSymbol: s.targetSymbol,
          chainId: s.chainId,
          strength: s.strength,
          score: s.score,
          evidence: s.evidence,
          detectedAt: s.detectedAt,
          expiresAt: s.expiresAt,
          status: s.status,
        })),
        count: signals.length,
        countByType,
      },
      meta: {
        layer: 'L1',
        disclaimer: 'Rule-based signals, not predictions',
      },
    };
  });
  
  /**
   * GET /api/engine-signals/:id
   * Get signal details
   */
  app.get('/engine-signals/:id', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const signal = await EngineSignalModel.findOne({ signalId: id }).lean();
    
    if (!signal) {
      return {
        ok: false,
        error: 'SIGNAL_NOT_FOUND',
      };
    }
    
    const s = signal as any;
    
    return {
      ok: true,
      data: {
        id: s.signalId,
        type: s.signalType,
        targetType: s.targetType,
        targetAddress: s.targetAddress,
        targetSymbol: s.targetSymbol,
        chainId: s.chainId,
        strength: s.strength,
        score: s.score,
        evidence: s.evidence,
        triggeredBy: s.triggeredBy,
        windowStart: s.windowStart,
        windowEnd: s.windowEnd,
        detectedAt: s.detectedAt,
        expiresAt: s.expiresAt,
        status: s.status,
      },
    };
  });
  
  /**
   * POST /api/engine-signals/scan
   * Trigger signal scan (admin)
   */
  app.post('/engine-signals/scan', async (request: FastifyRequest) => {
    const body = request.body as {
      type?: string;
      chainId?: number;
      timeWindowHours?: number;
    };
    
    const chainId = body.chainId || 1;
    const timeWindowHours = body.timeWindowHours || 24;
    const signalType = body.type || 'all';
    
    const results: any = {
      chainId,
      timeWindowHours,
      scans: {},
    };
    
    if (signalType === 'all' || signalType === 'coordinated_accumulation') {
      results.scans.coordinated_accumulation = await runCoordinatedAccumulationScan(
        chainId,
        timeWindowHours
      );
    }
    
    if (signalType === 'all' || signalType === 'smart_money_overlap') {
      results.scans.smart_money_overlap = await runSmartMoneyOverlapScan(
        chainId,
        timeWindowHours
      );
    }
    
    return {
      ok: true,
      data: results,
    };
  });
  
  // ============ RANKINGS ENDPOINTS ============
  
  /**
   * GET /api/engine-signals/rankings/accumulation
   * Top tokens by coordinated accumulation pattern
   */
  app.get('/engine-signals/rankings/accumulation', async (request: FastifyRequest) => {
    const query = request.query as {
      chainId?: string;
      timeWindow?: string;
      limit?: string;
    };
    
    const chainId = parseInt(query.chainId || '1');
    const limit = Math.min(parseInt(query.limit || '20'), 50);
    
    // Parse time window
    let timeWindowHours = 24;
    if (query.timeWindow === '7d') timeWindowHours = 168;
    if (query.timeWindow === '30d') timeWindowHours = 720;
    
    // Get patterns (live analysis)
    const patterns = await scanForCoordinatedAccumulation(chainId, timeWindowHours, limit);
    
    return {
      ok: true,
      data: {
        rankings: patterns.slice(0, limit).map((p, index) => ({
          rank: index + 1,
          tokenAddress: p.tokenAddress,
          tokenSymbol: p.tokenSymbol,
          chainId: p.chainId,
          accumulatorCount: p.totalAccumulators,
          combinedVolumeShare: Math.round(p.combinedVolumeShare * 100) / 100,
          score: p.score,
          strength: p.strength,
          topAccumulators: p.accumulators.slice(0, 3).map(a => ({
            address: a.address,
            netFlowPercent: Math.round(a.netFlowPercent * 100) / 100,
            volumeShare: Math.round(a.volumeShare * 100) / 100,
          })),
        })),
        timeWindow: query.timeWindow || '24h',
        chainId,
        count: patterns.length,
      },
      meta: {
        layer: 'L1',
        rule: 'coordinated_accumulation_v1',
        description: 'Tokens ranked by coordinated accumulation patterns',
        disclaimer: 'Rule-based ranking, not investment advice',
      },
    };
  });
  
  /**
   * GET /api/engine-signals/rankings/smart-money
   * Top tokens by smart money overlap
   */
  app.get('/engine-signals/rankings/smart-money', async (request: FastifyRequest) => {
    const query = request.query as {
      chainId?: string;
      timeWindow?: string;
      limit?: string;
    };
    
    const chainId = parseInt(query.chainId || '1');
    const limit = Math.min(parseInt(query.limit || '20'), 50);
    
    // Parse time window
    let timeWindowHours = 168; // Default 7d for smart money
    if (query.timeWindow === '24h') timeWindowHours = 24;
    if (query.timeWindow === '30d') timeWindowHours = 720;
    
    // Get overlaps (live analysis)
    const overlaps = await analyzeSmartMoneyOverlap(chainId, timeWindowHours);
    
    return {
      ok: true,
      data: {
        rankings: overlaps.slice(0, limit).map((o, index) => ({
          rank: index + 1,
          tokenAddress: o.tokenAddress,
          tokenSymbol: o.tokenSymbol,
          chainId: o.chainId,
          smartMoneyCount: o.overlapCount,
          overlapPercent: Math.round(o.overlapPercent * 100) / 100,
          score: o.score,
          strength: o.strength,
          topWallets: o.smartMoneyWallets.slice(0, 3),
        })),
        timeWindow: query.timeWindow || '7d',
        chainId,
        count: overlaps.length,
      },
      meta: {
        layer: 'L1',
        rule: 'smart_money_overlap_v1',
        description: 'Tokens ranked by smart money wallet overlap',
        disclaimer: 'Rule-based ranking, not investment advice',
      },
    };
  });
  
  /**
   * GET /api/engine-signals/rankings/wallets
   * Top wallets by volume (smart money candidates)
   */
  app.get('/engine-signals/rankings/wallets', async (request: FastifyRequest) => {
    const query = request.query as {
      chainId?: string;
      timeWindow?: string;
      limit?: string;
    };
    
    const chainId = parseInt(query.chainId || '1');
    const limit = Math.min(parseInt(query.limit || '20'), 100);
    
    // Parse time window
    let timeWindowHours = 168; // Default 7d
    if (query.timeWindow === '24h') timeWindowHours = 24;
    if (query.timeWindow === '30d') timeWindowHours = 720;
    
    // Get top wallets
    const wallets = await getTopWalletsByVolume(chainId, timeWindowHours, limit);
    
    return {
      ok: true,
      data: {
        rankings: wallets.map((w, index) => ({
          rank: index + 1,
          address: w.address,
          shortAddress: `${w.address.slice(0, 6)}...${w.address.slice(-4)}`,
          totalVolume: w.totalVolume,
          tokenCount: w.tokenCount,
          topTokens: w.topTokens.slice(0, 5),
        })),
        timeWindow: query.timeWindow || '7d',
        chainId,
        count: wallets.length,
      },
      meta: {
        layer: 'L1',
        description: 'Wallets ranked by trading volume',
        disclaimer: 'Volume-based ranking, not endorsement',
      },
    };
  });
  
  /**
   * GET /api/engine-signals/analyze/:tokenAddress
   * Analyze single token for patterns
   */
  app.get('/engine-signals/analyze/:tokenAddress', async (request: FastifyRequest) => {
    const { tokenAddress } = request.params as { tokenAddress: string };
    const query = request.query as {
      chainId?: string;
      timeWindow?: string;
    };
    
    const chainId = parseInt(query.chainId || '1');
    
    // Parse time window
    let timeWindowHours = 24;
    if (query.timeWindow === '7d') timeWindowHours = 168;
    if (query.timeWindow === '30d') timeWindowHours = 720;
    
    // Analyze accumulation
    const accumulation = await analyzeTokenAccumulation(chainId, tokenAddress, timeWindowHours);
    
    // Get active signals for this token
    const activeSignals = await EngineSignalModel.find({
      targetAddress: tokenAddress.toLowerCase(),
      status: 'active',
    }).lean();
    
    return {
      ok: true,
      data: {
        tokenAddress: tokenAddress.toLowerCase(),
        chainId,
        timeWindow: query.timeWindow || '24h',
        accumulation: accumulation ? {
          totalAccumulators: accumulation.totalAccumulators,
          combinedVolumeShare: accumulation.combinedVolumeShare,
          score: accumulation.score,
          strength: accumulation.strength,
          topAccumulators: accumulation.accumulators.slice(0, 5),
        } : null,
        activeSignals: activeSignals.map((s: any) => ({
          id: s.signalId,
          type: s.signalType,
          score: s.score,
          strength: s.strength,
          detectedAt: s.detectedAt,
        })),
      },
      meta: {
        layer: 'L1',
        disclaimer: 'Rule-based analysis, not prediction',
      },
    };
  });
  
  /**
   * GET /api/engine-signals/stats
   * Get signal statistics
   */
  app.get('/engine-signals/stats', async () => {
    const [
      totalActive,
      byType,
      byStrength,
      recentSignals,
    ] = await Promise.all([
      EngineSignalModel.countDocuments({ status: 'active' }),
      EngineSignalModel.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$signalType', count: { $sum: 1 }, avgScore: { $avg: '$score' } } },
      ]),
      EngineSignalModel.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$strength', count: { $sum: 1 } } },
      ]),
      EngineSignalModel.find({ status: 'active' })
        .sort({ detectedAt: -1 })
        .limit(5)
        .select('signalId signalType targetSymbol score strength detectedAt')
        .lean(),
    ]);
    
    return {
      ok: true,
      data: {
        totalActive,
        byType: byType.reduce((acc, t) => {
          acc[t._id] = { count: t.count, avgScore: Math.round(t.avgScore) };
          return acc;
        }, {} as Record<string, { count: number; avgScore: number }>),
        byStrength: byStrength.reduce((acc, s) => {
          acc[s._id] = s.count;
          return acc;
        }, {} as Record<string, number>),
        recentSignals: recentSignals.map((s: any) => ({
          id: s.signalId,
          type: s.signalType,
          token: s.targetSymbol,
          score: s.score,
          strength: s.strength,
          detectedAt: s.detectedAt,
        })),
      },
    };
  });
  
  app.log.info?.('Engine Signals routes registered (Layer 1)');
}
