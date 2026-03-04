/**
 * ADVANCED ALT SCANNER ROUTES (Blocks 17-28)
 * ==========================================
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

// Block 17: Shadow Portfolio
import { shadowPortfolioService } from '../shadow/shadow-portfolio.service.js';

// Block 18: Failure Analysis
import { failureAnalysisService } from '../failure/failure-analysis.service.js';

// Block 19: Adaptive Gating
import { adaptiveGatingService } from '../gating/adaptive-gating.service.js';

// Block 20: Alt Opportunity Engine
import { altOpportunityEngine } from '../alt-opps/alt-opps.engine.js';

// Block 21: Portfolio Filter
import { portfolioFilterService } from '../portfolio-filter/portfolio-filter.service.js';

// Block 23: Pattern Memory
import { patternMemoryService } from '../pattern-memory/pattern-memory.service.js';

// Block 24: Propagation
import { patternPropagationService } from '../propagation/propagation.service.js';

// Block 25: Sector/Regime Overlay
import { sectorRegimeOverlayService } from '../sector-regime/sector-regime.service.js';

// Block 26: Portfolio Construction
import { portfolioConstructionService } from '../portfolio-construct/portfolio-construct.service.js';

// Block 27: Strategy Survival
import { strategySurvivalService } from '../strategy-survival/strategy-survival.service.js';

// Core
import { altScannerService } from '../alt-scanner.service.js';
import { clusterFeatureBuilder } from '../ml/feature-builder.service.js';

// Data Collection Job
import { 
  startDataCollection, 
  stopDataCollection, 
  getCollectionStats 
} from '../jobs/data-collection.job.js';

// ML Model
import { clusterOutcomeModel } from '../ml/cluster-outcome.model.js';

// MongoDB Repositories
import { 
  clusterSampleRepo, 
  shadowTradeRepo, 
  snapshotRepo,
  patternPerfRepo,
} from '../db/alt-scanner.repo.js';

// ═══════════════════════════════════════════════════════════════
// ADVANCED ROUTES REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerAdvancedAltRoutes(app: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // DATA COLLECTION JOB
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/collector/status', async () => {
    const stats = getCollectionStats();
    const mlStats = clusterOutcomeModel.getStats();
    
    return {
      ok: true,
      collector: stats,
      mlModel: mlStats,
    };
  });

  app.post('/api/v10/admin/alt-scanner/collector/start', async () => {
    startDataCollection();
    return {
      ok: true,
      message: 'Data collection started',
    };
  });

  app.post('/api/v10/admin/alt-scanner/collector/stop', async () => {
    stopDataCollection();
    return {
      ok: true,
      message: 'Data collection stopped',
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // MONGODB DATA ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/db/samples', async (req: FastifyRequest<{
    Querystring: { limit?: string };
  }>) => {
    const limit = parseInt(req.query.limit ?? '100');
    try {
      const [samples, count, countByOutcome] = await Promise.all([
        clusterSampleRepo.getRecent(limit),
        clusterSampleRepo.count(),
        clusterSampleRepo.countByOutcome(),
      ]);
      
      return {
        ok: true,
        totalCount: count,
        countByOutcome,
        samples: samples.slice(0, limit),
      };
    } catch (err) {
      return { ok: false, error: 'Database error' };
    }
  });

  app.get('/api/v10/alt-scanner/db/trades', async (req: FastifyRequest<{
    Querystring: { status?: 'OPEN' | 'CLOSED'; limit?: string };
  }>) => {
    const limit = parseInt(req.query.limit ?? '50');
    try {
      const trades = req.query.status === 'OPEN'
        ? await shadowTradeRepo.getOpen()
        : await shadowTradeRepo.getRecent(limit);
      
      const metrics = await shadowTradeRepo.getMetrics('30d');
      
      return {
        ok: true,
        metrics,
        trades,
      };
    } catch (err) {
      return { ok: false, error: 'Database error' };
    }
  });

  app.get('/api/v10/alt-scanner/db/snapshots', async (req: FastifyRequest<{
    Querystring: { days?: string };
  }>) => {
    const days = parseInt(req.query.days ?? '7');
    try {
      const snapshots = await snapshotRepo.getRecent(days);
      return {
        ok: true,
        count: snapshots.length,
        snapshots,
      };
    } catch (err) {
      return { ok: false, error: 'Database error' };
    }
  });

  app.get('/api/v10/alt-scanner/db/patterns', async () => {
    try {
      const [all, top] = await Promise.all([
        patternPerfRepo.getAll(),
        patternPerfRepo.getTop(10),
      ]);
      
      return {
        ok: true,
        totalPatterns: all.length,
        topPatterns: top,
      };
    } catch (err) {
      return { ok: false, error: 'Database error' };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 17: SHADOW PORTFOLIO
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/shadow/trades', async (req: FastifyRequest<{
    Querystring: { limit?: string };
  }>) => {
    const limit = parseInt(req.query.limit ?? '50');
    return {
      ok: true,
      trades: shadowPortfolioService.getTrades(limit),
      openTrades: shadowPortfolioService.getOpenTrades(),
    };
  });

  app.get('/api/v10/alt-scanner/shadow/metrics', async (req: FastifyRequest<{
    Querystring: { period?: '7d' | '30d' | 'all' };
  }>) => {
    const period = req.query.period ?? '30d';
    return {
      ok: true,
      metrics: shadowPortfolioService.calculateMetrics(period),
    };
  });

  app.get('/api/v10/alt-scanner/shadow/outcomes', async (req: FastifyRequest<{
    Querystring: { limit?: string };
  }>) => {
    const limit = parseInt(req.query.limit ?? '50');
    return {
      ok: true,
      outcomes: shadowPortfolioService.getOutcomes(limit),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 18: FAILURE ANALYSIS
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/failures', async (req: FastifyRequest<{
    Querystring: { limit?: string };
  }>) => {
    const limit = parseInt(req.query.limit ?? '50');
    return {
      ok: true,
      failures: failureAnalysisService.getFailedTrades(limit),
      insights: failureAnalysisService.getInsights(),
    };
  });

  app.get('/api/v10/alt-scanner/failures/heatmap', async () => {
    return {
      ok: true,
      heatmap: failureAnalysisService.buildHeatmap(),
    };
  });

  app.get('/api/v10/alt-scanner/failures/clusters-to-freeze', async () => {
    return {
      ok: true,
      clusters: failureAnalysisService.getClustersToFreeze(),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 19: ADAPTIVE GATING
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/gating/blocks', async () => {
    return {
      ok: true,
      blocks: adaptiveGatingService.getBlocks(),
    };
  });

  app.post('/api/v10/admin/alt-scanner/gating/block-asset', async (req: FastifyRequest<{
    Body: { asset: string; durationHours?: number };
  }>) => {
    const duration = (req.body.durationHours ?? 4) * 60 * 60 * 1000;
    adaptiveGatingService.blockAsset(req.body.asset, duration);
    return {
      ok: true,
      message: `Asset ${req.body.asset} blocked`,
    };
  });

  app.post('/api/v10/admin/alt-scanner/gating/block-cluster', async (req: FastifyRequest<{
    Body: { clusterId: string };
  }>) => {
    adaptiveGatingService.blockCluster(req.body.clusterId);
    return {
      ok: true,
      message: `Cluster ${req.body.clusterId} blocked`,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 20: ALT OPPORTUNITY ENGINE
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/aoe', async (req: FastifyRequest<{
    Querystring: { minScore?: string; maxRank?: string };
  }>) => {
    const result = await altScannerService.scan();
    const marketContext = clusterFeatureBuilder.buildMarketContext();
    
    const aoeResult = altOpportunityEngine.run(
      result.ranking.opportunities,
      result.clustering.clusters,
      marketContext,
      result.radar.venue,
      {
        minScore: parseInt(req.query.minScore ?? '50'),
        maxRank: parseInt(req.query.maxRank ?? '20'),
      }
    );
    
    return aoeResult;
  });

  app.get('/api/v10/alt-scanner/aoe/weights', async () => {
    return {
      ok: true,
      weights: altOpportunityEngine.getWeights(),
    };
  });

  app.post('/api/v10/admin/alt-scanner/aoe/weights', async (req: FastifyRequest<{
    Body: { pattern?: number; momentum?: number; context?: number; timing?: number; liquidity?: number; history?: number };
  }>) => {
    altOpportunityEngine.setWeights(req.body);
    return {
      ok: true,
      weights: altOpportunityEngine.getWeights(),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 21: PORTFOLIO FILTER
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/portfolio-slate', async (req: FastifyRequest<{
    Querystring: { maxPicks?: string };
  }>) => {
    const result = await altScannerService.scan();
    const marketContext = clusterFeatureBuilder.buildMarketContext();
    
    // Run through AOE first
    const aoeResult = altOpportunityEngine.run(
      result.ranking.opportunities,
      result.clustering.clusters,
      marketContext,
      result.radar.venue
    );
    
    // Then filter for portfolio
    const maxPicks = parseInt(req.query.maxPicks ?? '10');
    const slate = portfolioFilterService.createSlate(
      aoeResult.opportunities,
      maxPicks,
      result.radar.venue
    );
    
    return {
      ok: true,
      slate,
    };
  });

  app.get('/api/v10/alt-scanner/portfolio-slate/constraints', async () => {
    return {
      ok: true,
      constraints: portfolioFilterService.getConstraints(),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 23: PATTERN MEMORY
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/pattern-memory', async (req: FastifyRequest<{
    Querystring: { minTrades?: string; minHitRate?: string };
  }>) => {
    const stats = patternMemoryService.getStats();
    const records = patternMemoryService.query({
      minTrades: parseInt(req.query.minTrades ?? '5'),
      minHitRate: parseFloat(req.query.minHitRate ?? '0'),
    });
    
    return {
      ok: true,
      stats,
      records: records.slice(0, 50),
    };
  });

  app.get('/api/v10/alt-scanner/pattern-memory/:patternId', async (req: FastifyRequest<{
    Params: { patternId: string };
  }>, res) => {
    const record = patternMemoryService.getRecord(req.params.patternId);
    
    if (!record) {
      return res.status(404).send({ ok: false, error: 'Pattern not found' });
    }
    
    return {
      ok: true,
      record,
    };
  });

  app.get('/api/v10/alt-scanner/pattern-memory/outcomes', async (req: FastifyRequest<{
    Querystring: { limit?: string };
  }>) => {
    const limit = parseInt(req.query.limit ?? '100');
    return {
      ok: true,
      outcomes: patternMemoryService.getRecentOutcomes(limit),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 24: PROPAGATION
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/propagation', async () => {
    const result = await altScannerService.scan();
    const marketContext = clusterFeatureBuilder.buildMarketContext();
    
    const propagation = patternPropagationService.scan(
      result.ranking.opportunities,
      result.clustering.clusters,
      marketContext,
      result.radar.venue
    );
    
    return propagation;
  });

  app.get('/api/v10/alt-scanner/propagation/active', async () => {
    const active = patternPropagationService.getActivePropagations();
    return {
      ok: true,
      propagations: Array.from(active.entries()).map(([patternId, count]) => ({
        patternId,
        moveCount: count,
      })),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 25: SECTOR/REGIME OVERLAY
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/sector-regime', async () => {
    const marketContext = clusterFeatureBuilder.buildMarketContext();
    const analysis = sectorRegimeOverlayService.analyze(marketContext);
    return analysis;
  });

  app.get('/api/v10/alt-scanner/sector-regime/multiplier/:symbol', async (req: FastifyRequest<{
    Params: { symbol: string };
  }>) => {
    const multiplier = sectorRegimeOverlayService.getMultiplier(req.params.symbol);
    const recommendation = sectorRegimeOverlayService.getRecommendation(req.params.symbol);
    
    return {
      ok: true,
      symbol: req.params.symbol,
      multiplier,
      recommendation,
      currentRegime: sectorRegimeOverlayService.getCurrentRegime(),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 26: PORTFOLIO CONSTRUCTION
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/portfolio-construct', async (req: FastifyRequest<{
    Querystring: { capital?: string };
  }>) => {
    const result = await altScannerService.scan();
    const marketContext = clusterFeatureBuilder.buildMarketContext();
    
    // Full pipeline: AOE -> Filter -> Construct
    const aoeResult = altOpportunityEngine.run(
      result.ranking.opportunities,
      result.clustering.clusters,
      marketContext,
      result.radar.venue
    );
    
    const slate = portfolioFilterService.createSlate(
      aoeResult.opportunities,
      10,
      result.radar.venue
    );
    
    const capital = parseInt(req.query.capital ?? '10000');
    const portfolio = portfolioConstructionService.construct(
      slate,
      marketContext,
      capital,
      result.radar.venue
    );
    
    return portfolio;
  });

  app.get('/api/v10/alt-scanner/portfolio-construct/config', async () => {
    return {
      ok: true,
      constraints: portfolioConstructionService.getConstraints(),
      weighting: portfolioConstructionService.getWeighting(),
    };
  });

  app.post('/api/v10/admin/alt-scanner/portfolio-construct/config', async (req: FastifyRequest<{
    Body: { 
      constraints?: Record<string, number>;
      weighting?: { scheme?: string; kellyFraction?: number };
    };
  }>) => {
    if (req.body.constraints) {
      portfolioConstructionService.setConstraints(req.body.constraints as any);
    }
    if (req.body.weighting) {
      portfolioConstructionService.setWeighting(req.body.weighting as any);
    }
    return {
      ok: true,
      constraints: portfolioConstructionService.getConstraints(),
      weighting: portfolioConstructionService.getWeighting(),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 27: STRATEGY SURVIVAL
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/strategies', async () => {
    const evaluation = strategySurvivalService.evaluate();
    return evaluation;
  });

  app.get('/api/v10/alt-scanner/strategies/:id', async (req: FastifyRequest<{
    Params: { id: string };
  }>, res) => {
    const strategy = strategySurvivalService.getStrategy(req.params.id);
    const performance = strategySurvivalService.getPerformance(req.params.id);
    
    if (!strategy) {
      return res.status(404).send({ ok: false, error: 'Strategy not found' });
    }
    
    return {
      ok: true,
      strategy,
      performance,
    };
  });

  app.post('/api/v10/admin/alt-scanner/strategies', async (req: FastifyRequest<{
    Body: { name: string; description: string; patternIds: string[]; sectors?: string[] };
  }>) => {
    const strategy = strategySurvivalService.registerStrategy(
      req.body.name,
      req.body.description,
      req.body.patternIds,
      req.body.sectors ?? []
    );
    
    return {
      ok: true,
      strategy,
    };
  });

  app.post('/api/v10/admin/alt-scanner/strategies/:id/pause', async (req: FastifyRequest<{
    Params: { id: string };
    Body: { reason: string };
  }>, res) => {
    const success = strategySurvivalService.pauseStrategy(req.params.id, req.body.reason);
    
    if (!success) {
      return res.status(404).send({ ok: false, error: 'Strategy not found or cannot be paused' });
    }
    
    return {
      ok: true,
      message: 'Strategy paused',
    };
  });

  app.post('/api/v10/admin/alt-scanner/strategies/:id/activate', async (req: FastifyRequest<{
    Params: { id: string };
  }>, res) => {
    const success = strategySurvivalService.activateStrategy(req.params.id);
    
    if (!success) {
      return res.status(404).send({ ok: false, error: 'Strategy not found or cannot be activated' });
    }
    
    return {
      ok: true,
      message: 'Strategy activated',
    };
  });

  app.get('/api/v10/alt-scanner/strategies/decisions', async (req: FastifyRequest<{
    Querystring: { limit?: string };
  }>) => {
    const limit = parseInt(req.query.limit ?? '20');
    return {
      ok: true,
      decisions: strategySurvivalService.getDecisionHistory(limit),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 22: UNIFIED RADAR (for UI)
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/v10/alt-scanner/radar-full', async (req: FastifyRequest<{
    Querystring: { capital?: string };
  }>) => {
    const result = await altScannerService.scan();
    const marketContext = clusterFeatureBuilder.buildMarketContext();
    const capital = parseInt(req.query.capital ?? '10000');
    
    // Run full pipeline
    const aoeResult = altOpportunityEngine.run(
      result.ranking.opportunities,
      result.clustering.clusters,
      marketContext,
      result.radar.venue,
      { minScore: 0, maxRank: 50 } // Lower threshold for UI display
    );
    
    const slate = portfolioFilterService.createSlate(
      aoeResult.opportunities,
      10,
      result.radar.venue
    );
    
    const portfolio = portfolioConstructionService.construct(
      slate,
      marketContext,
      capital,
      result.radar.venue
    );
    
    const propagation = patternPropagationService.scan(
      result.ranking.opportunities,
      result.clustering.clusters,
      marketContext,
      result.radar.venue
    );
    
    const sectorRegime = sectorRegimeOverlayService.analyze(marketContext);
    
    const strategies = strategySurvivalService.evaluate();
    
    return {
      ok: true,
      asOf: Date.now(),
      venue: result.radar.venue,
      
      // Core data
      marketContext,
      
      // AOE results
      opportunities: aoeResult.opportunities.slice(0, 20),
      avgScore: aoeResult.avgScore,
      dominantDirection: aoeResult.dominantDirection,
      
      // Portfolio
      portfolio: portfolio.portfolio,
      actionItems: portfolio.actionItems,
      warnings: portfolio.warnings,
      
      // Propagation signals
      propagationSignals: propagation.signals.slice(0, 5),
      
      // Sector/Regime
      currentRegime: sectorRegime.currentRegime,
      preferredSectors: sectorRegime.regimeOverlay.preferredSectors,
      avoidSectors: sectorRegime.regimeOverlay.avoidSectors,
      
      // Strategy health
      strategyHealth: strategies.systemHealth,
      activeStrategies: strategies.activeStrategies,
      
      // Shadow performance
      shadowMetrics: shadowPortfolioService.getMetrics(),
    };
  });

  console.log('[AltScanner] Advanced routes registered (Blocks 17-28)');
}
