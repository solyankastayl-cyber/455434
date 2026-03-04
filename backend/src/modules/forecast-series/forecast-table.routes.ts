/**
 * FORECAST TABLE ROUTES
 * =====================
 * 
 * Endpoint for Forecast Performance Table UI
 * Joins forecast_snapshots + forecast_outcomes for historical analysis
 * 
 * GET /api/market/forecast-table?symbol=BTC&horizon=30D&limit=7
 */

import { FastifyInstance } from 'fastify';
import { Db, ObjectId } from 'mongodb';

const SNAPSHOTS_COLLECTION = 'forecast_snapshots';
const OUTCOMES_COLLECTION = 'forecast_outcomes';

interface ForecastTableQuery {
  symbol?: string;
  horizon?: string;
  limit?: string;
  page?: string;
}

interface TableRow {
  id: string;
  date: string;
  horizon: string;
  entry: number | null;
  target: number | null;
  actual: number | null;
  deviation: number | null;
  status: 'WIN' | 'LOSS' | 'DRAW' | 'PENDING';
  confidence: number;
  size: number | null;
}

interface TableSummary {
  winRate: number;
  avgDeviation: number;
  samples: number;
}

interface ForecastTableResponse {
  ok: boolean;
  summary: TableSummary;
  rows: TableRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function registerForecastTableRoutes(app: FastifyInstance, db: Db) {
  const snapshotsCol = db.collection(SNAPSHOTS_COLLECTION);
  const outcomesCol = db.collection(OUTCOMES_COLLECTION);

  app.get<{ Querystring: ForecastTableQuery }>(
    '/api/market/forecast-table',
    async (req, reply) => {
      try {
        const symbol = String(req.query.symbol || 'BTC').toUpperCase();
        const horizon = String(req.query.horizon || '30D').toUpperCase();
        const limit = Math.min(Math.max(1, parseInt(req.query.limit || '7', 10)), 100);
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const skip = (page - 1) * limit;

        // Map horizon to layer for backward compatibility
        // Query both 'exchange' and 'forecast' layers
        const layers = ['exchange', 'forecast'];

        // Count total for pagination
        const totalCount = await snapshotsCol.countDocuments({ 
          symbol, 
          layer: { $in: layers }, 
          horizon 
        });

        // Fetch snapshots sorted by creation date (newest first)
        const snapshots = await snapshotsCol
          .find({ symbol, layer: { $in: layers }, horizon })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        const rows: TableRow[] = [];

        for (const snap of snapshots) {
          // Find corresponding outcome by snapshotId
          const outcome = await outcomesCol.findOne({
            snapshotId: snap._id.toString()
          });

          // Extract prices from snapshot
          // startPrice = price when forecast was made
          // targetPrice = forecasted target price
          const entryPrice = snap.startPrice ?? snap.entryPrice ?? snap.currentPrice ?? null;
          const targetPrice = snap.targetPrice ?? null;
          
          // Get actual price and status from outcome (if resolved)
          let actual: number | null = null;
          let deviation: number | null = null;
          let status: 'WIN' | 'LOSS' | 'DRAW' | 'PENDING' = 'PENDING';

          if (outcome) {
            actual = outcome.realPrice ?? null;
            deviation = outcome.deviation ?? null;
            status = outcome.result ?? 'PENDING';
          } else if (snap.evaluation?.status === 'RESOLVED') {
            // Fallback to embedded evaluation if outcome not in separate collection
            actual = snap.evaluation.realPrice ?? null;
            deviation = snap.evaluation.deviation ?? null;
            status = snap.evaluation.result ?? 'PENDING';
          }

          // Calculate deviation if we have target and actual
          if (deviation === null && targetPrice && actual) {
            deviation = (actual - targetPrice) / targetPrice;
          }

          // Extract confidence and position size
          const confidence = snap.confidence ?? outcome?.confidence ?? 0;
          const positionSize = snap.positionSize ?? snap.sizing?.positionSizePct ?? null;

          rows.push({
            id: snap._id.toString(),
            date: snap.createdAt?.toISOString() ?? new Date().toISOString(),
            horizon: snap.horizon,
            entry: entryPrice,
            target: targetPrice,
            actual,
            deviation,
            status,
            confidence,
            size: positionSize,
          });
        }

        // Calculate summary statistics from resolved forecasts
        const resolved = rows.filter(r => r.status !== 'PENDING');
        const wins = resolved.filter(r => r.status === 'WIN' || r.status === 'DRAW');
        
        const winRate = resolved.length > 0 ? wins.length / resolved.length : 0;
        const avgDeviation = resolved.length > 0
          ? resolved.reduce((acc, r) => acc + Math.abs(r.deviation ?? 0), 0) / resolved.length
          : 0;

        const response: ForecastTableResponse = {
          ok: true,
          summary: {
            winRate,
            avgDeviation,
            samples: resolved.length,
          },
          rows,
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit),
          },
        };

        return reply.send(response);
      } catch (err) {
        console.error('[ForecastTable] Error:', err);
        return reply.status(500).send({
          ok: false,
          error: 'Failed to fetch forecast table data',
        });
      }
    }
  );

  console.log('[ForecastTableRoutes] Registered /api/market/forecast-table');
}
