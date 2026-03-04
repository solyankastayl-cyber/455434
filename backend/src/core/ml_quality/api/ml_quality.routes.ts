/**
 * ML Quality API Routes (P0.7)
 * 
 * Endpoints for feature quality gates and monitoring.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildFeatureVector } from '../../ml_features_v2/builder/index.js';
import { checkGates, checkGatesAndPersist, explainDecision, DEFAULT_GATE_CONFIG } from '../gates/index.js';
import { analyzeCoverage, calculateQualityScore, analyzeFreshness } from '../analyzers/index.js';
import { checkBatchDrift } from '../drift/index.js';
import { createGateAlert, createDriftAlert, resolveQualityAlerts } from '../integration/index.js';
import {
  getLatestCoverage,
  getCoverageHistory,
  getBlockedEntities,
  getCoverageStats
} from '../storage/feature_coverage.model.js';
import { getRecentDriftAlerts, getDriftStats } from '../storage/feature_distribution.model.js';

// ============================================
// Types
// ============================================

interface EntityParams {
  entityType: 'WALLET' | 'TOKEN' | 'ACTOR';
  entityId: string;
}

interface GatesQuery {
  windowHours?: string;
  persist?: string;
  alert?: string;
}

// ============================================
// Routes
// ============================================

export async function mlQualityRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ==========================================
  // Gates Check
  // ==========================================
  
  /**
   * POST /api/ml/quality/gates/:entityType/:entityId
   * Check quality gates for an entity
   */
  fastify.post<{
    Params: EntityParams;
    Querystring: GatesQuery;
  }>('/gates/:entityType/:entityId', async (request, reply) => {
    const { entityType, entityId } = request.params;
    const { 
      windowHours = '24',
      persist = 'true',
      alert = 'true'
    } = request.query;
    
    // Build feature vector
    const hours = parseInt(windowHours) || 24;
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - hours * 60 * 60 * 1000);
    
    const buildResult = await buildFeatureVector(
      { entityType, entityId, windowStart, windowEnd },
      { normalize: false, skipMarket: true }
    );
    
    // Check gates
    const gateResult = persist === 'true'
      ? await checkGatesAndPersist(buildResult.vector, buildResult.snapshotId)
      : await checkGates(buildResult.vector);
    
    // Create alert if blocked
    if (alert === 'true' && !gateResult.decision.allowed) {
      await createGateAlert(entityId, entityType, gateResult);
    }
    
    // Resolve alerts if now allowed
    if (gateResult.decision.allowed) {
      await resolveQualityAlerts(entityId, entityType);
    }
    
    return {
      allowed: gateResult.decision.allowed,
      score: gateResult.decision.score,
      blockedBy: gateResult.decision.blockedBy,
      explanation: explainDecision(gateResult),
      coverage: {
        total: gateResult.coverageResult.coverage.coverageRatio,
        bySource: gateResult.coverageResult.bySource
      },
      freshness: gateResult.freshnessResult.freshness,
      missingCritical: gateResult.coverageResult.missingCritical,
      buildDurationMs: buildResult.vector.buildDurationMs
    };
  });
  
  /**
   * GET /api/ml/quality/gates/config
   * Get current gate configuration
   */
  fastify.get('/gates/config', async (request: FastifyRequest, reply: FastifyReply) => {
    return {
      config: DEFAULT_GATE_CONFIG,
      thresholds: {
        coverage: {
          total: `${DEFAULT_GATE_CONFIG.minTotalCoverage * 100}%`,
          routes: `${DEFAULT_GATE_CONFIG.minRoutesCoverage * 100}%`,
          dex: `${DEFAULT_GATE_CONFIG.minDexCoverage * 100}%`
        },
        freshness: {
          maxOverallLag: `${DEFAULT_GATE_CONFIG.maxOverallLagMs / 3600000}h`,
          maxRoutesLag: `${DEFAULT_GATE_CONFIG.maxRoutesLagMs / 3600000}h`,
          maxDexLag: `${DEFAULT_GATE_CONFIG.maxDexLagMs / 3600000}h`
        },
        quality: {
          minScore: DEFAULT_GATE_CONFIG.minQualityScore
        }
      }
    };
  });
  
  // ==========================================
  // Coverage
  // ==========================================
  
  /**
   * GET /api/ml/quality/coverage/:entityType/:entityId
   * Get coverage for entity
   */
  fastify.get<{ Params: EntityParams }>('/coverage/:entityType/:entityId', async (request, reply) => {
    const { entityType, entityId } = request.params;
    
    const latest = await getLatestCoverage(entityType, entityId);
    
    if (!latest) {
      return reply.status(404).send({ error: 'No coverage data found' });
    }
    
    return {
      snapshotId: latest.snapshotId,
      timestamp: latest.timestamp,
      coverage: latest.coverage,
      bySource: latest.bySource,
      decision: latest.decision
    };
  });
  
  /**
   * GET /api/ml/quality/coverage/:entityType/:entityId/history
   * Get coverage history
   */
  fastify.get<{
    Params: EntityParams;
    Querystring: { limit?: string };
  }>('/coverage/:entityType/:entityId/history', async (request, reply) => {
    const { entityType, entityId } = request.params;
    const limit = parseInt(request.query.limit || '20');
    
    const history = await getCoverageHistory(entityType, entityId, limit);
    
    return {
      count: history.length,
      history: history.map(h => ({
        snapshotId: h.snapshotId,
        timestamp: h.timestamp,
        coverage: h.coverage.coverageRatio,
        score: h.decision.score,
        allowed: h.decision.allowed
      }))
    };
  });
  
  // ==========================================
  // Freshness
  // ==========================================
  
  /**
   * GET /api/ml/quality/freshness/:entityType/:entityId
   * Get data freshness for entity
   */
  fastify.get<{ Params: EntityParams }>('/freshness/:entityType/:entityId', async (request, reply) => {
    const { entityType, entityId } = request.params;
    
    const result = await analyzeFreshness(entityId, entityType);
    
    return result;
  });
  
  // ==========================================
  // Drift
  // ==========================================
  
  /**
   * GET /api/ml/quality/drift
   * Get recent drift alerts
   */
  fastify.get<{
    Querystring: { level?: string; limit?: string };
  }>('/drift', async (request, reply) => {
    const level = (request.query.level || 'WARN') as 'INFO' | 'WARN' | 'CRITICAL';
    const limit = parseInt(request.query.limit || '50');
    
    const alerts = await getRecentDriftAlerts(level, limit);
    
    return {
      count: alerts.length,
      alerts
    };
  });
  
  /**
   * GET /api/ml/quality/drift/stats
   * Get drift statistics
   */
  fastify.get('/drift/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    return getDriftStats();
  });
  
  // ==========================================
  // Blocked Entities
  // ==========================================
  
  /**
   * GET /api/ml/quality/blocked
   * Get entities blocked by gates
   */
  fastify.get<{
    Querystring: { since?: string; limit?: string };
  }>('/blocked', async (request, reply) => {
    const sinceHours = parseInt(request.query.since || '24');
    const limit = parseInt(request.query.limit || '50');
    
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    const blocked = await getBlockedEntities(since, limit);
    
    return {
      count: blocked.length,
      sinceHours,
      entities: blocked.map(b => ({
        entityType: b.entityType,
        entityId: b.entityId,
        timestamp: b.timestamp,
        score: b.decision.score,
        blockedBy: b.decision.blockedBy,
        coverage: b.coverage.coverageRatio
      }))
    };
  });
  
  // ==========================================
  // Stats & Health
  // ==========================================
  
  /**
   * GET /api/ml/quality/stats
   * Get overall quality statistics
   */
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const [coverageStats, driftStats] = await Promise.all([
      getCoverageStats(),
      getDriftStats()
    ]);
    
    return {
      coverage: coverageStats,
      drift: driftStats,
      config: {
        minCoverage: DEFAULT_GATE_CONFIG.minTotalCoverage,
        minQualityScore: DEFAULT_GATE_CONFIG.minQualityScore
      }
    };
  });
  
  /**
   * GET /api/ml/quality/health
   * Health check for ML quality module
   */
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const stats = await getCoverageStats();
    
    // Determine health based on recent block rate
    const blockRate = stats.totalSnapshots > 0 
      ? stats.blockedCount / stats.totalSnapshots 
      : 0;
    
    const status = blockRate < 0.3 ? 'healthy' : blockRate < 0.5 ? 'degraded' : 'unhealthy';
    
    return {
      status,
      module: 'ML Quality Gates (P0.7)',
      version: 'v1',
      metrics: {
        totalChecks: stats.totalSnapshots,
        allowedRate: stats.totalSnapshots > 0 ? Math.round((stats.allowedCount / stats.totalSnapshots) * 100) : 0,
        blockedRate: Math.round(blockRate * 100),
        avgCoverage: stats.avgCoverage,
        avgQualityScore: stats.avgQualityScore,
        topBlockReasons: Object.entries(stats.blockReasons)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([reason, count]) => ({ reason, count }))
      }
    };
  });
  
  /**
   * GET /api/ml/quality/info
   * Module info
   */
  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    return {
      module: 'ML Feature Quality Gates',
      version: 'v1',
      phase: 'P0.7',
      description: 'Deterministic gates that allow/block ML usage based on data quality',
      principle: 'ML is blocked when data is bad. Gates never use ML.',
      components: {
        coverage: 'Tracks feature presence/absence',
        freshness: 'Tracks data staleness per source',
        gates: 'Deterministic rules (coverage ≥ 75%, lag ≤ 6h)',
        drift: 'Pre-signals for distribution shifts'
      },
      thresholds: {
        minTotalCoverage: '75%',
        minRoutesCoverage: '70%',
        maxDataLag: '6 hours',
        minQualityScore: 50
      },
      endpoints: {
        gates: 'POST /api/ml/quality/gates/:entityType/:entityId',
        coverage: 'GET /api/ml/quality/coverage/:entityType/:entityId',
        freshness: 'GET /api/ml/quality/freshness/:entityType/:entityId',
        drift: 'GET /api/ml/quality/drift',
        blocked: 'GET /api/ml/quality/blocked',
        stats: 'GET /api/ml/quality/stats',
        health: 'GET /api/ml/quality/health'
      }
    };
  });
}
