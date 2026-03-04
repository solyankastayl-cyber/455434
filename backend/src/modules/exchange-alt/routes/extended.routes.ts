/**
 * EXTENDED ALT SCANNER API ROUTES (Blocks 6-16)
 * ===============================================
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

// ML (Block 6)
import { clusterOutcomeModel } from '../ml/cluster-outcome.model.js';
import { patternConfidenceService } from '../ml/pattern-confidence.service.js';

// Meta-Brain (Block 7)
import { decisionComposerService } from '../meta-brain/decision-composer.service.js';

// Replay (Block 8) - Used in validation
// import { replayEngineService } from '../replay/replay-engine.service.js';

// Explain (Block 9)
import { explainBuilderService } from '../explain/explain-builder.service.js';

// Tuning (Block 10)
import { patternAutoTuningService } from '../tuning/pattern-auto-tuning.service.js';

// Alt-Sets (Block 11)
import { rankingEngineService } from '../alt-sets/ranking-engine.service.js';
import type { AltSetType } from '../alt-sets/alt-sets.types.js';

// Portfolio (Block 12)
import { portfolioSimulationService } from '../portfolio/portfolio-simulation.service.js';

// Alt Context (Block 13)
import { altContextService } from '../context/alt-context.service.js';

// ML Overlay (Block 14)
import { mlOverlayService } from '../ml-overlay/ml-overlay.service.js';

// Validation (Block 16)
import { validationService } from '../validation/validation.service.js';

// Core
import { altScannerService } from '../alt-scanner.service.js';
import { clusterFeatureBuilder } from '../ml/feature-builder.service.js';

// ═══════════════════════════════════════════════════════════════
// EXTENDED ROUTES REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerExtendedAltRoutes(app: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // BLOCK 6: ML ROUTES
  // ═══════════════════════════════════════════════════════════════

  // ML Model health
  app.get('/api/v10/alt-scanner/ml/health', async () => {
    return {
      ok: true,
      model: clusterOutcomeModel.getHealth(),
      patternStats: patternConfidenceService.getAllPatternStats().length,
      patternWeights: patternConfidenceService.getAllPatternWeights().length,
    };
  });

  // Pattern stats
  app.get('/api/v10/alt-scanner/patterns', async () => {
    return {
      ok: true,
      stats: patternConfidenceService.getAllPatternStats(),
      weights: patternConfidenceService.getAllPatternWeights(),
    };
  });

  // Pattern detail
  app.get('/api/v10/alt-scanner/patterns/:patternId', async (req: FastifyRequest<{
    Params: { patternId: string };
  }>, res) => {
    const stats = patternConfidenceService.getPatternStats(req.params.patternId);
    const weight = patternConfidenceService.getPatternWeight(req.params.patternId);
    
    if (!stats) {
      return res.status(404).send({ ok: false, error: 'Pattern not found' });
    }
    
    return {
      ok: true,
      patternId: req.params.patternId,
      stats,
      weight,
      confidence: patternConfidenceService.getPatternConfidence(req.params.patternId),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 7: META-BRAIN INTEGRATION
  // ═══════════════════════════════════════════════════════════════

  // Get alpha insights
  app.get('/api/v10/alt-scanner/alpha-insights', async (req: FastifyRequest<{
    Querystring: { limit?: string };
  }>) => {
    const result = await altScannerService.scan();
    const limit = parseInt(req.query.limit ?? '20');
    
    // Build candidates
    const candidates = await Promise.all(
      result.ranking.opportunities.slice(0, limit * 2).map(opp =>
        decisionComposerService.buildCandidate(opp)
      )
    );
    
    // Get ranked insights
    const insights = await decisionComposerService.processAndRank(candidates, limit);
    
    return {
      ok: true,
      asOf: Date.now(),
      total: insights.length,
      insights,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 9: EXPLAINABILITY
  // ═══════════════════════════════════════════════════════════════

  // Explain asset
  app.get('/api/v10/alt-scanner/explain/:symbol', async (req: FastifyRequest<{
    Params: { symbol: string };
  }>, res) => {
    const result = await altScannerService.scan();
    const symbol = req.params.symbol.toUpperCase();
    
    const opportunity = result.ranking.opportunities.find(o => o.symbol === symbol);
    if (!opportunity) {
      return res.status(404).send({ ok: false, error: 'Asset not found' });
    }
    
    const cluster = result.clustering.clusters.find(c => c.clusterId === opportunity.clusterId);
    const marketContext = clusterFeatureBuilder.buildMarketContext(opportunity.vector);
    
    const explanation = explainBuilderService.buildExplain(
      symbol,
      new Date().toISOString().split('T')[0],
      opportunity.vector,
      cluster ?? null,
      marketContext,
      opportunity.opportunityScore,
      opportunity.confidence
    );
    
    return {
      ok: true,
      explanation,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 10: AUTO-TUNING ADMIN
  // ═══════════════════════════════════════════════════════════════

  // Tuning status
  app.get('/api/v10/admin/alt-scanner/tuning', async () => {
    return {
      ok: true,
      stats: patternAutoTuningService.getSummaryStats(),
      history: patternAutoTuningService.getTuneHistory(20),
    };
  });

  // Force tuning cycle (admin)
  app.post('/api/v10/admin/alt-scanner/tuning/run', async () => {
    // Would need outcomes - simplified for now
    return {
      ok: true,
      message: 'Tuning requires replay outcomes. Use /api/v10/admin/alt-scanner/replay first.',
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 11: ALT-SETS
  // ═══════════════════════════════════════════════════════════════

  // Get alt set by type
  app.get('/api/v10/alt-scanner/alt-sets/:type', async (req: FastifyRequest<{
    Params: { type: string };
    Querystring: { limit?: string };
  }>) => {
    const result = await altScannerService.scan();
    const type = req.params.type.toUpperCase() as AltSetType;
    const limit = parseInt(req.query.limit ?? '20');
    
    const marketContext = clusterFeatureBuilder.buildMarketContext();
    
    const altSet = rankingEngineService.generateAltSet(
      type,
      result.ranking.opportunities,
      result.clustering.clusters,
      marketContext,
      result.radar.venue,
      limit
    );
    
    return {
      ok: true,
      ...altSet,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 12: PORTFOLIO SIMULATION
  // ═══════════════════════════════════════════════════════════════

  // Portfolio metrics
  app.get('/api/v10/alt-scanner/portfolio/metrics', async (req: FastifyRequest<{
    Querystring: { days?: string };
  }>) => {
    const days = parseInt(req.query.days ?? '30');
    const metrics = portfolioSimulationService.getMetrics(days);
    
    return {
      ok: true,
      windowDays: days,
      metrics,
    };
  });

  // Portfolio runs history
  app.get('/api/v10/alt-scanner/portfolio/runs', async (req: FastifyRequest<{
    Querystring: { limit?: string };
  }>) => {
    const limit = parseInt(req.query.limit ?? '20');
    const runs = portfolioSimulationService.getResults(limit);
    
    return {
      ok: true,
      total: runs.length,
      runs,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 13: ALT CONTEXT
  // ═══════════════════════════════════════════════════════════════

  // Current alt context
  app.get('/api/v10/alt-scanner/context', async () => {
    const result = await altScannerService.scan();
    const marketContext = clusterFeatureBuilder.buildMarketContext();
    
    // Build context from alt-set entries
    const altSet = rankingEngineService.generateAltSet(
      'MIXED',
      result.ranking.opportunities,
      result.clustering.clusters,
      marketContext,
      result.radar.venue,
      50
    );
    
    const context = altContextService.buildContext(altSet.entries, marketContext);
    
    return {
      ok: true,
      context,
      influence: altContextService.calculateInfluence(context, 0.5),
    };
  });

  // Context history
  app.get('/api/v10/alt-scanner/context/history', async (req: FastifyRequest<{
    Querystring: { limit?: string };
  }>) => {
    const limit = parseInt(req.query.limit ?? '50');
    const snapshots = altContextService.getSnapshots(limit);
    
    return {
      ok: true,
      total: snapshots.length,
      snapshots,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 14: ML OVERLAY STATUS
  // ═══════════════════════════════════════════════════════════════

  // ML overlay status
  app.get('/api/v10/alt-scanner/ml-overlay/status', async () => {
    return {
      ok: true,
      ...mlOverlayService.getStatus(),
    };
  });

  // Toggle ML overlay
  app.post('/api/v10/admin/alt-scanner/ml-overlay/toggle', async (req: FastifyRequest<{
    Body: { enabled: boolean };
  }>) => {
    mlOverlayService.setEnabled(req.body.enabled);
    
    return {
      ok: true,
      status: mlOverlayService.getStatus(),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 16: VALIDATION
  // ═══════════════════════════════════════════════════════════════

  // Validation results
  app.get('/api/v10/alt-scanner/validation', async () => {
    const latest = validationService.getLatest();
    
    return {
      ok: true,
      latest,
      history: validationService.getHistory(10),
    };
  });

  // Run validation (admin)
  app.post('/api/v10/admin/alt-scanner/validation/run', async () => {
    // Would need snapshots and outcomes
    return {
      ok: true,
      message: 'Validation requires historical data. Accumulate more snapshots first.',
    };
  });

  console.log('[AltScanner] Extended routes registered (Blocks 6-16)');
}
