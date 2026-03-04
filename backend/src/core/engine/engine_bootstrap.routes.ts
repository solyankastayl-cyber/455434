/**
 * Engine Bootstrap Routes
 * 
 * Mass generation endpoints for P3 unblocking:
 * - Bootstrap different SignalContext regimes
 * - Generate Live decisions in bulk
 * - Create variance in ML training data
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildEngineInput } from './engine_input.service.js';
import { generateDecisionV1_1 } from './engine_decision_v1_1.service.js';
import { EngineDecisionModel } from './engine_decision.model.js';
import { SignalContextModel } from '../signals/signal_context.model.js';
import { ActorSignalModel } from '../signals/actor_signal.model.js';
import { EntityModel } from '../entities/entities.model.js';
import { TokenRegistryModel } from '../resolver/token_registry.model.js';

export async function engineBootstrapRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/engine/bootstrap/contexts
   * Create bootstrap contexts with different regimes
   * 
   * Regimes:
   * - high_inflow: inflow ↑ → evidence ↑
   * - high_outflow: outflow ↑ → direction ↓
   * - corridor_spike: actor↔actor → conflict ↑
   * - multi_actor: ≥3 actors → coverage ↑
   * - sparse: few signals → coverage ↓
   */
  app.post('/engine/bootstrap/contexts', async (request: FastifyRequest) => {
    const body = request.body as {
      regimes?: string[];
      tokensPerRegime?: number;
    };
    
    const regimes = body.regimes || ['high_inflow', 'high_outflow', 'corridor_spike', 'multi_actor', 'sparse'];
    const tokensPerRegime = body.tokensPerRegime || 3;
    
    try {
      const results: any = {
        regimes: {},
        totalCreated: 0,
      };
      
      // Get some entities for bootstrap
      const entities = await EntityModel.find({}).limit(10).lean();
      
      // Hardcoded token addresses for bootstrap (real Ethereum tokens)
      const knownTokens = [
        { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', tokenId: 'usdt' },
        { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', tokenId: 'usdc' },
        { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH', tokenId: 'weth' },
        { address: '0x6b175474e89094c44da98b954eedeac495271d0f', symbol: 'DAI', tokenId: 'dai' },
        { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', symbol: 'WBTC', tokenId: 'wbtc' },
      ];
      
      if (entities.length === 0) {
        return {
          ok: false,
          error: 'No entities found. Please run seed first.',
        };
      }
      
      for (const regime of regimes) {
        let created = 0;
        
        // Select tokens for this regime
        const selectedTokens = knownTokens.slice(0, Math.min(tokensPerRegime, knownTokens.length));
        
        for (const token of selectedTokens) {
          
          // Create context based on regime
          const contextData: any = {
            window: '24h',
            primarySignal: {
              type: regime === 'corridor_spike' ? 'corridor_volume_spike' : 'token_flow_deviation',
              sourceType: 'token',
              sourceId: token.tokenId,
              deviation: regime === 'high_inflow' ? 2.5 : regime === 'high_outflow' ? -2.0 : 1.5,
              severity: regime === 'multi_actor' ? 'high' : regime === 'sparse' ? 'low' : 'medium',
            },
            relatedSignals: {
              tokens: [{
                tokenId: token.tokenId,
                symbol: token.symbol,
                signalType: 'flow_deviation',
                deviation: regime === 'high_inflow' ? 2.5 : -1.5,
              }],
              actors: [],
              corridors: [],
            },
            overlapScore: regime === 'multi_actor' ? 5 : regime === 'sparse' ? 2 : 3,
            affectedAssets: [token.symbol],
            involvedActors: [],
            summary: `Bootstrap ${regime} context for ${token.symbol}`,
            narrativeHint: `${regime.replace('_', ' ')} pattern detected`,
            detectedAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            status: 'active',
          };
          
          // Add actors based on regime
          if (regime === 'multi_actor' && entities.length >= 3) {
            const selectedEntities = entities.slice(0, 3);
            contextData.involvedActors = selectedEntities.map((e: any) => e.slug);
            contextData.relatedSignals.actors = selectedEntities.map((e: any) => ({
              actorId: e._id.toString(),
              slug: e.slug,
              signalType: 'flow_deviation',
              deviation: 1.8,
            }));
          } else if (regime === 'corridor_spike' && entities.length >= 2) {
            const selectedEntities = entities.slice(0, 2);
            contextData.involvedActors = selectedEntities.map((e: any) => e.slug);
            contextData.relatedSignals.corridors = [{
              from: selectedEntities[0].slug,
              to: selectedEntities[1].slug,
              signalType: 'volume_spike',
              volumeUsd: 5000000,
            }];
          }
          
          // Create context
          await SignalContextModel.create(contextData);
          created++;
        }
        
        results.regimes[regime] = { created };
        results.totalCreated += created;
      }
      
      return {
        ok: true,
        data: results,
        message: `Created ${results.totalCreated} bootstrap contexts across ${regimes.length} regimes`,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to create bootstrap contexts',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/engine/bootstrap/decisions
   * Generate decisions in bulk for different regimes
   * 
   * Strategy:
   * - 20 decisions per regime
   * - Different tokens
   * - Different windows (1h, 6h, 24h)
   * 
   * Goal: Create variance > 0, unlock P3
   */
  app.post('/engine/bootstrap/decisions', async (request: FastifyRequest) => {
    const body = request.body as {
      decisionsPerRegime?: number;
      windows?: string[];
    };
    
    const decisionsPerRegime = body.decisionsPerRegime || 20;
    const windows = body.windows || ['1h', '6h', '24h'];
    
    try {
      // Get active contexts
      const contexts = await SignalContextModel.find({ status: 'active' }).limit(100).lean();
      
      if (contexts.length === 0) {
        return {
          ok: false,
          error: 'No active contexts found. Run /bootstrap/contexts first.',
        };
      }
      
      const results: any = {
        total: 0,
        byDecision: { NEUTRAL: 0, BUY: 0, SELL: 0 },
        byWindow: {} as Record<string, number>,
        coverageStats: {
          min: 100,
          max: 0,
          avg: 0,
          variance: 0,
        },
      };
      
      const coverages: number[] = [];
      let generated = 0;
      
      // Generate decisions for each context
      for (const context of contexts) {
        if (generated >= decisionsPerRegime * windows.length) break;
        
        const c = context as any;
        const asset = c.affectedAssets?.[0];
        if (!asset) continue;
        
        const window = windows[generated % windows.length] as any;
        
        try {
          // Build input
          const input = await buildEngineInput(asset, window);
          
          // Generate decision
          const decision = await generateDecisionV1_1(input);
          
          // Track stats
          results.total++;
          results.byDecision[decision.decision]++;
          results.byWindow[window] = (results.byWindow[window] || 0) + 1;
          
          const coverage = input.coverage.overall;
          coverages.push(coverage);
          results.coverageStats.min = Math.min(results.coverageStats.min, coverage);
          results.coverageStats.max = Math.max(results.coverageStats.max, coverage);
          
          generated++;
        } catch (err) {
          // Skip on error
          continue;
        }
      }
      
      // Calculate coverage stats
      if (coverages.length > 0) {
        const sum = coverages.reduce((a, b) => a + b, 0);
        const avg = sum / coverages.length;
        results.coverageStats.avg = Math.round(avg * 10) / 10;
        
        // Variance
        const variance = coverages.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / coverages.length;
        results.coverageStats.variance = Math.round(variance * 100) / 100;
      }
      
      return {
        ok: true,
        data: results,
        message: `Generated ${results.total} decisions. Coverage variance: ${results.coverageStats.variance}`,
        p3Status: results.coverageStats.variance > 0 ? '✅ P3 UNBLOCKED' : '⚠️ More diversity needed',
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to generate bootstrap decisions',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/engine/bootstrap/status
   * Check P3 unlock status
   */
  app.get('/engine/bootstrap/status', async () => {
    try {
      const [
        totalContexts,
        totalDecisions,
        decisionsByType,
        coverageStats,
      ] = await Promise.all([
        SignalContextModel.countDocuments({ status: 'active' }),
        EngineDecisionModel.countDocuments(),
        EngineDecisionModel.aggregate([
          { $group: { _id: '$decision', count: { $sum: 1 } } },
        ]),
        EngineDecisionModel.aggregate([
          { 
            $group: { 
              _id: null, 
              minCoverage: { $min: '$coverage.overall' },
              maxCoverage: { $max: '$coverage.overall' },
              avgCoverage: { $avg: '$coverage.overall' },
            } 
          },
        ]),
      ]);
      
      const decisions: Record<string, number> = {};
      for (const item of decisionsByType) {
        decisions[item._id] = item.count;
      }
      
      const coverage = coverageStats[0] || { minCoverage: 0, maxCoverage: 0, avgCoverage: 0 };
      const coverageRange = coverage.maxCoverage - coverage.minCoverage;
      
      // P3 unlock criteria
      const criteria = {
        totalDecisions: totalDecisions >= 300,
        coverageVariance: coverageRange > 0,
        decisionDiversity: Object.keys(decisions).length >= 2,
      };
      
      const p3Unlocked = criteria.totalDecisions && criteria.coverageVariance && criteria.decisionDiversity;
      
      return {
        ok: true,
        data: {
          contexts: {
            total: totalContexts,
            active: totalContexts,
          },
          decisions: {
            total: totalDecisions,
            byType: decisions,
          },
          coverage: {
            min: Math.round(coverage.minCoverage * 10) / 10,
            max: Math.round(coverage.maxCoverage * 10) / 10,
            avg: Math.round(coverage.avgCoverage * 10) / 10,
            range: Math.round(coverageRange * 10) / 10,
            variance: coverageRange,
          },
          p3: {
            unlocked: p3Unlocked,
            criteria,
            status: p3Unlocked ? '✅ P3 ACTIVE' : '⚠️ P3 BLOCKED',
          },
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get bootstrap status',
        details: err.message,
      };
    }
  });
  
  app.log.info('[Engine Bootstrap] Routes registered');
}
