/**
 * ALT SCREENER API ROUTES
 * ========================
 * Blocks 1.4 + 1.5 API endpoints
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { WinnerMemory } from './winner.memory.js';
import { findAltCandidates } from './alt.candidates.js';
import { altFeatureBuilder } from './alt.feature.builder.js';
import { normalizeVector } from './pattern.space.js';
import { AltMlModelStore, predict, predictBatch } from './ml/index.js';
import { runAltMlTrainJob } from './ml/altml.train.job.js';
import type { IndicatorVector } from '../../exchange-alt/types.js';

export async function registerScreenerRoutes(app: FastifyInstance) {
  const db = mongoose.connection.db;
  if (!db) {
    console.warn('[Screener Routes] MongoDB not available');
    return;
  }

  const winnerMemory = new WinnerMemory(db);
  const modelStore = new AltMlModelStore(db);
  altFeatureBuilder.init(db);

  // ═══════════════════════════════════════════════════════════════
  // PATTERN-BASED CANDIDATES (Block 1.4)
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/exchange/screener/candidates', async (req: FastifyRequest<{
    Querystring: {
      horizon?: string;
      limit?: string;
      fundingFilter?: string;
    };
  }>) => {
    const horizon = (req.query.horizon ?? '4h') as '1h' | '4h' | '24h';
    const limit = parseInt(req.query.limit ?? '20');
    const fundingFilter = req.query.fundingFilter;

    // Get current altcoin vectors from exchange-alt
    const snapshotCol = db.collection('cluster_learning_snapshots');
    const latestSnapshot = await snapshotCol
      .find({})
      .sort({ ts: -1 })
      .limit(1)
      .next();

    if (!latestSnapshot?.opportunities) {
      return {
        ok: true,
        candidates: [],
        message: 'No recent snapshots available',
      };
    }

    // Build feature vectors
    const vectors = latestSnapshot.opportunities
      .filter((o: any) => o.vector)
      .slice(0, 50);

    const featureVectors = await Promise.all(
      vectors.map((o: any) =>
        altFeatureBuilder.buildFromIndicatorVector(o.vector as IndicatorVector)
      )
    );

    // Get winners for comparison
    const winners = await winnerMemory.recent(30, horizon);

    if (winners.length === 0) {
      return {
        ok: true,
        candidates: [],
        message: 'No winner patterns available yet. Collect more outcomes.',
      };
    }

    // Find candidates
    const candidates = findAltCandidates(featureVectors, winners, {
      limit,
      fundingFilter,
    });

    return {
      ok: true,
      asOf: latestSnapshot.ts,
      horizon,
      totalScanned: featureVectors.length,
      winnersInMemory: winners.length,
      candidates,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // ML-BASED CANDIDATES (Block 1.5)
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/exchange/screener/ml/predict', async (req: FastifyRequest<{
    Querystring: {
      horizon?: string;
      limit?: string;
    };
  }>) => {
    const horizon = (req.query.horizon ?? '4h') as '1h' | '4h' | '24h';
    const limit = parseInt(req.query.limit ?? '30');

    // Get latest model
    const model = await modelStore.latest(horizon);
    if (!model) {
      return {
        ok: false,
        error: 'NO_MODEL',
        message: `No trained model for horizon=${horizon}. Run training job first.`,
      };
    }

    // Get current vectors
    const snapshotCol = db.collection('cluster_learning_snapshots');
    const latestSnapshot = await snapshotCol
      .find({})
      .sort({ ts: -1 })
      .limit(1)
      .next();

    if (!latestSnapshot?.opportunities) {
      return {
        ok: true,
        candidates: [],
        message: 'No recent snapshots available',
      };
    }

    // Build and predict
    const items: Array<{ symbol: string; features: number[] }> = [];

    for (const opp of latestSnapshot.opportunities.slice(0, 50)) {
      if (!opp.vector) continue;
      const afv = await altFeatureBuilder.buildFromIndicatorVector(opp.vector);
      items.push({
        symbol: afv.symbol,
        features: normalizeVector(afv),
      });
    }

    const predictions = predictBatch(model, items).slice(0, limit);

    return {
      ok: true,
      asOf: latestSnapshot.ts,
      horizon,
      modelVersion: model.version,
      modelAccuracy: model.accuracy,
      totalScanned: items.length,
      predictions,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // MODEL MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/exchange/screener/ml/models', async () => {
    const models = await modelStore.listModels(20);
    return {
      ok: true,
      models: models.map(m => ({
        version: m.version,
        horizon: m.horizon,
        trainedAt: m.trainedAt,
        accuracy: m.accuracy,
        trainingSamples: m.trainingSamples,
        winnerRate: m.winnerRate,
      })),
    };
  });

  app.post('/api/admin/exchange/screener/ml/train', async (req: FastifyRequest<{
    Body?: {
      horizon?: string;
      daysBack?: number;
    };
  }>) => {
    const horizon = (req.body?.horizon ?? '4h') as '1h' | '4h' | '24h';
    const daysBack = req.body?.daysBack ?? 30;

    // Get symbols from universe
    const universeCol = db.collection('asset_universe');
    const assets = await universeCol
      .find({ venue: 'BINANCE', enabled: true })
      .project({ symbol: 1 })
      .limit(100)
      .toArray();

    const symbols = assets.map(a => a.symbol);
    if (symbols.length === 0) {
      return {
        ok: false,
        error: 'NO_SYMBOLS',
        message: 'No symbols in universe',
      };
    }

    const toTs = Date.now();
    const fromTs = toTs - daysBack * 24 * 60 * 60 * 1000;

    const result = await runAltMlTrainJob(db, {
      symbols,
      horizon,
      fromTs,
      toTs,
    });

    return result;
  });

  // ═══════════════════════════════════════════════════════════════
  // WINNER MEMORY
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/exchange/screener/winners', async (req: FastifyRequest<{
    Querystring: {
      horizon?: string;
      days?: string;
      limit?: string;
    };
  }>) => {
    const horizon = req.query.horizon as '1h' | '4h' | '24h' | undefined;
    const days = parseInt(req.query.days ?? '7');
    const limit = parseInt(req.query.limit ?? '30');

    const winners = await winnerMemory.recent(days, horizon);
    const stats = await winnerMemory.stats();

    return {
      ok: true,
      count: winners.length,
      stats,
      winners: winners.slice(0, limit).map(w => ({
        symbol: w.symbol,
        returnPct: w.returnPct,
        horizon: w.horizon,
        fundingLabel: w.fundingLabel,
        ts: w.ts,
      })),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // HEALTH
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/exchange/screener/health', async () => {
    const models = await modelStore.listModels(5);
    const stats = await winnerMemory.stats();

    return {
      ok: true,
      models: {
        count: models.length,
        latest: models[0]
          ? {
              version: models[0].version,
              horizon: models[0].horizon,
              accuracy: models[0].accuracy,
            }
          : null,
      },
      winnerMemory: stats,
    };
  });

  console.log('[Screener] Routes registered');
}
