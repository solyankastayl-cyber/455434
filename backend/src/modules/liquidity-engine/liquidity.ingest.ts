/**
 * LIQUIDITY DATA INGESTION — P2.1
 * 
 * Ingests liquidity data from FRED:
 * - WALCL: Fed Balance Sheet (weekly)
 * - RRPONTSYD: Reverse Repo (daily)
 * - WTREGEN: Treasury General Account (weekly)
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import { fetchFredSeries, FredDataPoint, hasFredApiKey } from '../dxy-macro-core/ingest/fred.client.js';
import { MacroPointModel } from '../dxy-macro-core/storage/macro_points.model.js';
import { MacroSeriesMetaModel } from '../dxy-macro-core/storage/macro_series_meta.model.js';
import {
  LIQUIDITY_SERIES,
  LiquiditySeriesId,
  LiquidityIngestResult,
  LiquidityBulkIngestResult,
} from './liquidity.contract.js';

// ═══════════════════════════════════════════════════════════════
// INGEST SINGLE SERIES
// ═══════════════════════════════════════════════════════════════

/**
 * Ingest a single liquidity series from FRED
 */
export async function ingestLiquiditySeries(
  seriesId: LiquiditySeriesId,
  startDate: string = '1990-01-01'
): Promise<LiquidityIngestResult> {
  const spec = LIQUIDITY_SERIES[seriesId];
  
  if (!spec) {
    return {
      seriesId,
      ok: false,
      pointsWritten: 0,
      pointsSkipped: 0,
      error: `Unknown liquidity series: ${seriesId}`,
    };
  }
  
  try {
    console.log(`[Liquidity Ingest] Fetching ${seriesId} from FRED...`);
    
    // Fetch from FRED
    const points = await fetchFredSeries(seriesId, startDate);
    
    if (points.length === 0) {
      return {
        seriesId,
        ok: false,
        pointsWritten: 0,
        pointsSkipped: 0,
        error: 'No data returned from FRED',
      };
    }
    
    console.log(`[Liquidity Ingest] ${seriesId}: Got ${points.length} points from FRED`);
    
    // Batch upsert for performance
    const bulkOps = points.map(p => ({
      updateOne: {
        filter: { seriesId, date: p.date },
        update: {
          $set: {
            seriesId,
            date: p.date,
            value: p.value,
            source: 'FRED',
          },
        },
        upsert: true,
      },
    }));
    
    const bulkResult = await MacroPointModel.bulkWrite(bulkOps, { ordered: false });
    const written = bulkResult.upsertedCount + bulkResult.modifiedCount;
    const skipped = points.length - written;
    
    // Update series metadata
    const firstDate = points[0].date;
    const lastDate = points[points.length - 1].date;
    const coverageYears = (new Date(lastDate).getTime() - new Date(firstDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    
    await MacroSeriesMetaModel.findOneAndUpdate(
      { seriesId },
      {
        $set: {
          seriesId,
          displayName: spec.displayName,
          frequency: spec.frequency,
          units: spec.units,
          role: 'liquidity',
          source: 'FRED',
          pointCount: points.length,
          firstDate,
          lastDate,
          coverageYears: Math.round(coverageYears * 10) / 10,
          lastIngestAt: new Date(),
        },
      },
      { upsert: true }
    );
    
    console.log(`[Liquidity Ingest] ${seriesId}: Written ${written}, Skipped ${skipped}`);
    
    return {
      seriesId,
      ok: true,
      pointsWritten: written,
      pointsSkipped: skipped,
      firstDate,
      lastDate,
    };
    
  } catch (error: any) {
    console.error(`[Liquidity Ingest] ${seriesId} failed:`, error.message);
    return {
      seriesId,
      ok: false,
      pointsWritten: 0,
      pointsSkipped: 0,
      error: error.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// INGEST ALL LIQUIDITY SERIES
// ═══════════════════════════════════════════════════════════════

/**
 * Ingest all three liquidity series
 */
export async function ingestAllLiquiditySeries(): Promise<LiquidityBulkIngestResult> {
  const start = Date.now();
  const seriesIds: LiquiditySeriesId[] = ['WALCL', 'RRPONTSYD', 'WTREGEN'];
  
  console.log(`[Liquidity Ingest] Starting bulk ingest for ${seriesIds.length} series...`);
  
  const results: LiquidityIngestResult[] = [];
  
  for (const seriesId of seriesIds) {
    const result = await ingestLiquiditySeries(seriesId);
    results.push(result);
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }
  
  const successCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  
  console.log(`[Liquidity Ingest] Bulk complete: ${successCount} success, ${failCount} failed`);
  
  return {
    ok: failCount === 0,
    totalSeries: seriesIds.length,
    successCount,
    failCount,
    results,
    processingTimeMs: Date.now() - start,
  };
}

// ═══════════════════════════════════════════════════════════════
// DATA RETRIEVAL
// ═══════════════════════════════════════════════════════════════

/**
 * Get all points for a liquidity series
 */
export async function getLiquiditySeriesPoints(
  seriesId: LiquiditySeriesId,
  fromDate?: string,
  toDate?: string
): Promise<Array<{ date: string; value: number }>> {
  const query: Record<string, any> = { seriesId };
  
  if (fromDate || toDate) {
    query.date = {};
    if (fromDate) query.date.$gte = fromDate;
    if (toDate) query.date.$lte = toDate;
  }
  
  const points = await MacroPointModel
    .find(query)
    .sort({ date: 1 })
    .select({ date: 1, value: 1, _id: 0 })
    .lean();
  
  return points as Array<{ date: string; value: number }>;
}

/**
 * Get latest point for a liquidity series
 */
export async function getLatestLiquidityPoint(
  seriesId: LiquiditySeriesId
): Promise<{ date: string; value: number } | null> {
  const point = await MacroPointModel
    .findOne({ seriesId })
    .sort({ date: -1 })
    .select({ date: 1, value: 1, _id: 0 })
    .lean();
  
  return point as { date: string; value: number } | null;
}

/**
 * Get series count for health check
 */
export async function getLiquiditySeriesCount(
  seriesId: LiquiditySeriesId
): Promise<number> {
  return MacroPointModel.countDocuments({ seriesId });
}

/**
 * Check if FRED API is available
 */
export function hasFredKey(): boolean {
  return hasFredApiKey();
}
