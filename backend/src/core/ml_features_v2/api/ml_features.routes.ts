/**
 * ML Features API Routes (P0.6)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildFeatureVector, buildFeatureVectorsBatch } from '../builder/index.js';
import { 
  getLatestSnapshot, 
  getSnapshotsForEntity, 
  getSnapshotStats 
} from '../storage/feature_snapshot.model.js';
import { 
  getRecentAudits, 
  getAuditsForEntity, 
  getAuditStats 
} from '../storage/feature_audit.model.js';
import { 
  getRegistryStats, 
  getAllFeatureKeys,
  FEATURE_REGISTRY 
} from '../registry/feature_registry.js';
import { vectorToArray, getFeatureNames } from '../normalization/index.js';
import { FEATURE_TAXONOMY_VERSION } from '../types/feature.types.js';

// ============================================
// Types
// ============================================

interface BuildParams {
  entityType: 'WALLET' | 'TOKEN' | 'ACTOR';
  entityId: string;
}

interface BuildQuery {
  windowHours?: string;
  normalize?: string;
  persist?: string;
  audit?: string;
  skipMarket?: string;
  skipActor?: string;
  skipWatchlist?: string;
}

interface BatchBody {
  entities: Array<{ entityType: 'WALLET' | 'TOKEN' | 'ACTOR'; entityId: string }>;
  windowHours?: number;
  normalize?: boolean;
  persist?: boolean;
}

// ============================================
// Routes
// ============================================

export async function mlFeaturesRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ==========================================
  // Registry & Schema
  // ==========================================
  
  /**
   * GET /api/ml/features/registry
   * Get feature registry with all definitions
   */
  fastify.get('/registry', async (request: FastifyRequest, reply: FastifyReply) => {
    const stats = getRegistryStats();
    
    return {
      version: FEATURE_TAXONOMY_VERSION,
      stats,
      features: FEATURE_REGISTRY
    };
  });
  
  /**
   * GET /api/ml/features/registry/stats
   * Get registry statistics
   */
  fastify.get('/registry/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    return getRegistryStats();
  });
  
  /**
   * GET /api/ml/features/schema
   * Get feature schema for ML pipeline
   */
  fastify.get('/schema', async (request: FastifyRequest, reply: FastifyReply) => {
    const featureNames = getFeatureNames();
    const keys = getAllFeatureKeys();
    
    return {
      version: FEATURE_TAXONOMY_VERSION,
      featureCount: keys.length,
      featureNames,
      features: keys.map(key => ({
        key,
        ...FEATURE_REGISTRY[key]
      }))
    };
  });
  
  // ==========================================
  // Build Features
  // ==========================================
  
  /**
   * POST /api/ml/features/build/:entityType/:entityId
   * Build feature vector for entity
   */
  fastify.post<{
    Params: BuildParams;
    Querystring: BuildQuery;
  }>('/build/:entityType/:entityId', async (request, reply) => {
    const { entityType, entityId } = request.params;
    const { 
      windowHours = '24', 
      normalize = 'true',
      persist = 'false',
      audit = 'true',
      skipMarket = 'false',  // P1.5 Market implemented
      skipActor = 'false',
      skipWatchlist = 'false'
    } = request.query;
    
    // Validate entity type
    const validTypes = ['WALLET', 'TOKEN', 'ACTOR'];
    if (!validTypes.includes(entityType.toUpperCase())) {
      return reply.status(400).send({
        error: 'Invalid entityType',
        validTypes
      });
    }
    
    // Calculate time window
    const hours = parseInt(windowHours) || 24;
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - hours * 60 * 60 * 1000);
    
    // Build
    const result = await buildFeatureVector(
      {
        entityType: entityType.toUpperCase() as 'WALLET' | 'TOKEN' | 'ACTOR',
        entityId,
        windowStart,
        windowEnd
      },
      {
        normalize: normalize === 'true',
        persist: persist === 'true',
        auditLog: audit === 'true',
        skipMarket: skipMarket === 'true',
        skipActor: skipActor === 'true',
        skipWatchlist: skipWatchlist === 'true'
      }
    );
    
    return {
      success: result.errors.length === 0,
      snapshotId: result.snapshotId,
      auditId: result.auditId,
      vector: result.vector,
      errors: result.errors
    };
  });
  
  /**
   * POST /api/ml/features/build/batch
   * Build feature vectors for multiple entities
   */
  fastify.post<{ Body: BatchBody }>('/build/batch', async (request, reply) => {
    const { entities, windowHours = 24, normalize = true, persist = false } = request.body;
    
    if (!entities || !Array.isArray(entities) || entities.length === 0) {
      return reply.status(400).send({ error: 'entities array required' });
    }
    
    if (entities.length > 100) {
      return reply.status(400).send({ error: 'Max 100 entities per batch' });
    }
    
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - windowHours * 60 * 60 * 1000);
    
    const results = await buildFeatureVectorsBatch(
      entities,
      windowStart,
      windowEnd,
      { normalize, persist, skipMarket: true }
    );
    
    return {
      success: true,
      count: results.length,
      results: results.map(r => ({
        entityId: r.vector.entityId,
        entityType: r.vector.entityType,
        coverage: r.vector.coverage.coveragePercent,
        errors: r.errors
      }))
    };
  });
  
  /**
   * POST /api/ml/features/export/:entityType/:entityId
   * Export feature vector as flat array for ML
   */
  fastify.post<{
    Params: BuildParams;
    Querystring: BuildQuery;
  }>('/export/:entityType/:entityId', async (request, reply) => {
    const { entityType, entityId } = request.params;
    const { windowHours = '24' } = request.query;
    
    const hours = parseInt(windowHours) || 24;
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - hours * 60 * 60 * 1000);
    
    const result = await buildFeatureVector(
      {
        entityType: entityType.toUpperCase() as 'WALLET' | 'TOKEN' | 'ACTOR',
        entityId,
        windowStart,
        windowEnd
      },
      { normalize: true, skipMarket: true }
    );
    
    const featureArray = vectorToArray(result.vector);
    const featureNames = getFeatureNames();
    
    return {
      version: FEATURE_TAXONOMY_VERSION,
      entityType,
      entityId,
      coverage: result.vector.coverage.coveragePercent,
      featureCount: featureArray.length,
      featureNames,
      features: featureArray,
      buildDurationMs: result.vector.buildDurationMs
    };
  });
  
  // ==========================================
  // Snapshots
  // ==========================================
  
  /**
   * GET /api/ml/features/snapshots/:entityType/:entityId
   * Get snapshots for entity
   */
  fastify.get<{
    Params: BuildParams;
    Querystring: { limit?: string };
  }>('/snapshots/:entityType/:entityId', async (request, reply) => {
    const { entityType, entityId } = request.params;
    const limit = parseInt(request.query.limit || '10');
    
    const snapshots = await getSnapshotsForEntity(entityType, entityId, limit);
    
    return {
      count: snapshots.length,
      snapshots: snapshots.map(s => ({
        snapshotId: s.snapshotId,
        entityType: s.entityType,
        entityId: s.entityId,
        coverage: s.coverage?.coveragePercent,
        buildTimestamp: s.buildTimestamp,
        taxonomyVersion: s.taxonomyVersion
      }))
    };
  });
  
  /**
   * GET /api/ml/features/snapshots/:entityType/:entityId/latest
   * Get latest snapshot
   */
  fastify.get<{ Params: BuildParams }>('/snapshots/:entityType/:entityId/latest', async (request, reply) => {
    const { entityType, entityId } = request.params;
    
    const snapshot = await getLatestSnapshot(entityType, entityId);
    
    if (!snapshot) {
      return reply.status(404).send({ error: 'No snapshot found' });
    }
    
    return snapshot;
  });
  
  /**
   * GET /api/ml/features/snapshots/stats
   * Get snapshot statistics
   */
  fastify.get('/snapshots/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    return getSnapshotStats();
  });
  
  // ==========================================
  // Audits
  // ==========================================
  
  /**
   * GET /api/ml/features/audits
   * Get recent audit entries
   */
  fastify.get<{ Querystring: { limit?: string } }>('/audits', async (request, reply) => {
    const limit = parseInt(request.query.limit || '50');
    
    const audits = await getRecentAudits(limit);
    
    return {
      count: audits.length,
      audits
    };
  });
  
  /**
   * GET /api/ml/features/audits/:entityType/:entityId
   * Get audits for entity
   */
  fastify.get<{
    Params: BuildParams;
    Querystring: { limit?: string };
  }>('/audits/:entityType/:entityId', async (request, reply) => {
    const { entityType, entityId } = request.params;
    const limit = parseInt(request.query.limit || '20');
    
    const audits = await getAuditsForEntity(entityType, entityId, limit);
    
    return {
      count: audits.length,
      audits
    };
  });
  
  /**
   * GET /api/ml/features/audits/stats
   * Get audit statistics
   */
  fastify.get('/audits/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    return getAuditStats();
  });
  
  // ==========================================
  // Health & Info
  // ==========================================
  
  /**
   * GET /api/ml/features/health
   * Health check for ML features module
   */
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const [registryStats, snapshotStats, auditStats] = await Promise.all([
      getRegistryStats(),
      getSnapshotStats(),
      getAuditStats()
    ]);
    
    return {
      status: 'healthy',
      version: FEATURE_TAXONOMY_VERSION,
      registry: registryStats,
      snapshots: snapshotStats,
      audits: {
        total: auditStats.totalAudits,
        errorsToday: auditStats.errorsToday
      }
    };
  });
  
  /**
   * GET /api/ml/features/info
   * Module info
   */
  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    return {
      module: 'ML Feature Taxonomy v2',
      version: FEATURE_TAXONOMY_VERSION,
      phase: 'P0.6',
      description: 'Unified feature engineering layer for ML models',
      providers: ['ROUTES', 'DEX', 'ACTOR', 'WATCHLIST', 'SYSTEM', 'MARKET (stub)'],
      featureCount: getAllFeatureKeys().length,
      endpoints: {
        build: 'POST /api/ml/features/build/:entityType/:entityId',
        batch: 'POST /api/ml/features/build/batch',
        export: 'POST /api/ml/features/export/:entityType/:entityId',
        snapshots: 'GET /api/ml/features/snapshots/:entityType/:entityId',
        registry: 'GET /api/ml/features/registry',
        schema: 'GET /api/ml/features/schema',
        health: 'GET /api/ml/features/health'
      }
    };
  });
}
