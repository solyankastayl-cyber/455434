/**
 * SPX TERMINAL — Yahoo CSV Ingestion
 * 
 * Imports SPX data from yfinance CSV file into MongoDB
 * with proper cohort segmentation.
 */

import { SpxCandleModel } from './spx.mongo.js';
import { pickSpxCohort } from './spx.cohorts.js';
import type { SpxCandle } from './spx.types.js';
import * as fs from 'fs';
import * as path from 'path';

// Default CSV path - updated to merged file with 2026 data
const DEFAULT_CSV_PATH = '/app/data/spx_1950_2026.csv';

interface YahooCsvRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

/**
 * Parse Yahoo Finance CSV format
 * 
 * Supports both formats:
 * 1. Raw yfinance: Price,Adj Close,Close,High,Low,Open,Volume
 * 2. Normalized: date,open,high,low,close,adj_close,volume
 */
export function parseYahooCsv(csvText: string): YahooCsvRow[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  
  // Parse header to determine format
  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  
  // Find column indices
  const idx: Record<string, number> = {};
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    if (h.includes('date') || h === 'price') idx.date = i;
    else if (h === 'open') idx.open = i;
    else if (h === 'high') idx.high = i;
    else if (h === 'low') idx.low = i;
    else if (h === 'close' && !h.includes('adj')) idx.close = i;
    else if (h.includes('adj')) idx.adjClose = i;
    else if (h.includes('volume')) idx.volume = i;
  }
  
  // Find data start (skip any meta headers like "Ticker,^GSPC...")
  let dataStartIdx = 1;
  for (let i = 1; i < Math.min(5, lines.length); i++) {
    const firstCol = lines[i].split(',')[0]?.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(firstCol)) {
      dataStartIdx = i;
      break;
    }
  }

  const rows: YahooCsvRow[] = [];
  
  for (let i = dataStartIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(',');
    const date = parts[idx.date ?? 0]?.trim();
    
    // Skip invalid dates
    if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) continue;
    
    const open = parseFloat(parts[idx.open ?? 1]);
    const high = parseFloat(parts[idx.high ?? 2]);
    const low = parseFloat(parts[idx.low ?? 3]);
    const close = parseFloat(parts[idx.close ?? 4]);
    const adjClose = parseFloat(parts[idx.adjClose ?? 5]);
    const volume = parseInt(parts[idx.volume ?? 6]) || 0;
    
    // Validate OHLC
    if (!Number.isFinite(open) || !Number.isFinite(high) || 
        !Number.isFinite(low) || !Number.isFinite(close)) {
      continue;
    }
    
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
      continue;
    }
    
    if (low > high) {
      continue;
    }
    
    rows.push({
      date,
      open,
      high,
      low,
      close,
      adjClose: Number.isFinite(adjClose) ? adjClose : close,
      volume,
    });
  }
  
  // Sort chronologically
  rows.sort((a, b) => a.date.localeCompare(b.date));
  
  return rows;
}

/**
 * Convert Yahoo CSV rows to SpxCandle documents
 * Adds idx (sequential index) and c (close alias) for calibration compatibility
 */
function toSpxCandles(rows: YahooCsvRow[]): (SpxCandle & { idx: number; c: number })[] {
  return rows.map((r, idx) => {
    const [y, m, d] = r.date.split('-').map(Number);
    const ts = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
    
    return {
      ts,
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      c: r.close, // Alias for calibration runner
      idx,        // Sequential index for deterministic outcome resolution
      volume: r.volume || null,
      symbol: 'SPX' as const,
      source: 'STOOQ' as const, // Mark as real data source
      cohort: pickSpxCohort(r.date),
    };
  });
}

/**
 * Ingest SPX data from Yahoo CSV file
 */
export async function ingestFromYahooCsv(csvPath: string = DEFAULT_CSV_PATH) {
  console.log(`[SPX Ingest] Reading CSV from: ${csvPath}`);
  
  // Read CSV file
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }
  
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  console.log(`[SPX Ingest] CSV size: ${(csvText.length / 1024).toFixed(1)} KB`);
  
  // Parse CSV
  const rows = parseYahooCsv(csvText);
  console.log(`[SPX Ingest] Parsed ${rows.length} valid rows`);
  
  if (rows.length === 0) {
    throw new Error('No valid rows found in CSV');
  }
  
  // Convert to candles
  const candles = toSpxCandles(rows);
  
  // Cohort summary before insert
  const cohortCounts: Record<string, number> = {};
  for (const c of candles) {
    cohortCounts[c.cohort] = (cohortCounts[c.cohort] || 0) + 1;
  }
  console.log(`[SPX Ingest] Cohort distribution:`, cohortCounts);
  
  // Bulk upsert in batches to avoid memory issues
  console.log(`[SPX Ingest] Upserting ${candles.length} candles in batches...`);
  
  const BATCH_SIZE = 2000;
  let totalUpserted = 0;
  let totalUpdated = 0;
  let totalMatched = 0;
  
  for (let i = 0; i < candles.length; i += BATCH_SIZE) {
    const batch = candles.slice(i, i + BATCH_SIZE);
    const ops = batch.map(c => ({
      updateOne: {
        filter: { ts: c.ts },
        update: { $set: c },
        upsert: true,
      },
    }));
    
    try {
      const result = await SpxCandleModel.bulkWrite(ops, { ordered: false });
      totalUpserted += result.upsertedCount ?? 0;
      totalUpdated += result.modifiedCount ?? 0;
      totalMatched += result.matchedCount ?? 0;
      console.log(`[SPX Ingest] Batch ${Math.floor(i/BATCH_SIZE)+1}: ${batch.length} processed`);
    } catch (err: any) {
      console.error(`[SPX Ingest] Batch error:`, err.message);
      throw err;
    }
  }
  
  console.log(`[SPX Ingest] Complete!`);
  console.log(`  - Upserted: ${totalUpserted}`);
  console.log(`  - Updated: ${totalUpdated}`);
  console.log(`  - Already existed: ${totalMatched - totalUpdated}`);
  
  return {
    ok: true,
    source: 'YAHOO_CSV',
    csvPath,
    parsed: rows.length,
    upserted: totalUpserted,
    updated: totalUpdated,
    matched: totalMatched,
    cohorts: cohortCounts,
    range: {
      from: candles[0]?.date,
      to: candles[candles.length - 1]?.date,
    },
  };
}

/**
 * Replace all SPX data with Yahoo CSV
 */
export async function replaceWithYahooCsv(csvPath: string = DEFAULT_CSV_PATH) {
  console.log(`[SPX Ingest] Clearing existing SPX data...`);
  
  const deleteResult = await SpxCandleModel.deleteMany({});
  console.log(`[SPX Ingest] Deleted ${deleteResult.deletedCount} existing candles`);
  
  return await ingestFromYahooCsv(csvPath);
}
