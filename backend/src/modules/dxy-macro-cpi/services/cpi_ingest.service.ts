/**
 * CPI INGEST SERVICE — D6 v2
 * 
 * Loads CPI data from FRED API.
 * Series: CPIAUCSL (Headline), CPILFESL (Core)
 */

import { CpiPointModel, CpiMetaModel } from '../storage/cpi.model.js';
import { CPI_SERIES } from '../contracts/cpi.contract.js';

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

function parseFredCsv(csv: string, seriesId: string): Array<{ date: Date; value: number }> {
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
// FETCH AND INGEST SINGLE SERIES
// ═══════════════════════════════════════════════════════════════

async function fetchAndIngestSeries(seriesId: string, startDate?: string): Promise<{
  written: number;
  updated: number;
  total: number;
}> {
  const url = buildFredCsvUrl(seriesId, startDate);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FractalBot/1.0)',
      'Accept': 'text/csv,*/*',
    },
  });
  
  if (!response.ok) {
    throw new Error(`FRED fetch failed for ${seriesId}: ${response.status}`);
  }
  
  const csv = await response.text();
  const dataPoints = parseFredCsv(csv, seriesId);
  
  if (dataPoints.length === 0) {
    return { written: 0, updated: 0, total: 0 };
  }
  
  // Bulk upsert
  const bulkOps = dataPoints.map(dp => ({
    updateOne: {
      filter: { seriesId, date: dp.date },
      update: {
        $set: {
          value: dp.value,
          source: 'FRED',
        },
      },
      upsert: true,
    },
  }));
  
  const result = await CpiPointModel.bulkWrite(bulkOps, { ordered: false });
  
  // Update meta
  const count = await CpiPointModel.countDocuments({ seriesId });
  const first = await CpiPointModel.findOne({ seriesId }).sort({ date: 1 }).lean();
  const last = await CpiPointModel.findOne({ seriesId }).sort({ date: -1 }).lean();
  
  await CpiMetaModel.updateOne(
    { seriesId },
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
  
  return {
    written: result.upsertedCount,
    updated: result.modifiedCount,
    total: count,
  };
}

// ═══════════════════════════════════════════════════════════════
// INGEST ALL CPI SERIES
// ═══════════════════════════════════════════════════════════════

export async function ingestAllCpiSeries(startDate?: string): Promise<{
  ok: boolean;
  headline: { written: number; updated: number; total: number };
  core: { written: number; updated: number; total: number };
  rangeStart: string;
  rangeEnd: string;
}> {
  console.log(`[CPI Ingest] Starting ingest from ${startDate || 'beginning'}...`);
  
  // Fetch both series
  const [headlineResult, coreResult] = await Promise.all([
    fetchAndIngestSeries(CPI_SERIES.HEADLINE, startDate),
    fetchAndIngestSeries(CPI_SERIES.CORE, startDate),
  ]);
  
  console.log(`[CPI Ingest] Headline: ${headlineResult.written} new, ${headlineResult.total} total`);
  console.log(`[CPI Ingest] Core: ${coreResult.written} new, ${coreResult.total} total`);
  
  // Get overall range
  const first = await CpiPointModel.findOne().sort({ date: 1 }).lean();
  const last = await CpiPointModel.findOne().sort({ date: -1 }).lean();
  
  return {
    ok: true,
    headline: headlineResult,
    core: coreResult,
    rangeStart: first?.date?.toISOString().split('T')[0] || '',
    rangeEnd: last?.date?.toISOString().split('T')[0] || '',
  };
}

// ═══════════════════════════════════════════════════════════════
// GET CPI META
// ═══════════════════════════════════════════════════════════════

export async function getCpiMeta(): Promise<{
  headline: any;
  core: any;
  totalPoints: number;
}> {
  const headlineMeta = await CpiMetaModel.findOne({ seriesId: CPI_SERIES.HEADLINE }).lean();
  const coreMeta = await CpiMetaModel.findOne({ seriesId: CPI_SERIES.CORE }).lean();
  const totalPoints = await CpiPointModel.countDocuments();
  
  return {
    headline: headlineMeta ? {
      seriesId: headlineMeta.seriesId,
      startDate: headlineMeta.startDate?.toISOString().split('T')[0],
      endDate: headlineMeta.endDate?.toISOString().split('T')[0],
      count: headlineMeta.count,
      lastIngestAt: headlineMeta.lastIngestAt?.toISOString(),
    } : null,
    core: coreMeta ? {
      seriesId: coreMeta.seriesId,
      startDate: coreMeta.startDate?.toISOString().split('T')[0],
      endDate: coreMeta.endDate?.toISOString().split('T')[0],
      count: coreMeta.count,
      lastIngestAt: coreMeta.lastIngestAt?.toISOString(),
    } : null,
    totalPoints,
  };
}

// ═══════════════════════════════════════════════════════════════
// CHECK CPI DATA INTEGRITY
// ═══════════════════════════════════════════════════════════════

export async function checkCpiIntegrity(): Promise<{
  ok: boolean;
  headline: number;
  core: number;
  warning?: string;
}> {
  const headlineCount = await CpiPointModel.countDocuments({ seriesId: CPI_SERIES.HEADLINE });
  const coreCount = await CpiPointModel.countDocuments({ seriesId: CPI_SERIES.CORE });
  
  const MIN_POINTS = 13; // Need 13 months for YoY calculation
  
  if (headlineCount < MIN_POINTS || coreCount < MIN_POINTS) {
    return {
      ok: false,
      headline: headlineCount,
      core: coreCount,
      warning: `CPI DATA INSUFFICIENT: headline=${headlineCount}, core=${coreCount} (need ${MIN_POINTS}+)`,
    };
  }
  
  return { ok: true, headline: headlineCount, core: coreCount };
}
