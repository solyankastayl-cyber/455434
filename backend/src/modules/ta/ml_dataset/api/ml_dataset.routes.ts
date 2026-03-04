/**
 * Phase K: ML Dataset API Routes
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Db } from 'mongodb';
import { runDatasetBuild, getDatasetJobStatus, initDatasetIndexes } from '../jobs/dataset_job.js';
import { buildDataset, getDatasetStats } from '../dataset_builder.js';
import { getDefaultPaths } from '../dataset_writer.js';

export interface MLDatasetRouteDeps {
  db: Db;
}

export async function registerMLDatasetRoutes(
  app: FastifyInstance,
  deps: MLDatasetRouteDeps
): Promise<void> {
  const { db } = deps;

  // Initialize indexes
  initDatasetIndexes(db).catch(err => {
    console.error('[ML Dataset Routes] Failed to init indexes:', err);
  });

  // ═══════════════════════════════════════════════════════════════
  // Status & Stats
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/ta/ml_dataset/status
   * Get dataset builder status and stats
   */
  app.get('/ml_dataset/status', async () => {
    const status = await getDatasetJobStatus(db);
    
    return {
      ok: true,
      phase: 'K',
      description: 'ML Dataset Builder — Feature extraction for ML training',
      ...status,
      paths: getDefaultPaths(),
    };
  });

  /**
   * GET /api/ta/ml_dataset/stats
   * Get raw collection statistics
   */
  app.get('/ml_dataset/stats', async (request: FastifyRequest<{
    Querystring: { asset?: string; timeframe?: string }
  }>) => {
    const { asset, timeframe } = request.query;
    
    const stats = await getDatasetStats({ db, asset, timeframe });
    
    return {
      ok: true,
      asset: asset || 'ALL',
      timeframe: timeframe || 'ALL',
      stats,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // Build & Export
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /api/ta/ml_dataset/build
   * Build ML dataset from ta_runs/ta_scenarios/ta_outcomes
   */
  app.post('/ml_dataset/build', async (request: FastifyRequest<{
    Body: {
      asset?: string;
      timeframe?: string;
      limit?: number;
      minScore?: number;
      includeTimeout?: boolean;
      exportCSV?: boolean;
      exportJSON?: boolean;
      exportMongo?: boolean;
    }
  }>) => {
    const {
      asset,
      timeframe,
      limit = 10000,
      minScore = 0,
      includeTimeout = false,
      exportCSV = true,
      exportJSON = false,
      exportMongo = true,
    } = request.body || {};

    const result = await runDatasetBuild({
      db,
      options: {
        asset,
        timeframe,
        limit,
        minScore,
        includeTimeout,
      },
      exportCSV,
      exportJSON,
      exportMongo,
    });

    return {
      ok: result.ok,
      rowsBuilt: result.build.rows.length,
      stats: result.build.stats,
      exports: result.exports,
      timestamp: result.timestamp,
    };
  });

  /**
   * GET /api/ta/ml_dataset/preview
   * Preview dataset without building/exporting
   */
  app.get('/ml_dataset/preview', async (request: FastifyRequest<{
    Querystring: { asset?: string; limit?: string }
  }>) => {
    const { asset, limit = '10' } = request.query;

    const result = await buildDataset({
      db,
      options: {
        asset,
        limit: Math.min(parseInt(limit, 10), 50),
      },
    });

    return {
      ok: result.ok,
      stats: result.stats,
      preview: result.rows.slice(0, 10).map(row => ({
        runId: row.runId.slice(0, 8) + '...',
        scenarioId: row.scenarioId?.slice(0, 8) + '...',
        asset: row.asset,
        outcome: row.outcome,
        score: row.score.toFixed(3),
        probability: row.calibratedProbability.toFixed(3),
        regime: `${row.marketRegime}_${row.volRegime}`,
        primaryPattern: row.primaryPattern,
        rrToT1: row.rrToT1.toFixed(2),
      })),
    };
  });

  /**
   * GET /api/ta/ml_dataset/rows
   * Get rows from built dataset (from MongoDB)
   */
  app.get('/ml_dataset/rows', async (request: FastifyRequest<{
    Querystring: { limit?: string; offset?: string; outcome?: string }
  }>) => {
    const { limit = '100', offset = '0', outcome } = request.query;

    const filter: any = {};
    if (outcome === '1' || outcome === 'WIN') filter.outcome = 1;
    else if (outcome === '0' || outcome === 'LOSS') filter.outcome = 0;

    const rows = await db.collection('ta_ml_rows')
      .find(filter)
      .skip(parseInt(offset, 10))
      .limit(parseInt(limit, 10))
      .project({ _id: 0 })
      .toArray();

    const total = await db.collection('ta_ml_rows').countDocuments(filter);

    return {
      ok: true,
      total,
      offset: parseInt(offset, 10),
      limit: parseInt(limit, 10),
      count: rows.length,
      rows,
    };
  });

  /**
   * GET /api/ta/ml_dataset/features
   * Get feature schema/metadata
   */
  app.get('/ml_dataset/features', async () => {
    return {
      ok: true,
      phase: 'K',
      featureSchema: {
        identifiers: ['runId', 'scenarioId', 'asset', 'timeframe', 'createdAt'],
        target: ['outcome'],
        baseline: ['score', 'calibratedProbability'],
        regime: ['marketRegime', 'volRegime'],
        pattern: ['patternCount', 'primaryPattern'],
        confluence: ['confluenceScore', 'confluenceFactors'],
        structure: ['trendAlignment'],
        ma: ['ma20Slope', 'ma50Slope', 'maAlignment'],
        volatility: ['atrPercentile'],
        geometry: ['compression'],
        risk: ['rrToT1', 'rrToT2', 'riskPct', 'rewardPct'],
      },
      totalFeatures: 20,
      categoricalFeatures: ['marketRegime', 'volRegime', 'primaryPattern'],
      numericFeatures: [
        'score', 'calibratedProbability', 'patternCount', 'confluenceScore',
        'confluenceFactors', 'trendAlignment', 'ma20Slope', 'ma50Slope',
        'maAlignment', 'atrPercentile', 'compression', 'rrToT1', 'rrToT2',
        'riskPct', 'rewardPct',
      ],
    };
  });
}
