/**
 * TA Controller — API routes for Technical Analysis module
 * 
 * Phases:
 * - Phase 4: Audit Trail (ta_runs, ta_patterns, ta_decisions)
 * - Phase 5: Outcome Engine (ta_outcomes)
 * - Phase 6: Calibration Layer (score → probability)
 * - Phase B: Conflict Engine
 * - Phase C: Confluence Engine
 * - Phase D: Hypothesis Builder
 * - Phase E: Scenario Ranker & Decision Pack
 * - Phase F: Audit/Storage (hypotheses, scenarios)
 * - Phase G: Risk Pack Engine
 * - Phase H: Outcome Engine v2
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { TaService } from './ta.service.js';
import { taStorageService } from '../storage/ta-storage.service.js';
import { outcomeJobService } from '../outcome/outcome.job.js';
import { calibrationService } from '../calibration/calibration.service.js';
import { PATTERN_REGISTRY, getRegistryStats, getPatternMeta, isRegisteredPattern } from '../patterns/pattern_registry.js';
import { PATTERN_GROUPS, PATTERN_GROUP_META } from '../patterns/pattern_groups.js';
import { getImplementedPatterns, getPatternsByGroup, getPatternsByDirection } from '../patterns/pattern_meta.js';
// Phase B/C/D imports
import { resolveConflicts, HARD_CONFLICTS, SOFT_CONFLICTS } from '../hypothesis/conflicts/index.js';
import { applyConfluence, createDefaultContext, CONFLUENCE_WEIGHTS } from '../hypothesis/confluence/index.js';
import { buildHypothesesFromPatterns, groupPatternsByGroup } from '../hypothesis/builder/index.js';
// Phase E imports
import { buildDecisionPack, summarizeDecisionPack, getTopScenario, hasHighConfidence } from '../decision/index.js';
import { fallbackProbability } from '../decision/probability.js';
// Phase G imports
import { buildRiskPack, buildRiskContext } from '../risk/index.js';
// Phase H imports
import { evaluateOutcome } from '../outcomes_v2/index.js';
// Phase I imports - Regime & Calibration v2
import { buildRegimeLabel, inferRegimeSignals } from '../regime/regime_engine.js';
import { recomputeRegimes } from '../regime/regime_job.js';
import { calibratorV2, rebuildCalibrationModels, initCalibrationIndexes } from '../calibration_v2/index.js';
import { getMongoDb } from '../../../db/mongoose.js';
// Phase J imports - Market Provider
import { getMarketProvider, binanceSpotProvider } from '../market/index.js';
import { recomputeOutcomes } from '../outcomes_v2/outcome_job.js';
// Phase K imports - ML Dataset Builder
import { registerMLDatasetRoutes } from '../ml_dataset/index.js';
// Phase L imports - ML Overlay
import { registerOverlayRoutes } from '../ml_overlay/index.js';
// Phase M imports - Multi-Timeframe
import { registerMTFRoutes } from '../mtf/index.js';
// Phase N imports - Production Hardening
import { 
  getDecisionCached, getMTFCached, initCacheIndexes, 
  getCacheStats, setCacheConfig, clearAllCache 
} from '../cache/index.js';
import { getSchedulerStats, startScheduler, stopScheduler } from '../scheduler/index.js';
import { 
  getMetrics, recordDecisionRun, recordMTFRun, 
  recordCacheHit, recordCacheMiss, recordError, getExtendedHealth 
} from '../metrics/index.js';
// Phase S imports - Production Hardening v2
import { 
  getConfig as getTAConfig, 
  updateConfig as updateTAConfig, 
  isFrozen, 
  initConfig as initTAConfig 
} from '../infra/config.js';
import { getMetrics as getInfraMetrics } from '../infra/metrics.js';
import { getCircuitBreaker, getAllBreakers } from '../infra/breaker.js';
import { getCandleCache } from '../infra/cache.js';
import { getRateLimiter } from '../infra/ratelimit.js';
import { logger, generateRequestId } from '../infra/logger.js';
import { resetRNG, getRNG } from '../infra/rng.js';
import { isWriteOperation } from '../infra/freeze.js';
// Phase O imports - Real-Time Streaming
import { 
  globalEventBus, TAStreamService, registerStreamRoutes, 
  registerTAWebSocket, initOutboxIndexes, createPumpJob 
} from '../stream/index.js';
// Phase U imports - Performance Engine
import {
  runPatternEngineFast,
  DEFAULT_FAST_ENGINE_OPTIONS,
  analyzeTimings,
  getActiveFamilies,
  type FastEngineOptions,
  type GatingContext
} from '../perf/index.js';
import { buildFeatureCache } from '../perf/feature_cache.js';
// Phase V imports - Replay Engine
import { 
  getReplayEngine,
  type ReplayConfig 
} from '../replay/index.js';
import { getBinanceProviderV2 } from '../market/binance_spot_v2.provider.js';
// Phase W imports - ML Pipeline
import {
  initDatasetIndexes,
  getDatasetStats,
  getDatasetPreview,
  exportDatasetCSV,
  writeDatasetRow,
  extractFeatures,
  getFeatureNames,
  initModelIndexes,
  getAllModels,
  getActiveModel,
  activateModel,
  registerModel,
  type MLDatasetRow
} from '../ml/index.js';

// Helper to sanitize MongoDB documents (remove _id)
function sanitizeDoc(doc: any): any {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

function sanitizeDocs(docs: any[]): any[] {
  return docs.map(sanitizeDoc);
}

export async function taRoutes(app: FastifyInstance): Promise<void> {
  const taService = new TaService();

  // Initialize Phase S config
  initTAConfig();

  // Phase S4: Request ID middleware
  app.addHook('preHandler', async (request, reply) => {
    const requestId = (request.headers['x-request-id'] as string) || generateRequestId();
    logger.setRequestId(requestId);
    reply.header('x-request-id', requestId);
    getInfraMetrics().recordRequest();
  });

  // Phase S1: Freeze guard for write operations
  app.addHook('preHandler', async (request, reply) => {
    if (isFrozen() && isWriteOperation(request.method)) {
      const path = request.url.split('?')[0];
      
      // Allow analyze and decision (read-only compute)
      if (path.includes('/analyze') || path.includes('/decision')) {
        return;
      }
      
      // Allow admin endpoints to manage freeze state
      if (path.includes('/admin/')) {
        return;
      }
      
      reply.status(503).send({
        ok: false,
        error: 'SERVICE_FROZEN',
        message: 'TA module is in freeze mode. Write operations are disabled.',
        freezeEnabled: true,
      });
    }
  });

  app.addHook('onResponse', async () => {
    logger.clearRequestId();
  });

  // Initialize indexes on startup
  taStorageService.initIndexes().catch(err => {
    console.error('[TA] Failed to init storage indexes:', err);
  });
  outcomeJobService.initIndexes().catch(err => {
    console.error('[TA] Failed to init outcome indexes:', err);
  });
  initCalibrationIndexes().catch(err => {
    console.error('[TA] Failed to init calibration indexes:', err);
  });

  // Health check
  app.get('/health', async () => {
    return taService.health();
  });

  // Main analyze endpoint (GET)
  app.get('/analyze', async (request: FastifyRequest<{
    Querystring: { asset?: string; timeframe?: string; lookback?: string }
  }>) => {
    const { asset = 'SPX', timeframe = '1D', lookback = '200' } = request.query;
    
    return taService.analyze({
      asset,
      timeframe,
      lookback: parseInt(lookback, 10)
    });
  });

  // Main analyze endpoint (POST)
  app.post('/analyze', async (request: FastifyRequest<{
    Body: { asset: string; timeframe?: string; lookback?: number }
  }>) => {
    const { asset, timeframe = '1D', lookback = 200 } = request.body || {};
    
    if (!asset) {
      return { ok: false, error: 'asset is required' };
    }
    
    return taService.analyze({ asset, timeframe, lookback });
  });

  // ═══════════════════════════════════════════════════════════════
  // AUDIT ENDPOINTS (Phase 4)
  // ═══════════════════════════════════════════════════════════════

  // Get latest run for an asset
  app.get('/audit/latest', async (request: FastifyRequest<{
    Querystring: { asset?: string }
  }>) => {
    const { asset = 'SPX' } = request.query;
    
    const { run, patterns, decision } = await taStorageService.getLatestRun(asset);
    
    if (!run) {
      return { ok: false, error: `No runs found for asset ${asset}` };
    }
    
    return {
      ok: true,
      run: sanitizeDoc(run),
      patterns: sanitizeDocs(patterns),
      decision: sanitizeDoc(decision),
    };
  });

  // Get specific run by ID
  app.get('/audit/run/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>) => {
    const { id: runId } = request.params;
    
    // Phase F: Get full audit including hypotheses and scenarios
    const audit = await taStorageService.getFullAudit(runId);
    
    if (!audit.run) {
      return { ok: false, error: `Run ${runId} not found` };
    }
    
    return {
      ok: true,
      runId,
      run: sanitizeDoc(audit.run),
      patterns: sanitizeDocs(audit.patterns),
      hypotheses: sanitizeDocs(audit.hypotheses),
      scenarios: sanitizeDocs(audit.scenarios),
      decision: sanitizeDoc(audit.decision),
    };
  });

  // List recent runs for an asset
  app.get('/audit/runs', async (request: FastifyRequest<{
    Querystring: { asset?: string; limit?: string }
  }>) => {
    const { asset = 'SPX', limit = '10' } = request.query;
    
    const runs = await taStorageService.listRuns(asset, parseInt(limit, 10));
    
    return {
      ok: true,
      asset,
      count: runs.length,
      runs: sanitizeDocs(runs),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // OUTCOME ENDPOINTS (Phase 5)
  // ═══════════════════════════════════════════════════════════════

  // Run outcome evaluation job (manual trigger)
  app.post('/outcomes/recompute', async (request: FastifyRequest<{
    Body: { asset?: string; lookbackDays?: number; forceRecompute?: boolean }
  }>) => {
    const { asset = 'SPX', lookbackDays = 60, forceRecompute = false } = request.body || {};
    
    const result = await outcomeJobService.runJob({
      asset,
      lookbackDays,
      forceRecompute,
    });
    
    return result;
  });

  // Get latest outcomes for an asset
  app.get('/outcomes/latest', async (request: FastifyRequest<{
    Querystring: { asset?: string; limit?: string }
  }>) => {
    const { asset = 'SPX', limit = '20' } = request.query;
    
    const outcomes = await outcomeJobService.getLatestOutcomes(asset, parseInt(limit, 10));
    
    return {
      ok: true,
      asset,
      count: outcomes.length,
      outcomes: sanitizeDocs(outcomes),
    };
  });

  // Get outcomes for a specific run
  app.get('/outcomes/run/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>) => {
    const { id: runId } = request.params;
    
    const outcomes = await outcomeJobService.getOutcomesByRun(runId);
    
    return {
      ok: true,
      runId,
      count: outcomes.length,
      outcomes: sanitizeDocs(outcomes),
    };
  });

  // Get performance summary
  app.get('/performance', async (request: FastifyRequest<{
    Querystring: { asset?: string; since?: string }
  }>) => {
    const { asset = 'SPX', since } = request.query;
    
    let sinceDate: Date | undefined;
    if (since) {
      sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        sinceDate = undefined;
      }
    }
    
    const performance = await outcomeJobService.getPerformance(asset, sinceDate);
    
    return {
      ok: true,
      ...performance,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // LEGACY ENDPOINTS (for compatibility)
  // ═══════════════════════════════════════════════════════════════

  // Get market structure only
  app.get('/structure', async (request: FastifyRequest<{
    Querystring: { asset?: string }
  }>) => {
    const { asset = 'SPX' } = request.query;
    const result = await taService.analyze({ asset });
    
    return {
      ok: result.ok,
      asset,
      structure: result.structure,
      timestamp: result.meta.timestamp
    };
  });

  // Get levels only
  app.get('/levels', async (request: FastifyRequest<{
    Querystring: { asset?: string }
  }>) => {
    const { asset = 'SPX' } = request.query;
    const result = await taService.analyze({ asset });
    
    return {
      ok: result.ok,
      asset,
      levels: result.levels,
      timestamp: result.meta.timestamp
    };
  });

  // Get pivots only
  app.get('/pivots', async (request: FastifyRequest<{
    Querystring: { asset?: string }
  }>) => {
    const { asset = 'SPX' } = request.query;
    const result = await taService.analyze({ asset });
    
    return {
      ok: result.ok,
      asset,
      pivots: result.pivots,
      timestamp: result.meta.timestamp
    };
  });

  // Get patterns only
  app.get('/patterns', async (request: FastifyRequest<{
    Querystring: { asset?: string }
  }>) => {
    const { asset = 'SPX' } = request.query;
    const result = await taService.analyze({ asset });
    
    return {
      ok: result.ok,
      asset,
      patterns: result.patterns,
      timestamp: result.meta.timestamp
    };
  });

  // Get features for ML
  app.get('/features', async (request: FastifyRequest<{
    Querystring: { asset?: string }
  }>) => {
    const { asset = 'SPX' } = request.query;
    const result = await taService.analyze({ asset });
    
    return {
      ok: result.ok,
      asset,
      features: result.features,
      timestamp: result.meta.timestamp
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // CALIBRATION ENDPOINTS (Phase 6)
  // ═══════════════════════════════════════════════════════════════

  // Get overall calibration curve
  app.get('/calibration', async (request: FastifyRequest<{
    Querystring: { asset?: string; since?: string }
  }>) => {
    const { asset, since } = request.query;
    
    let sinceDate: Date | undefined;
    if (since) {
      sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        sinceDate = undefined;
      }
    }
    
    const calibration = await calibrationService.getCalibration({
      asset,
      since: sinceDate
    });
    
    return {
      ok: true,
      ...calibration,
    };
  });

  // Get calibration for specific pattern type
  app.get('/calibration/pattern/:type', async (request: FastifyRequest<{
    Params: { type: string };
    Querystring: { asset?: string; since?: string }
  }>) => {
    const { type } = request.params;
    const { asset, since } = request.query;
    
    let sinceDate: Date | undefined;
    if (since) {
      sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        sinceDate = undefined;
      }
    }
    
    const calibration = await calibrationService.getCalibrationByType(type, {
      asset,
      since: sinceDate
    });
    
    return {
      ok: true,
      patternType: type,
      ...calibration,
    };
  });

  // Get calibration for all pattern types
  app.get('/calibration/all', async (request: FastifyRequest<{
    Querystring: { asset?: string; since?: string }
  }>) => {
    const { asset, since } = request.query;
    
    let sinceDate: Date | undefined;
    if (since) {
      sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        sinceDate = undefined;
      }
    }
    
    const calibrations = await calibrationService.getAllPatternTypeCalibrations({
      asset,
      since: sinceDate
    });
    
    return {
      ok: true,
      count: calibrations.length,
      calibrations,
    };
  });

  // Get calibration health status
  app.get('/calibration/health', async (request: FastifyRequest<{
    Querystring: { asset?: string }
  }>) => {
    const { asset } = request.query;
    
    const health = await calibrationService.getHealth(asset);
    
    return {
      ok: true,
      ...health,
    };
  });

  // Calibrate a single score
  app.post('/calibration/calibrate', async (request: FastifyRequest<{
    Body: { score: number; asset?: string }
  }>) => {
    const { score, asset } = request.body || {};
    
    if (typeof score !== 'number') {
      return { ok: false, error: 'score is required and must be a number' };
    }
    
    const calibratedProbability = await calibrationService.calibrateScore(score, { asset });
    
    return {
      ok: true,
      originalScore: score,
      calibratedProbability,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // REGISTRY ENDPOINTS (Phase A: Hypothesis Engine Foundation)
  // ═══════════════════════════════════════════════════════════════

  // Get registry stats - sanity check endpoint
  app.get('/registry/stats', async () => {
    const stats = getRegistryStats();
    
    return {
      ok: true,
      phase: 'A',
      description: 'Pattern Registry — Hypothesis Engine Foundation',
      stats,
      groups: PATTERN_GROUPS,
    };
  });

  // Get all patterns in registry
  app.get('/registry/patterns', async (request: FastifyRequest<{
    Querystring: { group?: string; direction?: string; implemented?: string }
  }>) => {
    const { group, direction, implemented } = request.query;
    
    let patterns = Object.values(PATTERN_REGISTRY);
    
    // Filter by group
    if (group) {
      patterns = patterns.filter(p => p.group === group);
    }
    
    // Filter by direction
    if (direction) {
      patterns = patterns.filter(p => 
        p.direction === direction || p.direction === 'BOTH'
      );
    }
    
    // Filter by implemented status
    if (implemented === 'true') {
      patterns = patterns.filter(p => p.implemented === true);
    } else if (implemented === 'false') {
      patterns = patterns.filter(p => !p.implemented);
    }
    
    return {
      ok: true,
      count: patterns.length,
      patterns: patterns.map(p => ({
        type: p.type,
        group: p.group,
        family: p.family,
        direction: p.direction,
        stage: p.stage,
        priority: p.priority,
        implemented: p.implemented || false,
        exclusivityKey: p.exclusivityKey,
      })),
    };
  });

  // Get single pattern metadata
  app.get('/registry/pattern/:type', async (request: FastifyRequest<{
    Params: { type: string }
  }>) => {
    const { type } = request.params;
    const meta = getPatternMeta(type);
    
    if (!meta) {
      return { 
        ok: false, 
        error: `Pattern '${type}' not found in registry`,
        hint: 'Use GET /api/ta/registry/patterns to see all available patterns'
      };
    }
    
    return {
      ok: true,
      pattern: meta,
    };
  });

  // Get group metadata
  app.get('/registry/groups', async () => {
    return {
      ok: true,
      count: PATTERN_GROUPS.length,
      groups: PATTERN_GROUPS.map(g => ({
        id: g,
        ...PATTERN_GROUP_META[g],
      })),
    };
  });

  // Check if pattern type is registered
  app.get('/registry/check/:type', async (request: FastifyRequest<{
    Params: { type: string }
  }>) => {
    const { type } = request.params;
    const exists = isRegisteredPattern(type);
    
    return {
      ok: true,
      type,
      registered: exists,
    };
  });

  // Get implemented patterns only
  app.get('/registry/implemented', async () => {
    const implemented = getImplementedPatterns(PATTERN_REGISTRY);
    
    return {
      ok: true,
      count: implemented.length,
      patterns: implemented.map(p => ({
        type: p.type,
        group: p.group,
        direction: p.direction,
        priority: p.priority,
      })),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // CONFLICT ENGINE ENDPOINTS (Phase B)
  // ═══════════════════════════════════════════════════════════════

  // Get conflict rules
  app.get('/conflicts/rules', async () => {
    return {
      ok: true,
      phase: 'B',
      description: 'Conflict Engine — Mutually exclusive pattern rules',
      hardConflicts: Object.keys(HARD_CONFLICTS).length,
      softConflicts: Object.keys(SOFT_CONFLICTS).length,
      rules: {
        hard: HARD_CONFLICTS,
        soft: SOFT_CONFLICTS,
      },
    };
  });

  // Test conflict resolution with sample patterns
  app.post('/conflicts/test', async (request: FastifyRequest<{
    Body: { patterns: Array<{ type: string; score: number; exclusivityKey?: string }> }
  }>) => {
    const { patterns = [] } = request.body || {};
    
    if (!patterns.length) {
      return { ok: false, error: 'patterns array is required' };
    }
    
    // Convert to PatternCandidate format
    const candidates = patterns.map((p, i) => ({
      id: `test_${i}`,
      type: p.type,
      group: PATTERN_REGISTRY[p.type]?.group || 'UNKNOWN',
      direction: (PATTERN_REGISTRY[p.type]?.direction || 'BOTH') as any,
      score: p.score,
      finalScore: p.score,
      exclusivityKey: p.exclusivityKey || PATTERN_REGISTRY[p.type]?.exclusivityKey || 'none',
      priority: PATTERN_REGISTRY[p.type]?.priority || 50,
    }));
    
    const result = resolveConflicts(candidates);
    
    return {
      ok: true,
      input: candidates.length,
      output: result.kept.length,
      result: {
        kept: result.kept.map(p => ({ type: p.type, score: p.finalScore })),
        dropped: result.dropped.map(p => ({ type: p.type, score: p.finalScore })),
        conflicts: result.conflicts,
        stats: result.stats,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // CONFLUENCE ENGINE ENDPOINTS (Phase C)
  // ═══════════════════════════════════════════════════════════════

  // Get confluence factors info
  app.get('/confluence/factors', async () => {
    return {
      ok: true,
      phase: 'C',
      description: 'Confluence Engine — 8 independent scoring factors',
      factors: Object.entries(CONFLUENCE_WEIGHTS).map(([name, weight]) => ({
        name,
        weight,
        description: getFactorDescription(name),
      })),
      formula: 'finalScore = baseScore * weightedAverage(factors) * gateMultipliers',
    };
  });

  // Test confluence scoring
  app.post('/confluence/test', async (request: FastifyRequest<{
    Body: { 
      pattern: { type: string; score: number; metrics?: any };
      context?: any;
    }
  }>) => {
    const { pattern, context } = request.body || {};
    
    if (!pattern || typeof pattern.score !== 'number') {
      return { ok: false, error: 'pattern with score is required' };
    }
    
    const patternInput = {
      type: pattern.type || 'UNKNOWN',
      direction: (PATTERN_REGISTRY[pattern.type]?.direction || 'BOTH') as any,
      score: pattern.score,
      metrics: pattern.metrics || {},
    };
    
    const marketContext = createDefaultContext(context || {});
    const result = applyConfluence(patternInput, marketContext);
    
    return {
      ok: true,
      input: {
        pattern: patternInput,
        context: marketContext,
      },
      result: {
        baseScore: result.baseScore,
        confluenceScore: result.confluenceScore,
        finalScore: result.finalScore,
        factors: result.factors.map(f => ({
          name: f.name,
          value: f.value.toFixed(4),
          weight: f.weight,
          multiplier: f.multiplier,
          reasons: f.reason,
        })),
        reasons: result.reasons,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // HYPOTHESIS BUILDER ENDPOINTS (Phase D)
  // ═══════════════════════════════════════════════════════════════

  // Build hypotheses from current analysis
  app.get('/hypotheses', async (request: FastifyRequest<{
    Querystring: { asset?: string; beamWidth?: string; topN?: string }
  }>) => {
    const { asset = 'SPX', beamWidth = '20', topN = '10' } = request.query;
    
    // Get current analysis
    const analysis = await taService.analyze({ asset });
    
    if (!analysis.ok || !analysis.patterns.length) {
      return {
        ok: false,
        asset,
        error: 'No patterns found for hypothesis building',
        patternsFound: analysis.patterns?.length || 0,
      };
    }
    
    // Convert scored patterns to PatternCandidate format
    const candidates = analysis.patterns.map((p: any) => ({
      id: p.id,
      type: p.type,
      group: PATTERN_REGISTRY[p.type]?.group || 'UNKNOWN',
      direction: p.direction || PATTERN_REGISTRY[p.type]?.direction || 'BOTH',
      baseScore: p.metrics?.totalScore || p.score || 0.5,
      finalScore: p.metrics?.totalScore || p.score || 0.5,
      exclusivityKey: PATTERN_REGISTRY[p.type]?.exclusivityKey || 'none',
      priority: PATTERN_REGISTRY[p.type]?.priority || 50,
      metrics: p.metrics,
    }));
    
    // Build hypotheses
    const hypotheses = buildHypothesesFromPatterns(asset, '1D', candidates, {
      beamWidth: parseInt(beamWidth, 10),
      topN: parseInt(topN, 10),
      minComponents: 1,
    });
    
    return {
      ok: true,
      asset,
      phase: 'D',
      description: 'Hypothesis Builder — Beam search with conflict resolution',
      input: {
        patternsCount: candidates.length,
        groupsCount: groupPatternsByGroup(candidates).length,
      },
      hypotheses: hypotheses.map(h => ({
        id: h.id,
        direction: h.direction,
        score: h.score.toFixed(4),
        components: h.components.map(c => ({
          type: c.type,
          group: c.group,
          direction: c.direction,
          score: c.finalScore.toFixed(4),
        })),
        reasons: h.reasons,
      })),
      stats: {
        totalHypotheses: hypotheses.length,
        avgComponents: hypotheses.length > 0 
          ? (hypotheses.reduce((s, h) => s + h.components.length, 0) / hypotheses.length).toFixed(1)
          : 0,
        topDirection: hypotheses[0]?.direction || 'NEUTRAL',
        topScore: hypotheses[0]?.score.toFixed(4) || '0',
      },
    };
  });

  // Build hypotheses from custom patterns (test endpoint)
  app.post('/hypotheses/build', async (request: FastifyRequest<{
    Body: {
      symbol?: string;
      timeframe?: string;
      patterns: Array<{ type: string; score: number; direction?: string }>;
      opts?: { beamWidth?: number; topN?: number; minComponents?: number };
    }
  }>) => {
    const { symbol = 'TEST', timeframe = '1D', patterns = [], opts = {} } = request.body || {};
    
    if (!patterns.length) {
      return { ok: false, error: 'patterns array is required' };
    }
    
    // Convert to PatternCandidate format
    const candidates = patterns.map((p, i) => ({
      id: `cand_${i}`,
      type: p.type,
      group: PATTERN_REGISTRY[p.type]?.group || 'UNKNOWN',
      direction: (p.direction || PATTERN_REGISTRY[p.type]?.direction || 'BOTH') as any,
      baseScore: p.score,
      finalScore: p.score,
      exclusivityKey: PATTERN_REGISTRY[p.type]?.exclusivityKey || 'none',
      priority: PATTERN_REGISTRY[p.type]?.priority || 50,
    }));
    
    const hypotheses = buildHypothesesFromPatterns(symbol, timeframe, candidates, {
      beamWidth: opts.beamWidth ?? 20,
      topN: opts.topN ?? 10,
      minComponents: opts.minComponents ?? 1,
    });
    
    return {
      ok: true,
      symbol,
      timeframe,
      input: patterns.length,
      hypotheses: hypotheses.map(h => ({
        id: h.id,
        direction: h.direction,
        score: h.score.toFixed(4),
        components: h.components.map(c => ({ type: c.type, group: c.group, score: c.finalScore.toFixed(4) })),
        reasons: h.reasons,
      })),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // DECISION PACK ENDPOINTS (Phase E: Scenario Ranker)
  // ═══════════════════════════════════════════════════════════════

  // Get full decision pack for asset
  app.get('/decision', async (request: FastifyRequest<{
    Querystring: { asset?: string; timeframe?: string; topK?: string; benchK?: string }
  }>) => {
    const { asset = 'BTCUSDT', timeframe = '1D', topK = '3', benchK = '7' } = request.query;
    
    // Get current analysis
    const analysis = await taService.analyze({ asset, timeframe });
    
    if (!analysis.ok || !analysis.patterns.length) {
      return {
        ok: false,
        asset,
        timeframe,
        error: 'No patterns found for decision making',
        patternsFound: analysis.patterns?.length || 0,
      };
    }
    
    // Convert scored patterns to PatternCandidate format
    const candidates = analysis.patterns.map((p: any) => ({
      id: p.id,
      type: p.type,
      group: PATTERN_REGISTRY[p.type]?.group || 'UNKNOWN',
      direction: p.direction || PATTERN_REGISTRY[p.type]?.direction || 'BOTH',
      baseScore: p.metrics?.totalScore || p.score || 0.5,
      finalScore: p.metrics?.totalScore || p.score || 0.5,
      exclusivityKey: PATTERN_REGISTRY[p.type]?.exclusivityKey || 'none',
      priority: PATTERN_REGISTRY[p.type]?.priority || 50,
      metrics: p.metrics,
    }));
    
    // Build hypotheses
    const hypotheses = buildHypothesesFromPatterns(asset, timeframe, candidates, {
      beamWidth: 20,
      topN: 20,
      minComponents: 1,
    });
    
    if (hypotheses.length === 0) {
      return {
        ok: false,
        asset,
        timeframe,
        error: 'No hypotheses could be built',
        patternsFound: candidates.length,
      };
    }
    
    // Build decision pack
    const pack = await buildDecisionPack({
      runId: analysis.runId || `run_${Date.now()}`,
      asset,
      timeframe,
      engineVersion: '2.0.0-phase-e',
      hypotheses,
      calibrator: undefined, // No calibrator yet - uses fallback
      rankerOpts: {
        topK: parseInt(topK, 10),
        benchK: parseInt(benchK, 10),
        enforceDirectionDiversity: true,
      },
    });
    
    return {
      ok: true,
      ...pack,
    };
  });

  // Get quick decision summary
  app.get('/decision/summary', async (request: FastifyRequest<{
    Querystring: { asset?: string; timeframe?: string }
  }>) => {
    const { asset = 'BTCUSDT', timeframe = '1D' } = request.query;
    
    // Get analysis and build decision pack
    const analysis = await taService.analyze({ asset, timeframe });
    
    if (!analysis.ok || !analysis.patterns.length) {
      return {
        ok: false,
        asset,
        error: 'No patterns for decision',
      };
    }
    
    const candidates = analysis.patterns.map((p: any) => ({
      id: p.id,
      type: p.type,
      group: PATTERN_REGISTRY[p.type]?.group || 'UNKNOWN',
      direction: p.direction || PATTERN_REGISTRY[p.type]?.direction || 'BOTH',
      baseScore: p.metrics?.totalScore || p.score || 0.5,
      finalScore: p.metrics?.totalScore || p.score || 0.5,
      exclusivityKey: PATTERN_REGISTRY[p.type]?.exclusivityKey || 'none',
      priority: PATTERN_REGISTRY[p.type]?.priority || 50,
    }));
    
    const hypotheses = buildHypothesesFromPatterns(asset, timeframe, candidates, {
      beamWidth: 20,
      topN: 20,
      minComponents: 1,
    });
    
    const pack = await buildDecisionPack({
      runId: analysis.runId || `run_${Date.now()}`,
      asset,
      timeframe,
      engineVersion: '2.0.0-phase-e',
      hypotheses,
    });
    
    const topScenario = getTopScenario(pack);
    
    return {
      ok: true,
      asset,
      timeframe,
      summary: {
        topBias: topScenario?.intent.bias || 'WAIT',
        topProbability: topScenario?.probability || 0,
        topConfidence: topScenario?.intent.confidenceLabel || 'LOW',
        topDirection: topScenario?.direction || 'NEUTRAL',
        hasHighConfidence: hasHighConfidence(pack),
        scenariosCount: pack.top.length,
        hypothesesIn: pack.summary.hypothesesIn,
      },
      topScenario: topScenario ? {
        scenarioId: topScenario.scenarioId,
        direction: topScenario.direction,
        probability: (topScenario.probability * 100).toFixed(1) + '%',
        bias: topScenario.intent.bias,
        confidence: topScenario.intent.confidenceLabel,
        patterns: topScenario.components.map(c => c.type),
        headline: topScenario.why.headline,
      } : null,
    };
  });

  // Test probability mapping
  app.post('/decision/probability', async (request: FastifyRequest<{
    Body: { scores: number[] }
  }>) => {
    const { scores = [] } = request.body || {};
    
    if (!scores.length) {
      return { ok: false, error: 'scores array is required' };
    }
    
    const results = scores.map(score => {
      const result = fallbackProbability(score);
      return {
        score,
        probability: result.p,
        source: result.source,
        reason: result.reason,
      };
    });
    
    return {
      ok: true,
      mode: 'FALLBACK',
      formula: 'logistic_shrink_0.7',
      results,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE G: RISK PACK ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  // Compute risk pack for a scenario
  app.post('/risk/compute', async (request: FastifyRequest<{
    Body: {
      scenario: { direction: string; components: any[] };
      context: { priceNow: number; atr: number; levels?: any[]; fib?: any[] };
    }
  }>) => {
    const { scenario, context } = request.body || {};
    
    if (!scenario || !context) {
      return { ok: false, error: 'scenario and context are required' };
    }
    
    const ctx = buildRiskContext({
      asset: 'TEST',
      timeframe: '1D',
      priceNow: context.priceNow,
      atr: context.atr,
      levels: context.levels,
      fib: context.fib,
    });
    
    const riskPack = buildRiskPack({
      direction: scenario.direction as any,
      components: scenario.components || [],
    }, ctx);
    
    return {
      ok: true,
      riskPack,
    };
  });

  // Get decision with risk pack
  app.get('/decision/full', async (request: FastifyRequest<{
    Querystring: { asset?: string; timeframe?: string; useCalibration?: string }
  }>) => {
    const { asset = 'BTCUSDT', timeframe = '1D', useCalibration = 'true' } = request.query;
    
    // Get analysis
    const analysis = await taService.analyze({ asset, timeframe });
    
    if (!analysis.ok || !analysis.patterns.length) {
      return {
        ok: false,
        asset,
        error: 'No patterns found',
      };
    }
    
    // Phase I: Compute current regime
    const regimeSignals = inferRegimeSignals(
      analysis.featurePack || {},
      analysis.structure || {}
    );
    
    const regimeLabel = buildRegimeLabel({
      maAlignment: regimeSignals.maAlignment || 'MIXED',
      maSlope20: regimeSignals.maSlope20 || 0,
      maSlope50: regimeSignals.maSlope50 || 0,
      structure: regimeSignals.structure || 'UNKNOWN',
      compression: regimeSignals.compression || 0,
      atrPercentile: regimeSignals.atrPercentile || 0.5,
    });
    
    const regimeBucket = `${regimeLabel.marketRegime}_${regimeLabel.volRegime}`;
    
    // Build hypotheses
    const candidates = analysis.patterns.map((p: any) => ({
      id: p.id,
      type: p.type,
      group: PATTERN_REGISTRY[p.type]?.group || 'UNKNOWN',
      direction: p.direction || PATTERN_REGISTRY[p.type]?.direction || 'BOTH',
      baseScore: p.metrics?.totalScore || p.score || 0.5,
      finalScore: p.metrics?.totalScore || p.score || 0.5,
      exclusivityKey: PATTERN_REGISTRY[p.type]?.exclusivityKey || 'none',
      priority: PATTERN_REGISTRY[p.type]?.priority || 50,
      metrics: p.metrics,
    }));
    
    const hypotheses = buildHypothesesFromPatterns(asset, timeframe, candidates, {
      beamWidth: 20,
      topN: 20,
      minComponents: 1,
    });
    
    // Phase I: Create calibrator function if enabled
    const calibrator = useCalibration === 'true' 
      ? calibratorV2.createCalibrator(regimeBucket as any)
      : undefined;
    
    // Build decision pack with calibrator
    const pack = await buildDecisionPack({
      runId: analysis.runId || `run_${Date.now()}`,
      asset,
      timeframe,
      engineVersion: '2.0.0-phase-i',
      hypotheses,
      calibrator,
    });
    
    // Build risk context
    const priceNow = analysis.structure?.currentPrice || 50000;
    const atr = analysis.featurePack?.indicators?.atr14 || priceNow * 0.02;
    const levels = analysis.levels || [];
    
    const riskCtx = buildRiskContext({
      asset,
      timeframe,
      priceNow,
      atr,
      levels: levels.map((l: any) => ({ mid: l.price, low: l.price * 0.99, high: l.price * 1.01 })),
    });
    
    // Add risk pack to scenarios
    const scenariosWithRisk = pack.top.map(s => ({
      ...s,
      riskPack: buildRiskPack({
        direction: s.direction,
        components: s.components,
      }, riskCtx),
    }));
    
    // Save to audit (Phase F) - include regime in snapshot
    try {
      // Update run with regime
      const db = getMongoDb();
      await db.collection('ta_runs').updateOne(
        { runId: pack.runId },
        {
          $set: {
            'snapshot.marketRegime': regimeLabel.marketRegime,
            'snapshot.volRegime': regimeLabel.volRegime,
            'snapshot.regimeConfidence': regimeLabel.confidence,
            'snapshot.regimeSignals': regimeLabel.signals,
          },
        },
        { upsert: false }
      );
      
      await taStorageService.saveHypotheses(pack.runId, hypotheses);
      await taStorageService.saveScenarios(pack.runId, scenariosWithRisk);
    } catch (err) {
      console.warn('[TA] Failed to save audit:', err);
    }
    
    return {
      ok: true,
      runId: pack.runId,
      asset,
      timeframe,
      engineVersion: pack.engineVersion,
      probabilitySource: pack.summary.probabilityMode,
      regime: {
        market: regimeLabel.marketRegime,
        volatility: regimeLabel.volRegime,
        bucket: regimeBucket,
        confidence: regimeLabel.confidence,
      },
      top: scenariosWithRisk,
      bench: pack.bench,
      summary: pack.summary,
      context: {
        priceNow,
        atr,
        levelsCount: levels.length,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE I: REGIME LABELER ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  // Get current regime for an asset
  app.get('/regime/current', async (request: FastifyRequest<{
    Querystring: { asset?: string }
  }>) => {
    const { asset = 'BTCUSDT' } = request.query;
    
    // Get analysis to extract regime signals
    const taService = new TaService();
    const analysis = await taService.analyze({ asset });
    
    if (!analysis.ok) {
      return { ok: false, error: 'Failed to analyze asset for regime' };
    }
    
    const signals = inferRegimeSignals(
      analysis.featurePack || {},
      analysis.structure || {}
    );
    
    const label = buildRegimeLabel({
      maAlignment: signals.maAlignment || 'MIXED',
      maSlope20: signals.maSlope20 || 0,
      maSlope50: signals.maSlope50 || 0,
      structure: signals.structure || 'UNKNOWN',
      compression: signals.compression || 0,
      atrPercentile: signals.atrPercentile || 0.5,
    });
    
    return {
      ok: true,
      asset,
      regime: {
        market: label.marketRegime,
        volatility: label.volRegime,
        confidence: label.confidence,
        bucket: `${label.marketRegime}_${label.volRegime}`,
      },
      signals: label.signals,
    };
  });

  // Recompute regimes for historical runs
  app.post('/regime/recompute', async (request: FastifyRequest<{
    Body: { asset?: string; timeframe?: string; limit?: number }
  }>) => {
    const { asset, timeframe, limit = 200 } = request.body || {};
    
    const db = getMongoDb();
    const result = await recomputeRegimes({
      db,
      asset,
      timeframe,
      limitRuns: limit,
    });
    
    return {
      ok: result.ok,
      updated: result.updated,
      message: `Updated regime labels for ${result.updated} runs`,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE I: CALIBRATION V2 ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  // Get calibration v2 status
  app.get('/calibration_v2/status', async () => {
    const models = await calibratorV2.getAllModels();
    
    return {
      ok: true,
      phase: 'I',
      description: 'Calibration v2 — Per-regime calibrated probabilities',
      modelsLoaded: models.length,
      models: models.map(m => ({
        regime: m.regime,
        sampleCount: m.sampleCount,
        winRate: m.winRate,
        ece: m.ece,
        generatedAt: m.generatedAt,
      })),
    };
  });

  // Calibrate a score with regime
  app.post('/calibration_v2/calibrate', async (request: FastifyRequest<{
    Body: { score: number; regime?: string }
  }>) => {
    const { score, regime } = request.body || {};
    
    if (typeof score !== 'number') {
      return { ok: false, error: 'score is required' };
    }
    
    const result = await calibratorV2.calibrate(score, regime as any);
    
    return {
      ok: true,
      input: { score, regime },
      result: {
        probability: result.probability,
        source: result.source,
        regime: result.regime,
        sampleCount: result.sampleCount,
      },
    };
  });

  // Rebuild calibration models
  app.post('/calibration_v2/rebuild', async (request: FastifyRequest<{
    Body: { asset?: string; timeframe?: string }
  }>) => {
    const { asset, timeframe } = request.body || {};
    
    const result = await rebuildCalibrationModels({
      asset,
      timeframe,
    });
    
    return {
      ok: result.ok,
      modelsBuilt: result.modelsBuilt,
      globalModel: result.globalModel,
      regimeModels: result.regimeModels,
      skippedRegimes: result.skippedRegimes,
      timestamp: result.timestamp,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE J: MARKET PROVIDER ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  // Get candles from market provider
  app.get('/market/candles', async (request: FastifyRequest<{
    Querystring: { symbol?: string; interval?: string; limit?: string; provider?: string }
  }>) => {
    const { 
      symbol = 'BTCUSDT', 
      interval = '1D', 
      limit = '100',
      provider = 'binance'
    } = request.query;
    
    const marketProvider = getMarketProvider(provider as 'binance' | 'mock');
    
    const candles = await marketProvider.getCandles({
      asset: symbol,
      timeframe: interval,
      fromTs: Date.now() - parseInt(limit) * 24 * 60 * 60 * 1000,
      limit: parseInt(limit),
    });
    
    return {
      ok: true,
      symbol,
      interval,
      provider,
      count: candles.length,
      candles: candles.slice(-20), // Return last 20 for preview
      latestPrice: candles.length > 0 ? candles[candles.length - 1].c : null,
    };
  });

  // Get latest price
  app.get('/market/price', async (request: FastifyRequest<{
    Querystring: { symbol?: string }
  }>) => {
    const { symbol = 'BTCUSDT' } = request.query;
    
    const price = await binanceSpotProvider.getLatestPrice(symbol);
    
    return {
      ok: price !== null,
      symbol,
      price,
      timestamp: new Date().toISOString(),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE H v2: OUTCOME ENGINE WITH LIVE PROVIDER
  // ═══════════════════════════════════════════════════════════════

  // Recompute outcomes with live market data
  app.post('/outcomes_v2/recompute', async (request: FastifyRequest<{
    Body: { asset?: string; timeframe?: string; limit?: number; provider?: string }
  }>) => {
    const { 
      asset, 
      timeframe = '1D', 
      limit = 50,
      provider = 'binance'
    } = request.body || {};
    
    const db = getMongoDb();
    const marketProvider = getMarketProvider(provider as 'binance' | 'mock');
    
    const result = await recomputeOutcomes({
      db,
      provider: marketProvider,
      asset,
      timeframe,
      limitRuns: limit,
    });
    
    return {
      ok: result.ok,
      processed: result.processed,
      updated: result.updated,
      provider,
      message: `Processed ${result.processed} scenarios, updated ${result.updated} outcomes`,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE K: ML DATASET BUILDER
  // ═══════════════════════════════════════════════════════════════
  
  const db = getMongoDb();
  await registerMLDatasetRoutes(app, { db });

  // ═══════════════════════════════════════════════════════════════
  // PHASE L: ML OVERLAY
  // ═══════════════════════════════════════════════════════════════
  
  await registerOverlayRoutes(app, { db });

  // ═══════════════════════════════════════════════════════════════
  // PHASE M: MULTI-TIMEFRAME
  // ═══════════════════════════════════════════════════════════════
  
  // Create decision service function for MTF
  const decisionServiceForMTF = async (args: { asset: string; timeframe: string }) => {
    const analysis = await taService.analyze({ asset: args.asset, timeframe: args.timeframe });
    
    if (!analysis.ok || !analysis.patterns?.length) {
      return { ok: false, scenarios: [], top: [] };
    }
    
    const candidates = analysis.patterns.map((p: any) => ({
      id: p.id,
      type: p.type,
      group: PATTERN_REGISTRY[p.type]?.group || 'UNKNOWN',
      direction: p.direction || PATTERN_REGISTRY[p.type]?.direction || 'BOTH',
      baseScore: p.metrics?.totalScore || p.score || 0.5,
      finalScore: p.metrics?.totalScore || p.score || 0.5,
      exclusivityKey: PATTERN_REGISTRY[p.type]?.exclusivityKey || 'none',
      priority: PATTERN_REGISTRY[p.type]?.priority || 50,
      metrics: p.metrics,
    }));
    
    const hypotheses = buildHypothesesFromPatterns(args.asset, args.timeframe, candidates, {
      beamWidth: 20,
      topN: 20,
      minComponents: 1,
    });
    
    if (hypotheses.length === 0) {
      return { ok: false, scenarios: [], top: [] };
    }
    
    const pack = await buildDecisionPack({
      runId: analysis.runId || `run_${Date.now()}`,
      asset: args.asset,
      timeframe: args.timeframe,
      engineVersion: '2.0.0-phase-m',
      hypotheses,
    });
    
    return pack;
  };
  
  await registerMTFRoutes(app, { db, decisionService: decisionServiceForMTF });

  // ═══════════════════════════════════════════════════════════════
  // PHASE N: PRODUCTION HARDENING
  // ═══════════════════════════════════════════════════════════════

  // Initialize cache indexes
  await initCacheIndexes(db);

  // Create stream service for Phase O
  const streamService = new TAStreamService({
    bus: globalEventBus,
    db,
    outboxEnabled: true,
  });

  // N4: Extended health endpoint
  app.get('/health/extended', async () => {
    const metrics = getMetrics();
    const extended = await getExtendedHealth(db);
    const cacheStats = getCacheStats();
    const schedulerStats = getSchedulerStats();

    return {
      ok: true,
      ...extended,
      metrics,
      cache: cacheStats,
      scheduler: schedulerStats,
      uptime: metrics.uptime,
    };
  });

  // N5: Engine summary endpoint
  app.get('/engine/summary', async () => {
    const metrics = getMetrics();
    
    // Get extended health safely
    let extended: any = {
      engine: 'ok',
      mlOverlayMode: 'SHADOW',
      datasetRows: 0,
      scenariosCount: 0,
      outcomesCount: 0,
    };
    try {
      extended = await getExtendedHealth(db);
    } catch (err) {
      console.warn('[Engine Summary] getExtendedHealth error:', err);
    }
    
    // Get registry stats safely
    let patternsImplemented = 0;
    let registryPatterns = 78;
    try {
      const stats = getRegistryStats();
      if (stats) {
        registryPatterns = stats.total || 78;
        patternsImplemented = stats.implemented || 0;
      }
    } catch (err) {
      console.warn('[Engine Summary] getRegistryStats error:', err);
    }

    return {
      ok: true,
      phase: 'N',
      patternsImplemented,
      registryPatterns,
      scenariosPerRun: 20,
      calibrationMode: 'CALIBRATED',
      mlOverlayMode: extended.mlOverlayMode || 'SHADOW',
      mtfEnabled: true,
      datasetRows: extended.datasetRows || 0,
      scenariosCount: extended.scenariosCount || 0,
      outcomesCount: extended.outcomesCount || 0,
      cacheHitRate: metrics.cacheHitRate,
      avgLatencyMs: metrics.avgLatencyMs,
    };
  });

  // N1: Cache management endpoints
  app.get('/cache/stats', async () => {
    const stats = getCacheStats();
    return { ok: true, ...stats };
  });

  app.post('/cache/config', async (request: FastifyRequest<{
    Body: { l1TtlMs?: number; l2TtlMs?: number; enabled?: boolean }
  }>) => {
    const body = request.body || {};
    setCacheConfig(body);
    return { ok: true, config: getCacheStats().config };
  });

  app.post('/cache/clear', async () => {
    const result = await clearAllCache(db);
    return { ok: true, ...result };
  });

  // N4: Metrics endpoints
  app.get('/metrics', async () => {
    const metrics = getMetrics();
    return { ok: true, ...metrics };
  });

  // N3: Scheduler endpoints
  app.get('/scheduler/stats', async () => {
    const stats = getSchedulerStats();
    return { ok: true, ...stats };
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE O: REAL-TIME STREAMING
  // ═══════════════════════════════════════════════════════════════

  // Initialize outbox indexes
  await initOutboxIndexes(db);

  // Register stream routes
  await registerStreamRoutes(app, {
    db,
    bus: globalEventBus,
    streamService,
    outboxEnabled: true,
  });

  // Register WebSocket handler
  // Note: WebSocket requires @fastify/websocket plugin registered at app level
  // await registerTAWebSocket(app, { bus: globalEventBus });

  console.log('[TA] Phase N (Production Hardening) and Phase O (Streaming) initialized');

  // ═══════════════════════════════════════════════════════════════
  // PHASE S: PRODUCTION HARDENING V2 (Config, Freeze, Cache, Breaker, RNG)
  // ═══════════════════════════════════════════════════════════════

  // S1: Admin config endpoint
  app.get('/admin/config', async () => {
    return {
      ok: true,
      config: getTAConfig(),
      frozen: isFrozen(),
    };
  });

  // S1: Freeze control
  app.post('/admin/freeze', async (request: FastifyRequest<{
    Body: { enabled: boolean }
  }>) => {
    const { enabled } = request.body || { enabled: true };
    
    try {
      updateTAConfig({ freezeEnabled: enabled });
      logger.info({ phase: 'admin', action: 'freeze', enabled }, 'Freeze state changed');
      return {
        ok: true,
        freezeEnabled: enabled,
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  // S2: Provider status endpoint
  app.get('/provider/status', async () => {
    const config = getTAConfig();
    const breaker = getCircuitBreaker('provider');
    const breakerStats = breaker.getStats();
    const cache = getCandleCache();
    const cacheStats = cache.getStats();
    const rateLimiter = getRateLimiter();
    const rlStats = rateLimiter.getStats();
    
    return {
      ok: true,
      provider: config.provider,
      breaker: {
        state: breakerStats.state,
        consecutiveFailures: breakerStats.consecutiveFailures,
        timeUntilReset: breakerStats.timeUntilReset,
        totalCalls: breakerStats.totalCalls,
        totalFailures: breakerStats.totalFailures,
        totalRejected: breakerStats.totalRejected,
      },
      cache: {
        size: cacheStats.size,
        maxKeys: cacheStats.maxKeys,
        hitRate: cacheStats.hitRate,
        hits: cacheStats.hits,
        misses: cacheStats.misses,
      },
      rateLimit: {
        rps: rlStats.rps,
        allowed: rlStats.allowed,
        rejected: rlStats.rejected,
      },
    };
  });

  // S3: RNG endpoints
  app.post('/admin/rng/reset', async () => {
    resetRNG();
    const rng = getRNG();
    return {
      ok: true,
      seed: rng.getState(),
      message: 'RNG reset to configured seed',
    };
  });

  app.get('/admin/rng/state', async () => {
    const rng = getRNG();
    const config = getTAConfig();
    return {
      ok: true,
      currentState: rng.getState(),
      configuredSeed: config.seed,
    };
  });

  // S2: Infra cache management
  app.post('/admin/infra-cache/clear', async () => {
    const cache = getCandleCache();
    const beforeSize = cache.getStats().size;
    cache.clear();
    return {
      ok: true,
      cleared: beforeSize,
      message: `Cleared ${beforeSize} cache entries`,
    };
  });

  app.post('/admin/infra-cache/prune', async () => {
    const cache = getCandleCache();
    const pruned = cache.prune();
    return {
      ok: true,
      pruned,
      message: `Pruned ${pruned} expired entries`,
    };
  });

  // S2: Circuit breaker management
  app.get('/admin/breakers', async () => {
    const breakers = getAllBreakers();
    const result: Record<string, any> = {};
    
    for (const [name, breaker] of breakers) {
      result[name] = breaker.getStats();
    }
    
    return {
      ok: true,
      breakers: result,
    };
  });

  app.post('/admin/breaker/reset', async (request: FastifyRequest<{
    Body: { service?: string }
  }>) => {
    const { service = 'provider' } = request.body || {};
    const breaker = getCircuitBreaker(service);
    breaker.reset();
    
    return {
      ok: true,
      service,
      state: breaker.getState(),
      message: `Circuit breaker "${service}" reset to CLOSED`,
    };
  });

  // S4: Infra metrics endpoint
  app.get('/infra/metrics', async () => {
    const infraMetrics = getInfraMetrics().getMetrics();
    return {
      ok: true,
      phase: 'S',
      description: 'Phase S Infrastructure Metrics',
      ...infraMetrics,
    };
  });

  console.log('[TA] Phase S (Production Hardening v2) initialized');

  // ═══════════════════════════════════════════════════════════════
  // PHASE U: PERFORMANCE ENGINE
  // ═══════════════════════════════════════════════════════════════

  // U1: Fast analyze endpoint with performance optimizations
  app.get('/analyze/fast', async (request: FastifyRequest<{
    Querystring: { 
      asset?: string; 
      timeframe?: string; 
      lookback?: string;
      concurrency?: string;
      maxPatterns?: string;
    }
  }>) => {
    const { 
      asset = 'BTC', 
      timeframe = '1D', 
      lookback = '200',
      concurrency = '4',
      maxPatterns = '500'
    } = request.query;

    const opts: Partial<FastEngineOptions> = {
      concurrency: parseInt(concurrency, 10),
      maxTotalPatterns: parseInt(maxPatterns, 10),
      enableTimings: true,
      enableGating: true,
    };

    try {
      // Get candles from mock market data provider
      const { MockMarketDataProvider } = await import('../data/market.provider.js');
      const provider = new MockMarketDataProvider();
      const symbol = asset.toUpperCase() + 'USDT';
      const candles = await provider.getCandles(symbol, timeframe, parseInt(lookback, 10));
      
      if (!candles || candles.length < 20) {
        return { ok: false, error: 'Insufficient candle data' };
      }

      // Get full analysis context
      const baseResult = await taService.analyze({
        asset,
        timeframe,
        lookback: parseInt(lookback, 10),
      });

      // Build context for fast engine with actual candles
      const ctx = {
        candles: candles,
        pivots: baseResult.pivots || [],
        levels: baseResult.levels || [],
        structure: baseResult.structure,
        indicators: baseResult.indicators,
        features: baseResult.features,
        vol: baseResult.vol,
      };

      // Run fast engine
      const result = await runPatternEngineFast(ctx as any, opts);
      
      // Analyze performance
      const analysis = result.timings ? analyzeTimings(result.timings) : null;

      return {
        ok: true,
        phase: 'U',
        asset,
        timeframe,
        candleCount: candles.length,
        pivotCount: ctx.pivots.length,
        patterns: result.patterns,
        patternCount: result.patterns.length,
        performance: {
          timings: result.timings,
          analysis,
          familiesRun: result.familiesRun,
          familiesSkipped: result.familiesSkipped,
          totalDetectors: result.totalDetectors,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  // U2: Performance benchmark endpoint
  app.get('/perf/benchmark', async (request: FastifyRequest<{
    Querystring: { 
      asset?: string; 
      timeframe?: string; 
      iterations?: string;
    }
  }>) => {
    const { 
      asset = 'BTC', 
      timeframe = '1D', 
      iterations = '5'
    } = request.query;

    const numIterations = parseInt(iterations, 10);
    const results: any[] = [];

    for (let i = 0; i < numIterations; i++) {
      const start = Date.now();
      
      const baseResult = await taService.analyze({
        asset,
        timeframe,
        lookback: 200,
      });

      if (baseResult.ok) {
        const ctx = {
          candles: baseResult.candles || [],
          pivots: baseResult.pivots || [],
          levels: baseResult.levels || [],
          structure: baseResult.structure,
          indicators: baseResult.indicators,
          features: baseResult.features,
        };

        const fastResult = await runPatternEngineFast(ctx as any, {
          concurrency: 4,
          enableTimings: true,
        });

        results.push({
          iteration: i + 1,
          totalMs: Date.now() - start,
          patternCount: fastResult.patterns.length,
          timings: fastResult.timings,
        });
      }
    }

    // Calculate stats
    const totalTimes = results.map(r => r.totalMs);
    const avgMs = totalTimes.reduce((s, v) => s + v, 0) / totalTimes.length;
    const minMs = Math.min(...totalTimes);
    const maxMs = Math.max(...totalTimes);

    return {
      ok: true,
      phase: 'U',
      benchmark: {
        asset,
        timeframe,
        iterations: numIterations,
        avgMs: Math.round(avgMs),
        minMs,
        maxMs,
        p50Ms: totalTimes.sort((a, b) => a - b)[Math.floor(numIterations / 2)],
      },
      results,
    };
  });

  // U3: Active families endpoint (what would run for given context)
  app.get('/perf/families', async (request: FastifyRequest<{
    Querystring: { 
      candleCount?: string;
      pivotCount?: string;
      regime?: string;
      hasVolume?: string;
    }
  }>) => {
    const { 
      candleCount = '200',
      pivotCount = '20',
      regime = 'TREND',
      hasVolume = 'true'
    } = request.query;

    const gatingCtx: GatingContext = {
      candleCount: parseInt(candleCount, 10),
      pivotCount: parseInt(pivotCount, 10),
      regime,
      hasVolume: hasVolume === 'true',
      volatility: 0.15,
      trendStrength: 0.05,
      cache: {} as any,
    };

    const activeFamilies = getActiveFamilies(gatingCtx);

    return {
      ok: true,
      phase: 'U',
      context: {
        candleCount: gatingCtx.candleCount,
        pivotCount: gatingCtx.pivotCount,
        regime: gatingCtx.regime,
        hasVolume: gatingCtx.hasVolume,
      },
      activeFamilies,
      activeFamilyCount: activeFamilies.length,
    };
  });

  // U4: Engine config endpoint
  app.get('/perf/config', async () => {
    return {
      ok: true,
      phase: 'U',
      defaultOptions: DEFAULT_FAST_ENGINE_OPTIONS,
      description: 'Phase U Performance Engine Configuration',
    };
  });

  console.log('[TA] Phase U (Performance Engine) initialized');

  // ═══════════════════════════════════════════════════════════════
  // PHASE V: REPLAY ENGINE
  // ═══════════════════════════════════════════════════════════════

  // Initialize replay indexes
  initDatasetIndexes().catch(err => {
    console.error('[TA] Failed to init dataset indexes:', err);
  });

  // V1: Get replay status
  app.get('/replay/status', async () => {
    const engine = getReplayEngine();
    const status = engine.getStatus();
    
    return {
      ok: true,
      phase: 'V',
      isRunning: engine.isActive(),
      status,
    };
  });

  // V2: Start replay run
  app.post('/replay/run', async (request: FastifyRequest<{
    Body: {
      symbol: string;
      timeframe: string;
      startDate: string;  // ISO date
      endDate: string;    // ISO date
      stepSize?: number;
      lookback?: number;
    }
  }>) => {
    const { 
      symbol = 'BTCUSDT', 
      timeframe = '1h',
      startDate,
      endDate,
      stepSize = 1,
      lookback = 200
    } = request.body || {};

    const engine = getReplayEngine();
    
    if (engine.isActive()) {
      return { ok: false, error: 'Replay already running' };
    }

    const config: ReplayConfig = {
      symbol,
      timeframe,
      startTime: new Date(startDate || '2024-01-01').getTime(),
      endTime: new Date(endDate || '2024-06-01').getTime(),
      stepSize,
      lookback,
      batchSize: 100,
    };

    // Start replay in background
    engine.start(config).catch(err => {
      console.error('[TA] Replay error:', err);
    });

    return {
      ok: true,
      phase: 'V',
      message: 'Replay started',
      config,
    };
  });

  // V3: Stop replay
  app.post('/replay/stop', async () => {
    const engine = getReplayEngine();
    engine.stop();
    
    return {
      ok: true,
      phase: 'V',
      message: 'Replay stop requested',
    };
  });

  // V4: Get Binance provider status
  app.get('/provider/binance/status', async () => {
    try {
      const provider = getBinanceProviderV2();
      return {
        ok: true,
        phase: 'V',
        ...provider.getStatus(),
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  console.log('[TA] Phase V (Replay Engine) initialized');

  // ═══════════════════════════════════════════════════════════════
  // PHASE W: ML TRAINING PIPELINE
  // ═══════════════════════════════════════════════════════════════

  // Initialize ML indexes
  initModelIndexes().catch(err => {
    console.error('[TA] Failed to init model indexes:', err);
  });

  // W1: Dataset status
  app.get('/ml/dataset/status', async () => {
    try {
      const stats = await getDatasetStats();
      return {
        ok: true,
        phase: 'W',
        ...stats,
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  // W2: Dataset preview
  app.get('/ml/dataset/preview', async (request: FastifyRequest<{
    Querystring: { n?: string }
  }>) => {
    const { n = '10' } = request.query;
    
    try {
      const rows = await getDatasetPreview(parseInt(n, 10));
      return {
        ok: true,
        phase: 'W',
        count: rows.length,
        rows,
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  // W3: Dataset schema
  app.get('/ml/dataset/schema', async () => {
    return {
      ok: true,
      phase: 'W',
      featureNames: getFeatureNames(),
      featureCount: getFeatureNames().length,
    };
  });

  // W4: Export dataset to CSV
  app.get('/ml/dataset/export', async () => {
    try {
      const csv = await exportDatasetCSV();
      return {
        ok: true,
        phase: 'W',
        format: 'csv',
        rows: csv.split('\n').length - 1,
        data: csv,
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  // W5: List all models
  app.get('/ml/models', async () => {
    try {
      const models = await getAllModels();
      return {
        ok: true,
        phase: 'W',
        count: models.length,
        models,
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  // W6: Get active model
  app.get('/ml/models/active', async () => {
    try {
      const model = await getActiveModel();
      return {
        ok: true,
        phase: 'W',
        hasActiveModel: !!model,
        model,
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  // W7: Activate model
  app.post('/ml/models/activate', async (request: FastifyRequest<{
    Body: { modelId: string; status: string }
  }>) => {
    const { modelId, status } = request.body || {};
    
    if (!modelId || !status) {
      return { ok: false, error: 'modelId and status required' };
    }
    
    try {
      const result = await activateModel(modelId, status as any);
      return {
        ok: result.success,
        phase: 'W',
        error: result.error,
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  // W8: ML training status (placeholder for Python job)
  app.get('/ml/train/status', async () => {
    return {
      ok: true,
      phase: 'W',
      status: 'NOT_IMPLEMENTED',
      message: 'Python training job not yet integrated',
      nextStep: 'Create /ml/train.py with LightGBM/CatBoost',
    };
  });

  console.log('[TA] Phase W (ML Pipeline) initialized');

  // ═══════════════════════════════════════════════════════════════
  // PHASE AC: PROJECTION ENGINE (RenderPack)
  // ═══════════════════════════════════════════════════════════════

  // Import projection engine
  const { projectionEngine } = await import('../projection/index.js');

  // AC1: Get RenderPack for visualization
  app.get('/render', async (request: FastifyRequest<{
    Querystring: { symbol?: string; tf?: string; lookback?: string }
  }>) => {
    const { symbol = 'BTCUSDT', tf = '1D', lookback = '200' } = request.query;
    
    try {
      // Get TA context
      const ctx = await taService.getContext(symbol, parseInt(lookback, 10));
      
      if (!ctx) {
        return { 
          ok: false, 
          error: 'Failed to get TA context',
          symbol,
          timeframe: tf
        };
      }
      
      // Get scored patterns
      const analysis = await taService.analyze({ 
        asset: symbol, 
        timeframe: tf, 
        lookback: parseInt(lookback, 10) 
      });
      
      if (!analysis.ok || !analysis.patterns?.length) {
        return {
          ok: false,
          error: 'No patterns found for rendering',
          symbol,
          timeframe: tf,
          patternsFound: 0
        };
      }
      
      // Generate RenderPack
      const renderPack = projectionEngine.generateRenderPack({
        ctx,
        patterns: analysis.patterns,
        symbol,
        timeframe: tf
      });
      
      return {
        ok: true,
        phase: 'AC',
        description: 'Projection Engine — RenderPack for visualization',
        ...renderPack
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  // AC2: Get RenderPack with full Decision
  app.get('/render/decision', async (request: FastifyRequest<{
    Querystring: { symbol?: string; tf?: string; lookback?: string }
  }>) => {
    const { symbol = 'BTCUSDT', tf = '1D', lookback = '200' } = request.query;
    
    try {
      // Get TA context
      const ctx = await taService.getContext(symbol, parseInt(lookback, 10));
      
      if (!ctx) {
        return { ok: false, error: 'Failed to get TA context' };
      }
      
      // Get full decision
      const analysis = await taService.analyze({ 
        asset: symbol, 
        timeframe: tf, 
        lookback: parseInt(lookback, 10) 
      });
      
      if (!analysis.ok || !analysis.patterns?.length) {
        return { ok: false, error: 'No patterns found' };
      }
      
      // Build hypotheses for decision
      const candidates = analysis.patterns.map((p: any) => ({
        id: p.id,
        type: p.type,
        group: PATTERN_REGISTRY[p.type]?.group || 'UNKNOWN',
        direction: p.direction || PATTERN_REGISTRY[p.type]?.direction || 'BOTH',
        baseScore: p.metrics?.totalScore || p.score || 0.5,
        finalScore: p.metrics?.totalScore || p.score || 0.5,
        exclusivityKey: PATTERN_REGISTRY[p.type]?.exclusivityKey || 'none',
        priority: PATTERN_REGISTRY[p.type]?.priority || 50,
        metrics: p.metrics,
      }));
      
      const hypotheses = buildHypothesesFromPatterns(symbol, tf, candidates, {
        beamWidth: 20,
        topN: 20,
        minComponents: 1,
      });
      
      // Build decision pack
      const decisionPack = await buildDecisionPack({
        runId: analysis.runId || `run_${Date.now()}`,
        asset: symbol,
        timeframe: tf,
        engineVersion: '2.0.0-phase-ac',
        hypotheses,
      });
      
      // Generate RenderPack
      const renderPack = projectionEngine.generateRenderPack({
        ctx,
        patterns: analysis.patterns,
        symbol,
        timeframe: tf
      });
      
      return {
        ok: true,
        phase: 'AC',
        runId: decisionPack.runId,
        symbol,
        timeframe: tf,
        
        // Decision
        decision: {
          top: decisionPack.top,
          bench: decisionPack.bench,
          summary: decisionPack.summary
        },
        
        // Render data
        render: renderPack,
        
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  // AC3: Get projection for specific pattern
  app.get('/render/projection/:patternType', async (request: FastifyRequest<{
    Params: { patternType: string };
    Querystring: { symbol?: string; tf?: string }
  }>) => {
    const { patternType } = request.params;
    const { symbol = 'BTCUSDT', tf = '1D' } = request.query;
    
    try {
      const analysis = await taService.analyze({ asset: symbol, timeframe: tf });
      
      if (!analysis.ok) {
        return { ok: false, error: 'Analysis failed' };
      }
      
      // Find pattern of specified type
      const pattern = analysis.patterns?.find((p: any) => p.type === patternType);
      
      if (!pattern) {
        return { 
          ok: false, 
          error: `Pattern ${patternType} not found in current analysis`,
          availablePatterns: analysis.patterns?.map((p: any) => p.type) || []
        };
      }
      
      // Get projector
      const { triangleProjector, flagProjector, hsShouldersProjector, harmonicProjector, elliottProjector, channelProjector } = await import('../projection/index.js');
      
      const projectors = [triangleProjector, flagProjector, hsShouldersProjector, harmonicProjector, elliottProjector, channelProjector];
      const projector = projectors.find(p => p.supportedPatterns.includes(patternType));
      
      if (!projector) {
        return {
          ok: false,
          error: `No projector available for pattern type ${patternType}`,
          supportedTypes: projectors.flatMap(p => p.supportedPatterns)
        };
      }
      
      // Build pattern layer
      const patternLayer = {
        kind: 'PATTERN' as const,
        id: pattern.id,
        patternType: pattern.type,
        direction: pattern.direction as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
        points: pattern.geometry?.pivots?.map((p: any) => ({ x: p.i, y: p.price, label: p.type })) || [],
        lines: pattern.geometry?.lines || [],
        zones: pattern.geometry?.zones || [],
        score: pattern.scoring?.score || 0.5,
        contribution: 1,
        reasons: []
      };
      
      // Get context
      const lastCandle = analysis.structure?.lastSwingHigh;
      const atr = analysis.features?.atr14 || 1000;
      
      const projContext = {
        currentPrice: analysis.structure?.currentPrice || 50000,
        atr,
        timeframe: tf,
        regime: analysis.structure?.regime || 'RANGE',
        ma50: analysis.featuresPack?.ma?.ma50,
        ma200: analysis.featuresPack?.ma?.ma200
      };
      
      const projection = projector.project(patternLayer, projContext);
      
      return {
        ok: true,
        patternType,
        symbol,
        timeframe: tf,
        pattern: patternLayer,
        projection,
        projector: {
          id: projector.id,
          name: projector.name,
          supportedPatterns: projector.supportedPatterns
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  // AC4: Get pattern priors (from TA textbook)
  app.get('/render/priors', async () => {
    const { PATTERN_PRIORS } = await import('../projection/projection_types.js');
    
    return {
      ok: true,
      phase: 'AC',
      description: 'Pattern priors from technical analysis textbook',
      count: PATTERN_PRIORS.length,
      priors: PATTERN_PRIORS.map(p => ({
        type: p.type,
        direction: p.direction,
        baseProbability: (p.baseProbability * 100).toFixed(0) + '%',
        avgTargetATR: p.avgTargetATR,
        avgDurationBars: p.avgDurationBars,
        winRateHistorical: (p.winRateHistorical * 100).toFixed(0) + '%'
      }))
    };
  });

  console.log('[TA] Phase AC (Projection Engine) initialized');

  // ═══════════════════════════════════════════════════════════════
  // PHASE AD: MULTI-TIMEFRAME GENERALIZATION
  // ═══════════════════════════════════════════════════════════════

  const { 
    TIMEFRAME_SPECS, 
    getTimeframeSpec, 
    getSupportedTimeframes,
    getPatternWindow,
    getProjectionDuration,
    barsToTimeString
  } = await import('../timeframe/index.js');

  // AD1: Get all supported timeframes
  app.get('/timeframes', async () => {
    return {
      ok: true,
      phase: 'AD',
      description: 'Multi-Timeframe Generalization',
      supported: getSupportedTimeframes(),
      specs: Object.entries(TIMEFRAME_SPECS)
        .filter(([k]) => !k.match(/^[A-Z]/)) // Exclude aliases
        .map(([id, spec]) => ({
          id,
          label: spec.label,
          candleSeconds: spec.candleSeconds,
          patternWindow: { min: spec.minPatternCandles, max: spec.maxPatternCandles },
          atrMultiplier: spec.atrMultiplier,
          projectionSpeed: spec.projectionSpeed,
          defaultTimeout: spec.defaultTimeout,
        }))
    };
  });

  // AD2: Get spec for specific timeframe
  app.get('/timeframe/:tf', async (request: FastifyRequest<{ Params: { tf: string } }>) => {
    const { tf } = request.params;
    const spec = getTimeframeSpec(tf);
    
    return {
      ok: true,
      timeframe: tf,
      spec: {
        ...spec,
        patternWindow: getPatternWindow(tf),
        projectionExample: {
          baseDuration: 20,
          scaledDuration: getProjectionDuration(20, tf),
          timeString: barsToTimeString(getProjectionDuration(20, tf), tf),
        }
      }
    };
  });

  console.log('[TA] Phase AD (Multi-Timeframe) initialized');

  // ═══════════════════════════════════════════════════════════════
  // PHASE AE1: SCENARIO BEHAVIOUR STORAGE
  // ═══════════════════════════════════════════════════════════════

  const { 
    initBehaviourStorage, 
    getBehaviourStorage,
    createBehaviourAggregator,
    buildBehaviourKey,
    getBehaviourKeyLabel,
    getDefaultProtocol,
    DEFAULT_PROTOCOLS
  } = await import('../behavior/index.js');

  // Initialize storage
  if (db) {
    const storage = initBehaviourStorage(db);
    await storage.initialize();
    console.log('[TA] Phase AE1 (Behaviour Storage) initialized');
  }

  // AE1: Get behaviour storage stats
  app.get('/behavior/stats', async () => {
    const storage = getBehaviourStorage();
    if (!storage) {
      return { ok: false, error: 'Behaviour storage not initialized' };
    }

    const total = await storage.getTotalCount();
    const byStatus = await storage.countByStatus();

    return {
      ok: true,
      phase: 'AE1',
      description: 'Scenario Behaviour Storage',
      total,
      byStatus,
      winRate: byStatus.WIN + byStatus.LOSS > 0 
        ? (byStatus.WIN / (byStatus.WIN + byStatus.LOSS) * 100).toFixed(1) + '%'
        : 'N/A'
    };
  });

  // AE1: Get pattern stats
  app.get('/behavior/pattern/:patternType', async (request: FastifyRequest<{
    Params: { patternType: string }
  }>) => {
    const { patternType } = request.params;
    const aggregator = createBehaviourAggregator();
    
    if (!aggregator) {
      return { ok: false, error: 'Aggregator not available' };
    }

    const stats = await aggregator.computePatternStats(patternType);
    const boosts = await aggregator.getConditionBoosts(patternType);

    return {
      ok: true,
      patternType,
      stats,
      conditionBoosts: boosts.slice(0, 10),
      defaultProtocol: getDefaultProtocol(patternType)
    };
  });

  // AE1: Get top patterns by performance
  app.get('/behavior/top_patterns', async (request: FastifyRequest<{
    Querystring: { minSamples?: string; limit?: string }
  }>) => {
    const minSamples = parseInt(request.query.minSamples || '10', 10);
    const limit = parseInt(request.query.limit || '20', 10);
    
    const aggregator = createBehaviourAggregator();
    if (!aggregator) {
      return { ok: false, error: 'Aggregator not available' };
    }

    const rankings = await aggregator.getTopPatterns(minSamples, limit);

    return {
      ok: true,
      phase: 'AE1',
      minSamples,
      count: rankings.length,
      rankings: rankings.map(r => ({
        ...r,
        successRate: (r.successRate * 100).toFixed(1) + '%',
        expectancy: r.expectancy.toFixed(2),
      }))
    };
  });

  // AE1: Get behaviour key stats
  app.get('/behavior/key/:behaviourKey', async (request: FastifyRequest<{
    Params: { behaviourKey: string }
  }>) => {
    const { behaviourKey } = request.params;
    const aggregator = createBehaviourAggregator();
    
    if (!aggregator) {
      return { ok: false, error: 'Aggregator not available' };
    }

    const stats = await aggregator.computeBehaviourKeyStats(behaviourKey);

    return {
      ok: true,
      behaviourKey,
      stats
    };
  });

  // AE1: Get all behaviour keys summary
  app.get('/behavior/keys', async () => {
    const aggregator = createBehaviourAggregator();
    if (!aggregator) {
      return { ok: false, error: 'Aggregator not available' };
    }

    const summary = await aggregator.getBehaviourKeySummary();

    return {
      ok: true,
      phase: 'AE1',
      totalKeys: summary.length,
      keys: summary.slice(0, 50)
    };
  });

  // AE1: Get available protocols
  app.get('/behavior/protocols', async () => {
    return {
      ok: true,
      phase: 'AE1',
      description: 'Default trading protocols by pattern type',
      count: Object.keys(DEFAULT_PROTOCOLS).length,
      protocols: Object.entries(DEFAULT_PROTOCOLS).map(([pattern, protocol]) => ({
        pattern,
        ...protocol
      }))
    };
  });

  // AE1: Save scenario for tracking (internal use)
  app.post('/behavior/scenario', async (request: FastifyRequest<{
    Body: {
      runId: string;
      scenarioId: string;
      symbol: string;
      timeframe: string;
      patternType: string;
      patternGroup: string;
      direction: 'BULLISH' | 'BEARISH';
      patternScore: number;
      context: any;
      projection: {
        entry: number;
        stop: number;
        target: number;
        riskReward: number;
        probability: number;
      };
      signalBar: number;
    }
  }>) => {
    const storage = getBehaviourStorage();
    if (!storage) {
      return { ok: false, error: 'Storage not initialized' };
    }

    try {
      const id = await storage.saveScenario(request.body);
      return { ok: true, id, behaviourKey: buildBehaviourKey(
        request.body.patternType,
        getDefaultProtocol(request.body.patternType),
        request.body.timeframe
      )};
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });

  // AE1: Update scenario outcome
  app.put('/behavior/scenario/:scenarioId/outcome', async (request: FastifyRequest<{
    Params: { scenarioId: string };
    Body: {
      status: 'WIN' | 'LOSS' | 'TIMEOUT' | 'NO_ENTRY';
      barsToOutcome: number;
      mfe: number;
      mae: number;
      rMultiple?: number;
    }
  }>) => {
    const storage = getBehaviourStorage();
    if (!storage) {
      return { ok: false, error: 'Storage not initialized' };
    }

    const { scenarioId } = request.params;
    const outcome = {
      ...request.body,
      closedBy: request.body.status === 'WIN' ? 'TARGET' as const : 
                request.body.status === 'LOSS' ? 'STOP' as const : 
                'TIMEOUT' as const
    };

    const updated = await storage.updateOutcome(scenarioId, outcome);
    return { ok: updated, scenarioId };
  });

  console.log('[TA] Phase AE1 (Behaviour Analytics) initialized');

  // ═══════════════════════════════════════════════════════════════
  // PHASE AE2: BEHAVIOUR INTELLIGENCE
  // ═══════════════════════════════════════════════════════════════

  const {
    initBehaviourBuilder,
    getBehaviourBuilder,
    applyBehaviourBoost,
    runProbabilityPipeline,
    getTopBehaviourKeys,
    DEFAULT_BEHAVIOUR_RULES
  } = await import('../behavior/index.js');

  // Initialize behaviour builder
  if (db) {
    const builder = initBehaviourBuilder(db);
    await builder.initialize();
    console.log('[TA] Phase AE2 (Behaviour Intelligence) initialized');
  }

  // AE2: Rebuild behaviour model
  app.post('/behaviour_model/rebuild', async () => {
    const builder = getBehaviourBuilder();
    if (!builder) {
      return { ok: false, error: 'Behaviour builder not initialized' };
    }

    try {
      const model = await builder.build();
      return {
        ok: true,
        modelId: model.modelId,
        version: model.version,
        keysCount: model.keys.length,
        conditionsCount: model.conditions.length,
        buildDurationMs: model.buildDurationMs,
        summary: model.summary
      };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });

  // AE2: Get behaviour model status
  app.get('/behaviour_model/status', async () => {
    const builder = getBehaviourBuilder();
    if (!builder) {
      return { ok: false, error: 'Behaviour builder not initialized' };
    }

    const status = await builder.getStatus();
    return { ok: true, phase: 'AE2', ...status };
  });

  // AE2: Get latest behaviour model
  app.get('/behaviour_model/latest', async () => {
    const builder = getBehaviourBuilder();
    if (!builder) {
      return { ok: false, error: 'Behaviour builder not initialized' };
    }

    const model = await builder.getLatestModel();
    if (!model) {
      return { ok: false, error: 'No model found. Run /behaviour_model/rebuild first.' };
    }

    return {
      ok: true,
      model: {
        modelId: model.modelId,
        version: model.version,
        builtAt: model.builtAt,
        rules: model.rules,
        keysCount: model.keys.length,
        conditionsCount: model.conditions.length,
        topKeys: model.keys.slice(0, 10).map(k => ({
          behaviourKey: k.behaviourKey,
          n: k.n,
          winRate: (k.winRate * 100).toFixed(1) + '%',
          boost: (k.boost * 100).toFixed(1) + '%',
          confidence: (k.confidence * 100).toFixed(0) + '%'
        })),
        topConditions: model.conditions.slice(0, 10).map(c => ({
          patternType: c.patternType,
          condition: c.condition,
          n: c.n,
          deltaWinRate: (c.deltaWinRate * 100).toFixed(1) + '%',
          boost: (c.boost * 100).toFixed(1) + '%'
        })),
        summary: model.summary
      }
    };
  });

  // AE2: Test behaviour boost application
  app.post('/behaviour/apply', async (request: FastifyRequest<{
    Body: {
      behaviourKey: string;
      patternType: string;
      probability: number;
    }
  }>) => {
    const { behaviourKey, patternType, probability } = request.body;
    
    const result = await applyBehaviourBoost({
      probability,
      behaviourKey,
      patternType
    });

    return {
      ok: true,
      phase: 'AE2',
      input: { behaviourKey, patternType, probability },
      result: {
        probabilityBefore: (result.probabilityBefore * 100).toFixed(1) + '%',
        probabilityAfter: (result.probabilityAfter * 100).toFixed(1) + '%',
        boost: (result.boost * 100).toFixed(1) + '%'
      },
      explanation: result.explanation
    };
  });

  // AE2: Get top behaviour keys by performance
  app.get('/behaviour/keys/top', async (request: FastifyRequest<{
    Querystring: { limit?: string }
  }>) => {
    const limit = parseInt(request.query.limit || '20', 10);
    const topKeys = await getTopBehaviourKeys(limit);

    return {
      ok: true,
      phase: 'AE2',
      count: topKeys.length,
      keys: topKeys.map(k => ({
        rank: k.rank,
        behaviourKey: k.behaviourKey,
        samples: k.n,
        winRate: (k.winRate * 100).toFixed(1) + '%',
        avgR: k.avgR.toFixed(2),
        boost: (k.boost * 100).toFixed(1) + '%',
        confidence: (k.confidence * 100).toFixed(0) + '%'
      }))
    };
  });

  // AE2: Run full probability pipeline
  app.post('/behaviour/pipeline', async (request: FastifyRequest<{
    Body: {
      textbookPrior: number;
      confluenceScore: number;
      behaviourKey: string;
      patternType: string;
    }
  }>) => {
    const result = await runProbabilityPipeline(request.body);

    return {
      ok: true,
      phase: 'AE2',
      finalProbability: (result.final * 100).toFixed(1) + '%',
      breakdown: {
        textbook: (result.breakdown.textbook * 100).toFixed(1) + '%',
        confluence: (result.breakdown.confluence * 100).toFixed(1) + '%',
        calibrated: (result.breakdown.calibrated * 100).toFixed(1) + '%',
        behaviourBoost: (result.breakdown.behaviourBoost * 100).toFixed(1) + '%',
        final: (result.breakdown.final * 100).toFixed(1) + '%'
      },
      explanation: result.explanation
    };
  });

  console.log('[TA] Phase AE2 (Behaviour Model) endpoints added');

  // ═══════════════════════════════════════════════════════════════
  // PHASE AF: PATTERN DISCOVERY ENGINE
  // ═══════════════════════════════════════════════════════════════

  const {
    initDiscoveryEngine,
    getDiscoveryEngine,
    DEFAULT_DISCOVERY_CONFIG
  } = await import('../discovery/index.js');

  // Initialize discovery engine
  if (db) {
    const discoveryEngine = initDiscoveryEngine(db);
    await discoveryEngine.initialize();
    console.log('[TA] Phase AF (Pattern Discovery) initialized');
  }

  // AF: Get discovery stats
  app.get('/discovery/stats', async () => {
    const engine = getDiscoveryEngine();
    if (!engine) {
      return { ok: false, error: 'Discovery engine not initialized' };
    }

    const stats = await engine.getStats();
    return {
      ok: true,
      phase: 'AF',
      description: 'Pattern Discovery Engine - finds NEW patterns not in TA textbook',
      ...stats
    };
  });

  // AF: Run discovery session
  app.post('/discovery/run', async (request: FastifyRequest<{
    Body?: {
      minStructureSize?: number;
      maxStructureSize?: number;
      minClusterSize?: number;
    }
  }>) => {
    const engine = getDiscoveryEngine();
    if (!engine) {
      return { ok: false, error: 'Discovery engine not initialized' };
    }

    // Get candles from TA service
    const ctx = await taService.getContext('BTCUSDT', 500);
    if (!ctx?.series?.candles) {
      return { ok: false, error: 'No candle data available' };
    }

    const candles = ctx.series.candles.map((c: any) => ({
      time: c.time || Date.now(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume
    }));

    try {
      const session = await engine.runDiscovery(candles, request.body || {});
      return {
        ok: true,
        phase: 'AF',
        session: {
          sessionId: session.sessionId,
          durationMs: session.durationMs,
          ...session.results
        }
      };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });

  // AF: Get discovered patterns
  app.get('/discovery/patterns', async (request: FastifyRequest<{
    Querystring: { valid?: string; limit?: string }
  }>) => {
    const engine = getDiscoveryEngine();
    if (!engine) {
      return { ok: false, error: 'Discovery engine not initialized' };
    }

    const validOnly = request.query.valid === 'true';
    const limit = parseInt(request.query.limit || '50', 10);

    const patterns = validOnly 
      ? await engine.getValidPatterns()
      : await engine.getPatterns(limit);

    return {
      ok: true,
      phase: 'AF',
      count: patterns.length,
      patterns: patterns.map(p => ({
        patternId: p.patternId,
        name: p.name,
        description: p.description,
        samples: p.stats.samples,
        shape: p.shape,
        winRate: (p.stats.winRate * 100).toFixed(1) + '%',
        isValid: p.validity.isValid,
        significance: (p.validity.statisticalSignificance * 100).toFixed(0) + '%',
        discoveredAt: p.discoveredAt
      }))
    };
  });

  // AF: Get specific pattern
  app.get('/discovery/pattern/:patternId', async (request: FastifyRequest<{
    Params: { patternId: string }
  }>) => {
    const engine = getDiscoveryEngine();
    if (!engine) {
      return { ok: false, error: 'Discovery engine not initialized' };
    }

    const pattern = await engine.getPattern(request.params.patternId);
    if (!pattern) {
      return { ok: false, error: 'Pattern not found' };
    }

    return { ok: true, phase: 'AF', pattern };
  });

  // AF: Get discovery sessions
  app.get('/discovery/sessions', async () => {
    const engine = getDiscoveryEngine();
    if (!engine) {
      return { ok: false, error: 'Discovery engine not initialized' };
    }

    const sessions = await engine.getSessions();
    return {
      ok: true,
      phase: 'AF',
      count: sessions.length,
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        config: s.config,
        results: s.results,
        durationMs: s.durationMs,
        startedAt: s.startedAt
      }))
    };
  });

  // AF: Get discovery config
  app.get('/discovery/config', async () => {
    return {
      ok: true,
      phase: 'AF',
      defaultConfig: DEFAULT_DISCOVERY_CONFIG
    };
  });

  console.log('[TA] Phase AF (Discovery Engine) endpoints added');

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3.0: EXECUTION SIMULATOR
  // ═══════════════════════════════════════════════════════════════

  const {
    initSimStorage,
    getSimStorage,
    initSimRunner,
    getSimRunner,
    getSimConfig,
    DEFAULT_SIM_CONFIG
  } = await import('../simulator/index.js');

  // Initialize simulator storage
  if (db) {
    const simStorage = initSimStorage(db);
    await simStorage.initialize();

    // ── Market Data Provider for Simulator ──
    // Generates deterministic candle history for the full sim range.
    // Uses seeded RNG so the same (symbol, tf, range) always returns
    // identical data — critical for reproducible backtests.
    const marketProvider = {
      getCandles: async (symbol: string, tf: string, toTs: number, limit: number) => {
        try {
          // Step sizes in SECONDS (SimCandle.ts is Unix seconds)
          const tfSec: Record<string, number> = {
            '1m': 60, '5m': 300, '15m': 900,
            '1h': 3600, '1H': 3600,
            '4h': 14400, '4H': 14400,
            '1d': 86400, '1D': 86400,
            '1w': 604800, '1W': 604800,
          };
          const step = tfSec[tf] || 86400;
          const count = Math.min(limit, 50_000);

          // Deterministic seed from symbol
          let seed = 0;
          for (let i = 0; i < symbol.length; i++) seed = (seed * 31 + symbol.charCodeAt(i)) >>> 0;
          const mulberry32 = (s: number) => () => {
            s |= 0; s = s + 0x6D2B79F5 | 0;
            let t = Math.imul(s ^ s >>> 15, 1 | s);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
          };
          const rng = mulberry32(seed);

          let basePrice = 50000;
          if (symbol.toUpperCase().includes('ETH')) basePrice = 3500;
          else if (symbol.toUpperCase() === 'SPX') basePrice = 5800;
          else if (symbol.toUpperCase() === 'DXY') basePrice = 104;

          let price = basePrice;
          const volatility = basePrice * 0.02;
          const candles: any[] = [];

          // Generate candles from (toTs - count*step) to toTs
          const startTs = toTs - count * step;
          for (let i = 0; i < count; i++) {
            const ts = startTs + i * step;
            const change = (rng() - 0.5) * volatility;
            const meanRevert = (basePrice - price) * 0.05;
            price = price + change + meanRevert;

            const open = price;
            const range = price * (0.005 + rng() * 0.015);
            const high = open + range * rng();
            const low = open - range * rng();
            const close = low + (high - low) * rng();
            price = close;

            candles.push({
              ts,
              open: +open.toFixed(2),
              high: +Math.max(open, high, close).toFixed(2),
              low: +Math.min(open, low, close).toFixed(2),
              close: +close.toFixed(2),
              volume: Math.floor(rng() * 10_000_000),
            });
          }

          console.log(`[SimMarket] Generated ${candles.length} candles for ${symbol} ${tf}`);
          return candles;
        } catch (e) {
          console.error('[SimMarket] Error generating candles:', e);
          return [];
        }
      }
    };

    // ── Decision Provider for Simulator ──
    // Uses analyzeWithCandles() to run TA on the provided window
    // WITHOUT re-fetching data → no lookahead bias.
    const decisionProvider = {
      getDecision: async (symbol: string, tf: string, nowTs: number, candles: any[]) => {
        if (!candles || candles.length < 30) return null;

        try {
          // Convert SimCandle[] to internal Candle[] format
          const internalCandles = candles.map((c: any) => ({
            ts: c.ts,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume || 0,
          }));

          // Run TA engine on the exact window — no re-fetch
          const analysis = taService.analyzeWithCandles(internalCandles, symbol, tf);

          if (!analysis.ok || !analysis.patterns?.length) return null;

          const topPattern = analysis.patterns[0];
          const lastPrice = candles[candles.length - 1]?.close || 50000;

          // ATR estimate from last 14 candles
          const recent = candles.slice(-14);
          const atr = recent.reduce((s: number, c: any) => s + (c.high - c.low), 0) / recent.length;

          return {
            scenarios: [{
              scenarioId: topPattern.id || `pat_${nowTs}`,
              patternType: topPattern.type,
              direction: topPattern.direction,
              probability: topPattern.scoring?.score || 0.5,
              intent: { bias: topPattern.direction === 'BEARISH' ? 'SHORT' : 'LONG' },
              riskPack: {
                entryType: 'MARKET',
                entryPrice: lastPrice,
                stopPrice: topPattern.direction === 'BEARISH'
                  ? lastPrice + atr
                  : lastPrice - atr,
                target1Price: topPattern.direction === 'BEARISH'
                  ? lastPrice - atr * 2
                  : lastPrice + atr * 2,
                entryTimeoutBars: 5,
                tradeTimeoutBars: 40,
              },
            }],
          };
        } catch (e) {
          console.warn('[SimDecision] Error:', (e as Error).message);
          return null;
        }
      }
    };

    const runner = initSimRunner(simStorage, marketProvider, decisionProvider);
    console.log('[TA] Phase 3.0 (Execution Simulator) initialized');
  }

  // SIM: Get simulator stats
  app.get('/sim/stats', async () => {
    const storage = getSimStorage();
    if (!storage) {
      return { ok: false, error: 'Simulator storage not initialized' };
    }

    const stats = await storage.getStats();
    return {
      ok: true,
      phase: '3.0',
      description: 'Execution Simulator - converts decisions to simulated trades',
      ...stats
    };
  });

  // SIM: Get simulator config
  app.get('/sim/config', async (request: FastifyRequest<{
    Querystring: { tf?: string }
  }>) => {
    const tf = request.query.tf || '1d';
    const config = getSimConfig(tf);
    return {
      ok: true,
      phase: '3.0',
      timeframe: tf,
      config,
      defaults: DEFAULT_SIM_CONFIG
    };
  });

  // SIM: Run simulation
  app.post('/sim/run', async (request: FastifyRequest<{
    Body: {
      symbol?: string;
      tf?: string;
      fromTs?: number;
      toTs?: number;
      warmupBars?: number;
      seed?: number;
    }
  }>) => {
    const runner = getSimRunner();
    if (!runner) {
      return { ok: false, error: 'Simulator not initialized' };
    }

    const now = Math.floor(Date.now() / 1000);
    const params = {
      symbol: request.body.symbol || 'BTCUSDT',
      tf: request.body.tf || '1D',
      fromTs: request.body.fromTs || now - 86400 * 365, // 1 year ago
      toTs: request.body.toTs || now,
      warmupBars: request.body.warmupBars || 200,
      seed: request.body.seed || 1337,
      mode: 'TOP1' as const
    };

    try {
      const result = await runner.run(params);
      return {
        ok: true,
        phase: '3.0',
        runId: result.runId,
        summary: result.summary ? {
          totalTrades: result.summary.totalTrades,
          wins: result.summary.wins,
          losses: result.summary.losses,
          winRate: (result.summary.winRate * 100).toFixed(1) + '%',
          avgR: result.summary.avgR.toFixed(2),
          expectancy: result.summary.expectancy.toFixed(2),
          profitFactor: result.summary.profitFactor === Infinity ? 'Inf' : result.summary.profitFactor.toFixed(2),
          maxDrawdownR: result.summary.maxDrawdownR.toFixed(2)
        } : null
      };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });

  // SIM: Get run status
  app.get('/sim/status', async (request: FastifyRequest<{
    Querystring: { runId: string }
  }>) => {
    const storage = getSimStorage();
    if (!storage) {
      return { ok: false, error: 'Storage not initialized' };
    }

    const run = await storage.getRun(request.query.runId);
    if (!run) {
      return { ok: false, error: 'Run not found' };
    }

    return { ok: true, run };
  });

  // SIM: Get positions for run
  app.get('/sim/positions', async (request: FastifyRequest<{
    Querystring: { runId: string; status?: string }
  }>) => {
    const storage = getSimStorage();
    if (!storage) {
      return { ok: false, error: 'Storage not initialized' };
    }

    const positions = request.query.status === 'closed'
      ? await storage.getClosedPositions(request.query.runId)
      : await storage.getPositionsByRun(request.query.runId);

    return {
      ok: true,
      runId: request.query.runId,
      count: positions.length,
      positions: positions.map(p => ({
        positionId: p.positionId,
        side: p.side,
        entryPrice: p.entryPrice,
        exitPrice: p.exitPrice,
        stopPrice: p.stopPrice,
        target1Price: p.target1Price,
        status: p.status,
        exitReason: p.exitReason,
        rMultiple: p.rMultiple?.toFixed(2),
        barsInTrade: p.barsInTrade,
        mfePct: p.mfePct?.toFixed(2) + '%',
        maePct: p.maePct?.toFixed(2) + '%'
      }))
    };
  });

  // SIM: Get summary for run
  app.get('/sim/summary', async (request: FastifyRequest<{
    Querystring: { runId: string }
  }>) => {
    const storage = getSimStorage();
    if (!storage) {
      return { ok: false, error: 'Storage not initialized' };
    }

    const summary = await storage.computeSummary(request.query.runId);
    if (!summary) {
      return { ok: false, error: 'Run not found' };
    }

    return {
      ok: true,
      phase: '3.0',
      summary: {
        ...summary,
        winRate: (summary.winRate * 100).toFixed(1) + '%',
        avgR: summary.avgR.toFixed(2),
        expectancy: summary.expectancy.toFixed(2),
        profitFactor: summary.profitFactor === Infinity ? 'Inf' : summary.profitFactor.toFixed(2),
        maxDrawdownR: summary.maxDrawdownR.toFixed(2)
      }
    };
  });

  // SIM: Get recent runs
  app.get('/sim/runs', async (request: FastifyRequest<{
    Querystring: { limit?: string }
  }>) => {
    const storage = getSimStorage();
    if (!storage) {
      return { ok: false, error: 'Storage not initialized' };
    }

    const limit = parseInt(request.query.limit || '20', 10);
    const runs = await storage.getRecentRuns(limit);

    return {
      ok: true,
      count: runs.length,
      runs: runs.map(r => ({
        runId: r.runId,
        symbol: r.symbol,
        tf: r.tf,
        status: r.status,
        createdAt: r.createdAt
      }))
    };
  });

  // SIM: Get orders for run
  app.get('/sim/orders', async (request: FastifyRequest<{
    Querystring: { runId: string }
  }>) => {
    const storage = getSimStorage();
    if (!storage) {
      return { ok: false, error: 'Storage not initialized' };
    }

    const orders = await storage.getOrdersByRun(request.query.runId);

    return {
      ok: true,
      runId: request.query.runId,
      count: orders.length,
      orders: orders.map(o => ({
        orderId: o.orderId,
        type: o.type,
        side: o.side,
        status: o.status,
        triggerPrice: o.triggerPrice,
        filledPrice: o.filledPrice,
        createdTs: o.createdTs
      }))
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3.1: Dataset Hook Endpoints
  // ═══════════════════════════════════════════════════════════════

  // Dataset hook config
  app.get('/sim/dataset_hook/config', async () => {
    const { getDatasetHookConfig } = await import('../simulator/dataset_hook.js');
    const config = getDatasetHookConfig();
    return {
      ok: true,
      phase: '3.1',
      description: 'Dataset Auto Writer - writes ML rows when positions close',
      config,
    };
  });

  // Update dataset hook config
  app.post('/sim/dataset_hook/config', async (request: FastifyRequest<{
    Body: {
      enabled?: boolean;
      minRForWrite?: number;
      maxRForWrite?: number;
      writeOnTimeout?: boolean;
    }
  }>) => {
    const { setDatasetHookConfig, getDatasetHookConfig } = await import('../simulator/dataset_hook.js');
    setDatasetHookConfig(request.body || {});
    return {
      ok: true,
      config: getDatasetHookConfig(),
    };
  });

  // Backfill dataset rows from existing positions
  app.post('/sim/dataset_hook/backfill', async (request: FastifyRequest<{
    Body: { runId: string }
  }>) => {
    const storage = getSimStorage();
    if (!storage) {
      return { ok: false, error: 'Storage not initialized' };
    }

    const { batchWriteFromPositions } = await import('../simulator/dataset_hook.js');
    const positions = await storage.getClosedPositions(request.body?.runId);
    const result = await batchWriteFromPositions(positions, request.body?.runId);

    return {
      ok: true,
      phase: '3.1',
      ...result,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 5: Dataset Builder v2 Endpoints
  // ═══════════════════════════════════════════════════════════════

  // Dataset v2 status
  app.get('/ml/dataset_v2/status', async () => {
    const { getDatasetStatsV2 } = await import('../ml/dataset_writer_v2.js');
    const { getFeatureNamesV2, getFeatureCountV2 } = await import('../ml/feature_schema_v2.js');
    
    const stats = await getDatasetStatsV2();
    
    return {
      ok: true,
      phase: '5',
      description: 'Dataset Builder v2 - ~80 features for ML training',
      ...stats,
      featureGroups: {
        'pattern_geometry': 15,
        'pattern_context': 10,
        'support_resistance': 10,
        'volatility': 8,
        'momentum': 8,
        'volume': 6,
        'market_structure': 7,
        'risk': 6,
        'pattern_reliability': 6,
        'time': 4,
      },
    };
  });

  // Get dataset rows v2
  app.get('/ml/dataset_v2/rows', async (request: FastifyRequest<{
    Querystring: { 
      limit?: string; 
      skip?: string; 
      symbol?: string; 
      timeframe?: string;
      runId?: string;
    }
  }>) => {
    const { getDatasetRowsV2 } = await import('../ml/dataset_writer_v2.js');
    
    const rows = await getDatasetRowsV2({
      limit: parseInt(request.query.limit ?? '20'),
      skip: parseInt(request.query.skip ?? '0'),
      symbol: request.query.symbol,
      timeframe: request.query.timeframe,
      runId: request.query.runId,
    });
    
    return {
      ok: true,
      phase: '5',
      count: rows.length,
      rows,
    };
  });

  // Export to CSV
  app.get('/ml/dataset_v2/export/csv', async (request: FastifyRequest<{
    Querystring: { 
      symbol?: string; 
      timeframe?: string;
      runId?: string;
      limit?: string;
    }
  }>, reply: FastifyReply) => {
    const { exportToCSV } = await import('../ml/dataset_writer_v2.js');
    
    const csv = await exportToCSV({
      symbol: request.query.symbol,
      timeframe: request.query.timeframe,
      runId: request.query.runId,
      limit: parseInt(request.query.limit ?? '100000'),
    });
    
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="dataset_v2.csv"');
    return csv;
  });

  // Export to JSONL (for Parquet conversion)
  app.get('/ml/dataset_v2/export/jsonl', async (request: FastifyRequest<{
    Querystring: { 
      symbol?: string; 
      timeframe?: string;
      runId?: string;
      limit?: string;
    }
  }>, reply: FastifyReply) => {
    const { exportToJSONL } = await import('../ml/dataset_writer_v2.js');
    
    const jsonl = await exportToJSONL({
      symbol: request.query.symbol,
      timeframe: request.query.timeframe,
      runId: request.query.runId,
      limit: parseInt(request.query.limit ?? '100000'),
    });
    
    reply.header('Content-Type', 'application/x-ndjson');
    reply.header('Content-Disposition', 'attachment; filename="dataset_v2.jsonl"');
    return jsonl;
  });

  // Export feature matrix (X, y, meta)
  app.get('/ml/dataset_v2/export/matrix', async (request: FastifyRequest<{
    Querystring: { 
      symbol?: string; 
      timeframe?: string;
      runId?: string;
      limit?: string;
    }
  }>) => {
    const { exportFeatureMatrix } = await import('../ml/dataset_writer_v2.js');
    const { getFeatureNamesV2 } = await import('../ml/feature_schema_v2.js');
    
    const { X, y, meta } = await exportFeatureMatrix({
      symbol: request.query.symbol,
      timeframe: request.query.timeframe,
      runId: request.query.runId,
      limit: parseInt(request.query.limit ?? '10000'),
    });
    
    return {
      ok: true,
      phase: '5',
      shape: [X.length, X[0]?.length ?? 0],
      featureNames: getFeatureNamesV2(),
      X,
      y,
      meta,
    };
  });

  // Stats by group (pattern type, side, etc.)
  app.get('/ml/dataset_v2/stats/:groupBy', async (request: FastifyRequest<{
    Params: { groupBy: string }
  }>) => {
    const { getStatsByGroup } = await import('../ml/dataset_writer_v2.js');
    
    const stats = await getStatsByGroup(request.params.groupBy);
    
    return {
      ok: true,
      phase: '5',
      groupBy: request.params.groupBy,
      groups: stats,
    };
  });

  // Feature schema info
  app.get('/ml/dataset_v2/schema', async () => {
    const { 
      getFeatureNamesV2, 
      getFeatureCountV2,
      PATTERN_TYPE_ENCODING,
      PATTERN_FAMILY_ENCODING,
    } = await import('../ml/feature_schema_v2.js');
    
    return {
      ok: true,
      phase: '5',
      featureCount: getFeatureCountV2(),
      features: getFeatureNamesV2(),
      encodings: {
        patternTypes: PATTERN_TYPE_ENCODING,
        patternFamilies: PATTERN_FAMILY_ENCODING,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 6: ML Training Pipeline Endpoints (v2)
  // ═══════════════════════════════════════════════════════════════

  // ML Registry v2: List models with active status
  app.get('/ml/registry/models', async () => {
    const { listModels, getActiveModel } = await import('../ml/training/registry.service.js');
    
    const models = await listModels();
    const active = await getActiveModel();
    
    return {
      ok: true,
      phase: '6',
      description: 'ML Training Pipeline - Model Registry',
      activeModelId: active?.modelId || null,
      models: models.map(m => ({
        modelId: m.modelId,
        stage: m.stage,
        enabled: m.enabled,
        task: m.task,
        metrics: m.metrics,
        createdAt: m.createdAt,
      })),
    };
  });

  // ML Registry v2: Get model details
  app.get('/ml/registry/models/:modelId', async (request: FastifyRequest<{
    Params: { modelId: string }
  }>) => {
    const { getModel } = await import('../ml/training/registry.service.js');
    
    const model = await getModel(request.params.modelId);
    if (!model) {
      return { ok: false, error: 'Model not found' };
    }
    
    return { ok: true, model };
  });

  // ML Registry v2: Register model from artifact
  app.post('/ml/registry/register', async (request: FastifyRequest<{
    Body: { artifactPath: string; modelId?: string }
  }>) => {
    const { registerModel } = await import('../ml/training/registry.service.js');
    
    try {
      const model = await registerModel(
        request.body.artifactPath,
        request.body.modelId
      );
      return { ok: true, model };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // ML Registry v2: Train new model
  app.post('/ml/registry/train', async (request: FastifyRequest<{
    Body?: { modelId?: string }
  }>) => {
    const { trainModel } = await import('../ml/training/registry.service.js');
    
    const result = await trainModel({
      modelId: request.body?.modelId,
    });
    
    return {
      ok: result.ok,
      phase: '6',
      ...result,
    };
  });

  // ML Registry v2: Set model stage
  app.post('/ml/registry/models/:modelId/stage', async (request: FastifyRequest<{
    Params: { modelId: string };
    Body: { stage: string; force?: boolean }
  }>) => {
    const { setStage } = await import('../ml/training/registry.service.js');
    
    const result = await setStage(
      request.params.modelId,
      request.body.stage as any,
      request.body.force ?? false
    );
    
    return result;
  });

  // ML Registry v2: Enable model
  app.post('/ml/registry/models/:modelId/enable', async (request: FastifyRequest<{
    Params: { modelId: string };
    Body?: { force?: boolean }
  }>) => {
    const { enableModel } = await import('../ml/training/registry.service.js');
    
    return await enableModel(
      request.params.modelId,
      request.body?.force ?? false
    );
  });

  // ML Registry v2: Disable model
  app.post('/ml/registry/models/:modelId/disable', async (request: FastifyRequest<{
    Params: { modelId: string }
  }>) => {
    const { disableModel } = await import('../ml/training/registry.service.js');
    
    await disableModel(request.params.modelId);
    return { ok: true };
  });

  // ML Rollout: Check if model can be enabled
  app.get('/ml/rollout/check/:modelId', async (request: FastifyRequest<{
    Params: { modelId: string };
    Querystring: { targetStage?: string }
  }>) => {
    const { checkRollout, getModel } = await import('../ml/training/registry.service.js');
    
    const model = await getModel(request.params.modelId);
    const targetStage = (request.query.targetStage || model?.stage || 'SHADOW') as any;
    
    return await checkRollout(request.params.modelId, targetStage);
  });

  // ML Overlay v2: Status
  app.get('/ml/overlay_v2/status', async () => {
    const { getOverlayStatus } = await import('../ml/training/overlay.service.js');
    
    return {
      ok: true,
      phase: '6',
      ...(await getOverlayStatus()),
    };
  });

  // ML Overlay v2: Predict
  app.post('/ml/overlay_v2/predict', async (request: FastifyRequest<{
    Body: {
      symbol: string;
      tf: string;
      baseProbability: number;
      features: Record<string, number>;
    }
  }>) => {
    const { applyOverlay } = await import('../ml/training/overlay.service.js');
    
    return await applyOverlay({
      symbol: request.body.symbol,
      tf: request.body.tf,
      ts: Date.now(),
      baseProbability: request.body.baseProbability,
      features: request.body.features,
    });
  });

  // ML Overlay v2: Config
  app.get('/ml/overlay_v2/config', async () => {
    const { getOverlayConfig } = await import('../ml/training/overlay.service.js');
    return { ok: true, config: getOverlayConfig() };
  });

  app.patch('/ml/overlay_v2/config', async (request: FastifyRequest<{
    Body: { enabled?: boolean }
  }>) => {
    const { setOverlayConfig, getOverlayConfig } = await import('../ml/training/overlay.service.js');
    setOverlayConfig(request.body);
    return { ok: true, config: getOverlayConfig() };
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 7: Batch Simulation Endpoints
  // ═══════════════════════════════════════════════════════════════

  // Create batch run
  app.post('/batch/create', async (request: FastifyRequest<{
    Body: {
      name?: string;
      symbols: string[];
      tfs: string[];
      startTs: number;
      endTs: number;
      config?: any;
    }
  }>) => {
    const { createBatchRun } = await import('../batch/service.js');
    
    const run = await createBatchRun(request.body);
    
    return {
      ok: true,
      phase: '7',
      runId: run.runId,
      name: run.name,
      tasks: run.progress.totalTasks,
      symbols: run.symbols,
      tfs: run.tfs,
    };
  });

  // Start batch run
  app.post('/batch/start', async (request: FastifyRequest<{
    Querystring: { runId: string }
  }>) => {
    const { startBatchRun } = await import('../batch/service.js');
    return await startBatchRun(request.query.runId);
  });

  // Cancel batch run
  app.post('/batch/cancel', async (request: FastifyRequest<{
    Querystring: { runId: string }
  }>) => {
    const { cancelBatchRun } = await import('../batch/service.js');
    return await cancelBatchRun(request.query.runId);
  });

  // Get batch run status
  app.get('/batch/status', async (request: FastifyRequest<{
    Querystring: { runId: string }
  }>) => {
    const { getBatchRunStatus } = await import('../batch/service.js');
    
    const run = await getBatchRunStatus(request.query.runId);
    if (!run) {
      return { ok: false, error: 'Run not found' };
    }
    
    return {
      ok: true,
      phase: '7',
      ...run,
    };
  });

  // List batch runs
  app.get('/batch/runs', async (request: FastifyRequest<{
    Querystring: { limit?: string }
  }>) => {
    const { listBatchRuns } = await import('../batch/service.js');
    
    const runs = await listBatchRuns(parseInt(request.query.limit ?? '20'));
    
    return {
      ok: true,
      phase: '7',
      runs,
    };
  });

  // Get tasks for run
  app.get('/batch/tasks', async (request: FastifyRequest<{
    Querystring: { runId: string; status?: string }
  }>) => {
    const { getRunTasks } = await import('../batch/service.js');
    
    const tasks = await getRunTasks(request.query.runId, request.query.status);
    
    return {
      ok: true,
      count: tasks.length,
      tasks: tasks.slice(0, 50), // Limit response
    };
  });

  // Requeue failed tasks
  app.post('/batch/requeue_failed', async (request: FastifyRequest<{
    Querystring: { runId: string }
  }>) => {
    const { requeueFailedTasks } = await import('../batch/service.js');
    
    const count = await requeueFailedTasks(request.query.runId);
    
    return { ok: true, requeuedCount: count };
  });

  // Release stuck tasks
  app.post('/batch/release_stuck', async (request: FastifyRequest<{
    Querystring: { runId: string }
  }>) => {
    const { releaseStuckTasks } = await import('../batch/service.js');
    
    const count = await releaseStuckTasks(request.query.runId);
    
    return { ok: true, releasedCount: count };
  });

  // Estimate batch run
  app.post('/batch/estimate', async (request: FastifyRequest<{
    Body: {
      symbols: string[];
      tfs: string[];
      startTs: number;
      endTs: number;
    }
  }>) => {
    const { estimateBatchRun } = await import('../batch/service.js');
    
    const estimate = estimateBatchRun(
      request.body.symbols,
      request.body.tfs,
      request.body.startTs,
      request.body.endTs
    );
    
    return {
      ok: true,
      phase: '7',
      ...estimate,
    };
  });

  // Worker status
  app.get('/batch/worker', async () => {
    const { getWorkerStatus } = await import('../batch/service.js');
    return { ok: true, ...getWorkerStatus() };
  });

  // Initialize storage indexes
  import('../ml/training/storage.js').then(s => s.ensureIndexes()).catch(() => {});
  import('../batch/storage.js').then(s => s.ensureIndexes()).catch(() => {});

  console.log('[TA] Phase 3.0-7 (Simulator, Dataset, ML Training, Batch) endpoints added');
}

// Helper for factor descriptions
function getFactorDescription(name: string): string {
  const descriptions: Record<string, string> = {
    geometry: 'Pattern geometric quality (symmetry, compression, fit)',
    touches: 'Level/line validation strength',
    regime: 'Market structure alignment (trend direction)',
    ma: 'Moving average alignment',
    fib: 'Fibonacci confluence',
    volatility: 'Volatility gate (high vol reduces score)',
    agreement: 'Signal confirmations (divergences, candles)',
    rr: 'Risk/Reward quality',
  };
  return descriptions[name] || 'Unknown factor';
}
