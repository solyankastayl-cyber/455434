/**
 * UNRATE INGEST SERVICE — D6 v3
 * 
 * Loads Unemployment Rate data from FRED API.
 * Series: UNRATE (Civilian Unemployment Rate)
 */

import { UnratePointModel, UnrateMetaModel } from '../storage/unrate.model.js';
import { UNRATE_SERIES, UNRATE_CONFIG } from '../unrate.types.js';

// ═══════════════════════════════════════════════════════════════
// FRED CSV URL BUILDER
// ═══════════════════════════════════════════════════════════════

function buildFredCsvUrl(seriesId: string, startDate?: string): string {
  let url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  if (startDate) {
    url += `&cosd=${startDate}`;
  }
  return url;
}

// ═══════════════════════════════════════════════════════════════
// PARSE FRED CSV
// ═══════════════════════════════════════════════════════════════

function parseFredCsv(csv: string): Array<{ date: Date; value: number }> {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  
  const results: Array<{ date: Date; value: number }> = [];
  
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 2) continue;
    
    const dateStr = parts[0].trim();
    const valueStr = parts[1].trim();
    
    if (valueStr === '.' || valueStr === '') continue;
    
    const value = parseFloat(valueStr);
    if (isNaN(value)) continue;
    
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) continue;
    
    results.push({ date, value });
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// FETCH AND INGEST FROM FRED
// ═══════════════════════════════════════════════════════════════

export async function ingestUnrateFromFred(startDate?: string): Promise<{
  ok: boolean;
  written: number;
  updated: number;
  total: number;
  rangeStart: string;
  rangeEnd: string;
}> {
  const url = buildFredCsvUrl(UNRATE_SERIES, startDate);
  console.log(`[UNRATE Ingest] Fetching from FRED: ${UNRATE_SERIES}...`);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FractalBot/1.0)',
      'Accept': 'text/csv,*/*',
    },
  });
  
  if (!response.ok) {
    throw new Error(`FRED fetch failed for ${UNRATE_SERIES}: ${response.status}`);
  }
  
  const csv = await response.text();
  const dataPoints = parseFredCsv(csv);
  
  if (dataPoints.length === 0) {
    return {
      ok: false,
      written: 0,
      updated: 0,
      total: 0,
      rangeStart: '',
      rangeEnd: '',
    };
  }
  
  // Bulk upsert
  const bulkOps = dataPoints.map(dp => ({
    updateOne: {
      filter: { seriesId: UNRATE_SERIES, date: dp.date },
      update: {
        $set: {
          value: dp.value,
          source: 'FRED',
        },
      },
      upsert: true,
    },
  }));
  
  const result = await UnratePointModel.bulkWrite(bulkOps, { ordered: false });
  
  // Update meta
  const count = await UnratePointModel.countDocuments({ seriesId: UNRATE_SERIES });
  const first = await UnratePointModel.findOne({ seriesId: UNRATE_SERIES }).sort({ date: 1 }).lean();
  const last = await UnratePointModel.findOne({ seriesId: UNRATE_SERIES }).sort({ date: -1 }).lean();
  
  await UnrateMetaModel.updateOne(
    { seriesId: UNRATE_SERIES },
    {
      $set: {
        startDate: first?.date,
        endDate: last?.date,
        count,
        lastIngestAt: new Date(),
      },
    },
    { upsert: true }
  );
  
  console.log(`[UNRATE Ingest] ✅ ${result.upsertedCount} new, ${result.modifiedCount} updated, ${count} total`);
  
  return {
    ok: true,
    written: result.upsertedCount,
    updated: result.modifiedCount,
    total: count,
    rangeStart: first?.date?.toISOString().split('T')[0] || '',
    rangeEnd: last?.date?.toISOString().split('T')[0] || '',
  };
}

// ═══════════════════════════════════════════════════════════════
// GET UNRATE META
// ═══════════════════════════════════════════════════════════════

export async function getUnrateMeta(): Promise<{
  seriesId: string;
  startDate: string | null;
  endDate: string | null;
  count: number;
  lastIngestAt: string | null;
  coverageYears: number;
}> {
  const meta = await UnrateMetaModel.findOne({ seriesId: UNRATE_SERIES }).lean();
  const count = await UnratePointModel.countDocuments({ seriesId: UNRATE_SERIES });
  
  return {
    seriesId: UNRATE_SERIES,
    startDate: meta?.startDate?.toISOString().split('T')[0] || null,
    endDate: meta?.endDate?.toISOString().split('T')[0] || null,
    count,
    lastIngestAt: meta?.lastIngestAt?.toISOString() || null,
    coverageYears: Math.round(count / 12 * 10) / 10,
  };
}

// ═══════════════════════════════════════════════════════════════
// CHECK UNRATE DATA INTEGRITY
// ═══════════════════════════════════════════════════════════════

export async function checkUnrateIntegrity(): Promise<{
  ok: boolean;
  count: number;
  coverageYears: number;
  warning?: string;
}> {
  const count = await UnratePointModel.countDocuments({ seriesId: UNRATE_SERIES });
  const coverageYears = count / 12;
  
  if (count < UNRATE_CONFIG.MIN_DATA_POINTS) {
    return {
      ok: false,
      count,
      coverageYears,
      warning: `UNRATE DATA INSUFFICIENT: ${count} points (need ${UNRATE_CONFIG.MIN_DATA_POINTS}+)`,
    };
  }
  
  return { ok: true, count, coverageYears };
}
