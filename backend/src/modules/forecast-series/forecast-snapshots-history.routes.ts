/**
 * FORECAST SNAPSHOTS HISTORY ROUTES
 * ==================================
 * 
 * V3.10-STABLE: Snapshot history with candles for overlay visualization
 * 
 * GET /api/market/forecast-snapshots
 *   - Returns historical snapshots with regenerated candles
 *   - For Ghost Mode overlay on chart
 *   - Includes WIN/LOSS outcomes via join
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import { buildBrownianBridgeCandles } from './brownian-bridge.engine.js';
import type { ForecastLayer, ForecastHorizon } from './outcome-tracking/forecast-snapshot.types.js';

function horizonToDays(h: ForecastHorizon): number {
  if (h === '1D') return 1;
  if (h === '7D') return 7;
  return 30;
}

export async function registerForecastSnapshotsHistoryRoutes(
  app: FastifyInstance,
  deps: { db: Db }
) {
  /**
   * GET /api/market/forecast-snapshots
   * 
   * Get historical snapshots with candles for overlay
   * 
   * Query params:
   *   symbol: string (default: BTC)
   *   layer: forecast | exchange
   *   horizon: 1D | 7D | 30D
   *   limit: number (default: 20, max 50)
   */
  app.get<{
    Querystring: {
      symbol?: string;
      layer?: string;
      horizon?: string;
      limit?: string;
    };
  }>('/api/market/forecast-snapshots', async (request, reply) => {
    const {
      symbol = 'BTC',
      layer = 'forecast',
      horizon = '30D',
      limit = '20',
    } = request.query;

    const symbolNorm = symbol.toUpperCase();
    const layerNorm = layer as ForecastLayer;
    const horizonNorm = horizon as ForecastHorizon;
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);

    // Validate layer
    const validLayers: ForecastLayer[] = ['forecast', 'exchange', 'onchain', 'sentiment'];
    if (!validLayers.includes(layerNorm)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_LAYER',
        message: `Layer must be one of: ${validLayers.join(', ')}`,
      });
    }

    // Validate horizon
    const validHorizons: ForecastHorizon[] = ['1D', '7D', '30D'];
    if (!validHorizons.includes(horizonNorm)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_HORIZON',
        message: `Horizon must be one of: ${validHorizons.join(', ')}`,
      });
    }

    try {
      // Aggregate snapshots with outcomes join
      const snapshots = await deps.db.collection('forecast_snapshots').aggregate([
        { $match: { symbol: symbolNorm, layer: layerNorm, horizon: horizonNorm } },
        { $sort: { createdAt: 1 } },
        { $limit: limitNum },
        // Join with outcomes
        {
          $lookup: {
            from: 'forecast_outcomes',
            localField: '_id',
            foreignField: 'snapshotId',
            as: 'outcomeArr',
          },
        },
        {
          $addFields: {
            outcome: { $arrayElemAt: ['$outcomeArr', 0] },
          },
        },
        {
          $project: {
            outcomeArr: 0, // Remove temp array
          },
        },
      ]).toArray();

      // Generate candles for each snapshot
      const days = horizonToDays(horizonNorm);
      
      const snapshotsWithCandles = snapshots.map((snap: any) => {
        // Generate candles using brownian bridge
        const startTime = Math.floor(new Date(snap.createdAt).getTime() / 1000);
        
        const candles = buildBrownianBridgeCandles({
          startPrice: snap.startPrice,
          targetPrice: snap.targetPrice,
          days,
          volDailyPct: 0.012, // Standard volatility
          startTime,
          seed: snap._id.toString().split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0), // Deterministic seed from _id
        });

        return {
          _id: snap._id.toString(),
          symbol: snap.symbol,
          layer: snap.layer,
          horizon: snap.horizon,
          createdAt: snap.createdAt,
          resolveAt: snap.resolveAt,
          startPrice: snap.startPrice,
          targetPrice: snap.targetPrice,
          expectedMovePct: snap.expectedMovePct,
          direction: snap.direction,
          confidence: snap.confidence,
          evaluation: snap.evaluation,
          outcome: snap.outcome ? {
            result: snap.outcome.result,
            realPrice: snap.outcome.realPrice,
            deviation: snap.outcome.deviation,
          } : null,
          candles,
          // For ghost mode: timestamp of first candle
          t: candles[0]?.time || startTime,
        };
      });

      return reply.send({
        ok: true,
        symbol: symbolNorm,
        layer: layerNorm,
        horizon: horizonNorm,
        count: snapshotsWithCandles.length,
        snapshots: snapshotsWithCandles,
      });
    } catch (err: any) {
      app.log.error(`[ForecastSnapshots] Error: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'INTERNAL_ERROR',
        message: err.message,
      });
    }
  });

  app.log.info('[ForecastSnapshots] History routes registered (V3.10-STABLE)');
}

console.log('[ForecastSnapshotsHistoryRoutes] Module loaded (V3.10-STABLE)');
