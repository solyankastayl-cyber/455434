/**
 * MACRO INGEST SERVICE — B1
 * 
 * Ingests macro data from FRED into MongoDB.
 * Idempotent: duplicate runs don't create duplicates.
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import { fetchFredSeries, FredDataPoint } from './fred.client.js';
import { MacroPointModel } from '../storage/macro_points.model.js';
import { MacroSeriesMetaModel } from '../storage/macro_series_meta.model.js';
import {
  MACRO_SERIES_REGISTRY,
  getDefaultMacroSeries,
  getMacroSeriesSpec,
  MacroSeriesSpec,
} from '../data/macro_sources.registry.js';
import {
  MacroIngestResult,
  MacroBulkIngestResult,
} from '../contracts/macro.contracts.js';

// ═══════════════════════════════════════════════════════════════
// INGEST SINGLE SERIES
// ═══════════════════════════════════════════════════════════════

/**
 * Ingest a single macro series from FRED
 * 
 * @param seriesId - FRED series ID
 * @param startDate - Optional start date (default: 1950-01-01)
 * @returns Ingest result
 */
export async function ingestMacroSeries(
  seriesId: string,
  startDate: string = '1950-01-01'
): Promise<MacroIngestResult> {
  const spec = getMacroSeriesSpec(seriesId);
  
  if (!spec) {
    return {
      seriesId,
      ok: false,
      pointsWritten: 0,
      pointsSkipped: 0,
      error: `Unknown series: ${seriesId}`,
    };
  }
  
  try {
    console.log(`[Macro Ingest] Fetching ${seriesId} from FRED...`);
    
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
    
    console.log(`[Macro Ingest] ${seriesId}: Got ${points.length} points from FRED`);
    
    // Upsert points (idempotent)
    let written = 0;
    let skipped = 0;
    
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
    written = bulkResult.upsertedCount + bulkResult.modifiedCount;
    skipped = points.length - written;
    
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
          role: spec.role,
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
    
    console.log(`[Macro Ingest] ${seriesId}: Written ${written}, Skipped ${skipped}`);
    
    return {
      seriesId,
      ok: true,
      pointsWritten: written,
      pointsSkipped: skipped,
      firstDate,
      lastDate,
    };
    
  } catch (error: any) {
    console.error(`[Macro Ingest] ${seriesId} failed:`, error.message);
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
// INGEST ALL DEFAULT SERIES
// ═══════════════════════════════════════════════════════════════

/**
 * Ingest all enabled macro series
 * 
 * @param seriesIds - Optional list of series IDs (default: all enabled)
 * @returns Bulk ingest result
 */
export async function ingestAllMacroSeries(
  seriesIds?: string[]
): Promise<MacroBulkIngestResult> {
  const start = Date.now();
  
  // Get series to ingest
  const targetIds = seriesIds?.length ? seriesIds : getDefaultMacroSeries();
  
  console.log(`[Macro Ingest] Starting bulk ingest for ${targetIds.length} series...`);
  
  const results: MacroIngestResult[] = [];
  
  for (const seriesId of targetIds) {
    const result = await ingestMacroSeries(seriesId);
    results.push(result);
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }
  
  const successCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  
  console.log(`[Macro Ingest] Bulk complete: ${successCount} success, ${failCount} failed`);
  
  return {
    ok: failCount === 0,
    totalSeries: targetIds.length,
    successCount,
    failCount,
    results,
    processingTimeMs: Date.now() - start,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET SERIES DATA
// ═══════════════════════════════════════════════════════════════

/**
 * Get all points for a series from database
 */
export async function getMacroSeriesPoints(
  seriesId: string,
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
 * Get latest point for a series
 */
export async function getLatestMacroPoint(
  seriesId: string
): Promise<{ date: string; value: number } | null> {
  const point = await MacroPointModel
    .findOne({ seriesId })
    .sort({ date: -1 })
    .select({ date: 1, value: 1, _id: 0 })
    .lean();
  
  return point as { date: string; value: number } | null;
}

/**
 * Get all series metadata
 */
export async function getAllSeriesMeta(): Promise<Array<{
  seriesId: string;
  displayName: string;
  frequency: string;
  role: string;
  pointCount: number;
  firstDate: string;
  lastDate: string;
  coverageYears: number;
}>> {
  const metas = await MacroSeriesMetaModel
    .find()
    .select({ seriesId: 1, displayName: 1, frequency: 1, role: 1, pointCount: 1, firstDate: 1, lastDate: 1, coverageYears: 1, _id: 0 })
    .lean();
  
  return metas as any[];
}
