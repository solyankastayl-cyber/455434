/**
 * Feature Builder Service (P0.6)
 * 
 * Main orchestrator for building feature vectors.
 * Aggregates features from all providers and computes coverage.
 */

import {
  FeatureVector,
  FeatureCoverage,
  FeatureSource,
  ProviderContext,
  FeatureBuildOptions,
  FEATURE_TAXONOMY_VERSION
} from '../types/feature.types.js';
import { FEATURE_REGISTRY, getCriticalFeatures, getFeaturesBySource } from '../registry/feature_registry.js';
import {
  extractRouteFeatures,
  extractDexFeatures,
  extractActorFeatures,
  extractWatchlistFeatures,
  extractSystemFeatures,
  extractMarketFeatures
} from '../providers/index.js';
import { normalizeFeatureVector } from '../normalization/index.js';
import { saveFeatureSnapshot } from '../storage/feature_snapshot.model.js';
import { createAuditEntry } from '../storage/feature_audit.model.js';

// ============================================
// Types
// ============================================

export interface BuildResult {
  vector: FeatureVector;
  snapshotId?: string;
  auditId?: string;
  errors: string[];
}

// ============================================
// Feature Builder Service
// ============================================

/**
 * Build feature vector for an entity
 */
export async function buildFeatureVector(
  ctx: ProviderContext,
  options: FeatureBuildOptions = {}
): Promise<BuildResult> {
  const startTime = Date.now();
  const allErrors: string[] = [];
  const providersUsed: FeatureSource[] = [];
  const providerErrors: Array<{ source: FeatureSource; error: string }> = [];
  
  // Initialize empty vector
  const vector: FeatureVector = {
    entityType: ctx.entityType,
    entityId: ctx.entityId.toLowerCase(),
    windowStart: ctx.windowStart,
    windowEnd: ctx.windowEnd,
    taxonomyVersion: FEATURE_TAXONOMY_VERSION,
    routes: {},
    dex: {},
    market: {},
    actor: {},
    watchlist: {},
    system: {},
    coverage: {
      totalFeatures: 0,
      presentFeatures: 0,
      nullFeatures: 0,
      coveragePercent: 0,
      bySource: {
        ROUTES: { total: 0, present: 0, null: 0 },
        DEX: { total: 0, present: 0, null: 0 },
        MARKET: { total: 0, present: 0, null: 0 },
        ACTOR: { total: 0, present: 0, null: 0 },
        WATCHLIST: { total: 0, present: 0, null: 0 },
        SYSTEM: { total: 0, present: 0, null: 0 }
      },
      missingCritical: []
    },
    buildTimestamp: new Date(),
    buildDurationMs: 0
  };
  
  // Execute providers in parallel
  const providerPromises: Promise<void>[] = [];
  
  // Routes Provider
  providerPromises.push(
    extractRouteFeatures(ctx)
      .then(result => {
        vector.routes = result.features;
        providersUsed.push('ROUTES');
        if (result.errors.length > 0) {
          result.errors.forEach(e => providerErrors.push({ source: 'ROUTES', error: e }));
        }
      })
      .catch(err => {
        providerErrors.push({ source: 'ROUTES', error: err.message });
        allErrors.push(`Routes: ${err.message}`);
      })
  );
  
  // DEX Provider
  providerPromises.push(
    extractDexFeatures(ctx)
      .then(result => {
        vector.dex = result.features;
        providersUsed.push('DEX');
        if (result.errors.length > 0) {
          result.errors.forEach(e => providerErrors.push({ source: 'DEX', error: e }));
        }
      })
      .catch(err => {
        providerErrors.push({ source: 'DEX', error: err.message });
        allErrors.push(`DEX: ${err.message}`);
      })
  );
  
  // Actor Provider (optional)
  if (!options.skipActor) {
    providerPromises.push(
      extractActorFeatures(ctx)
        .then(result => {
          vector.actor = result.features;
          providersUsed.push('ACTOR');
          if (result.errors.length > 0) {
            result.errors.forEach(e => providerErrors.push({ source: 'ACTOR', error: e }));
          }
        })
        .catch(err => {
          providerErrors.push({ source: 'ACTOR', error: err.message });
          allErrors.push(`Actor: ${err.message}`);
        })
    );
  }
  
  // Watchlist Provider (optional)
  if (!options.skipWatchlist) {
    providerPromises.push(
      extractWatchlistFeatures(ctx)
        .then(result => {
          vector.watchlist = result.features;
          providersUsed.push('WATCHLIST');
          if (result.errors.length > 0) {
            result.errors.forEach(e => providerErrors.push({ source: 'WATCHLIST', error: e }));
          }
        })
        .catch(err => {
          providerErrors.push({ source: 'WATCHLIST', error: err.message });
          allErrors.push(`Watchlist: ${err.message}`);
        })
    );
  }
  
  // System Provider
  providerPromises.push(
    extractSystemFeatures(ctx)
      .then(result => {
        vector.system = result.features;
        providersUsed.push('SYSTEM');
        if (result.errors.length > 0) {
          result.errors.forEach(e => providerErrors.push({ source: 'SYSTEM', error: e }));
        }
      })
      .catch(err => {
        providerErrors.push({ source: 'SYSTEM', error: err.message });
        allErrors.push(`System: ${err.message}`);
      })
  );
  
  // Market Provider (optional - stub for P1.5)
  if (!options.skipMarket) {
    providerPromises.push(
      extractMarketFeatures(ctx)
        .then(result => {
          vector.market = result.features;
          providersUsed.push('MARKET');
          if (result.errors.length > 0) {
            result.errors.forEach(e => providerErrors.push({ source: 'MARKET', error: e }));
          }
        })
        .catch(err => {
          providerErrors.push({ source: 'MARKET', error: err.message });
          allErrors.push(`Market: ${err.message}`);
        })
    );
  }
  
  // Wait for all providers
  await Promise.all(providerPromises);
  
  // Calculate coverage
  vector.coverage = calculateCoverage(vector);
  
  // Apply normalization if requested
  if (options.normalize) {
    const normResult = normalizeFeatureVector(vector);
    vector.routes = normResult.normalized.routes;
    vector.dex = normResult.normalized.dex;
    vector.market = normResult.normalized.market;
    vector.actor = normResult.normalized.actor;
    vector.watchlist = normResult.normalized.watchlist;
    vector.system = normResult.normalized.system;
  }
  
  // Set build duration
  vector.buildDurationMs = Date.now() - startTime;
  vector.buildTimestamp = new Date();
  
  const result: BuildResult = {
    vector,
    errors: allErrors
  };
  
  // Persist if requested
  if (options.persist) {
    try {
      const snapshot = await saveFeatureSnapshot(vector);
      result.snapshotId = snapshot.snapshotId;
    } catch (err) {
      allErrors.push(`Persist error: ${(err as Error).message}`);
    }
  }
  
  // Create audit entry if requested
  if (options.auditLog) {
    try {
      const audit = await createAuditEntry({
        snapshotId: result.snapshotId,
        entityType: ctx.entityType,
        entityId: ctx.entityId,
        action: 'BUILD',
        taxonomyVersion: FEATURE_TAXONOMY_VERSION,
        buildDurationMs: vector.buildDurationMs,
        providersUsed,
        providerErrors,
        coveragePercent: vector.coverage.coveragePercent,
        missingCritical: vector.coverage.missingCritical,
        triggeredBy: 'API'
      });
      result.auditId = audit.auditId;
    } catch (err) {
      allErrors.push(`Audit error: ${(err as Error).message}`);
    }
  }
  
  return result;
}

// ============================================
// Coverage Calculation
// ============================================

function calculateCoverage(vector: FeatureVector): FeatureCoverage {
  const coverage: FeatureCoverage = {
    totalFeatures: Object.keys(FEATURE_REGISTRY).length,
    presentFeatures: 0,
    nullFeatures: 0,
    coveragePercent: 0,
    bySource: {
      ROUTES: { total: 0, present: 0, null: 0 },
      DEX: { total: 0, present: 0, null: 0 },
      MARKET: { total: 0, present: 0, null: 0 },
      ACTOR: { total: 0, present: 0, null: 0 },
      WATCHLIST: { total: 0, present: 0, null: 0 },
      SYSTEM: { total: 0, present: 0, null: 0 }
    },
    missingCritical: []
  };
  
  // Count by source
  const sources: FeatureSource[] = ['ROUTES', 'DEX', 'MARKET', 'ACTOR', 'WATCHLIST', 'SYSTEM'];
  
  for (const source of sources) {
    const sourceFeatures = getFeaturesBySource(source);
    coverage.bySource[source].total = sourceFeatures.length;
    
    const vectorFeatures = vector[source.toLowerCase() as keyof FeatureVector] as Record<string, any>;
    
    for (const def of sourceFeatures) {
      const value = vectorFeatures?.[def.key];
      
      if (value === null || value === undefined) {
        coverage.nullFeatures++;
        coverage.bySource[source].null++;
        
        // Track missing critical
        if (def.critical) {
          coverage.missingCritical.push(def.key);
        }
      } else {
        coverage.presentFeatures++;
        coverage.bySource[source].present++;
      }
    }
  }
  
  // Calculate percentage
  coverage.coveragePercent = coverage.totalFeatures > 0
    ? Math.round((coverage.presentFeatures / coverage.totalFeatures) * 100)
    : 0;
  
  return coverage;
}

// ============================================
// Batch Builder
// ============================================

/**
 * Build feature vectors for multiple entities
 */
export async function buildFeatureVectorsBatch(
  entities: Array<{ entityType: 'WALLET' | 'TOKEN' | 'ACTOR'; entityId: string }>,
  windowStart: Date,
  windowEnd: Date,
  options: FeatureBuildOptions = {}
): Promise<BuildResult[]> {
  const results: BuildResult[] = [];
  
  // Process in batches of 10
  const batchSize = 10;
  
  for (let i = 0; i < entities.length; i += batchSize) {
    const batch = entities.slice(i, i + batchSize);
    
    const batchPromises = batch.map(entity =>
      buildFeatureVector(
        {
          entityType: entity.entityType,
          entityId: entity.entityId,
          windowStart,
          windowEnd
        },
        options
      )
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  
  return results;
}
