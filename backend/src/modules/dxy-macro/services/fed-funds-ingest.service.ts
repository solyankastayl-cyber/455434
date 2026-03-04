/**
 * FED FUNDS INGEST SERVICE
 * 
 * Loads Federal Funds Rate data from FRED CSV or API
 * Source: FRED FEDFUNDS series
 */

import { FedFundsModel, FedFundsMetaModel } from '../storage/fed-funds.model.js';
import fs from 'fs';

// ═══════════════════════════════════════════════════════════════
// FRED CSV PARSER
// ═══════════════════════════════════════════════════════════════

function parseFredCsv(csv: string): Array<{ date: Date; value: number }> {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  
  const results: Array<{ date: Date; value: number }> = [];
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 2) continue;
    
    const dateStr = parts[0].trim();
    const valueStr = parts[1].trim();
    
    // Skip missing values (FRED uses "." for missing)
    if (valueStr === '.' || valueStr === '') continue;
    
    const value = parseFloat(valueStr);
    if (isNaN(value)) continue;
    
    // Parse date (YYYY-MM-DD format)
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) continue;
    
    results.push({ date, value });
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// INGEST FROM LOCAL CSV
// ═══════════════════════════════════════════════════════════════

export async function ingestFedFundsFromCsv(csvPath: string): Promise<{
  ok: boolean;
  written: number;
  updated: number;
  range: { from: string; to: string };
}> {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }
  
  const content = fs.readFileSync(csvPath, 'utf-8');
  const dataPoints = parseFredCsv(content);
  
  if (dataPoints.length === 0) {
    return {
      ok: false,
      written: 0,
      updated: 0,
      range: { from: '', to: '' },
    };
  }
  
  // Sort by date
  dataPoints.sort((a, b) => a.date.getTime() - b.date.getTime());
  
  // Bulk upsert
  const bulkOps = dataPoints.map(dp => ({
    updateOne: {
      filter: { date: dp.date },
      update: {
        $set: {
          value: dp.value,
          source: 'FRED_CSV',
        },
      },
      upsert: true,
    },
  }));
  
  const result = await FedFundsModel.bulkWrite(bulkOps, { ordered: false });
  
  // Update meta
  const count = await FedFundsModel.countDocuments();
  const first = await FedFundsModel.findOne().sort({ date: 1 }).lean();
  const last = await FedFundsModel.findOne().sort({ date: -1 }).lean();
  
  await FedFundsMetaModel.updateOne(
    {},
    {
      $set: {
        source: 'FRED_CSV',
        startDate: first?.date,
        endDate: last?.date,
        count,
        lastIngestAt: new Date(),
      },
    },
    { upsert: true }
  );
  
  return {
    ok: true,
    written: result.upsertedCount,
    updated: result.modifiedCount,
    range: {
      from: first?.date?.toISOString().split('T')[0] || '',
      to: last?.date?.toISOString().split('T')[0] || '',
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// FETCH FROM FRED API (online)
// ═══════════════════════════════════════════════════════════════

const FRED_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS';

export async function fetchAndIngestFromFred(): Promise<{
  ok: boolean;
  written: number;
  updated: number;
  range: { from: string; to: string };
}> {
  const response = await fetch(FRED_CSV_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FractalBot/1.0)',
      'Accept': 'text/csv,*/*',
    },
  });
  
  if (!response.ok) {
    throw new Error(`FRED fetch failed: ${response.status}`);
  }
  
  const csv = await response.text();
  const dataPoints = parseFredCsv(csv);
  
  if (dataPoints.length === 0) {
    return {
      ok: false,
      written: 0,
      updated: 0,
      range: { from: '', to: '' },
    };
  }
  
  dataPoints.sort((a, b) => a.date.getTime() - b.date.getTime());
  
  const bulkOps = dataPoints.map(dp => ({
    updateOne: {
      filter: { date: dp.date },
      update: {
        $set: {
          value: dp.value,
          source: 'FRED_API',
        },
      },
      upsert: true,
    },
  }));
  
  const result = await FedFundsModel.bulkWrite(bulkOps, { ordered: false });
  
  const count = await FedFundsModel.countDocuments();
  const first = await FedFundsModel.findOne().sort({ date: 1 }).lean();
  const last = await FedFundsModel.findOne().sort({ date: -1 }).lean();
  
  await FedFundsMetaModel.updateOne(
    {},
    {
      $set: {
        source: 'FRED_API',
        startDate: first?.date,
        endDate: last?.date,
        count,
        lastIngestAt: new Date(),
      },
    },
    { upsert: true }
  );
  
  return {
    ok: true,
    written: result.upsertedCount,
    updated: result.modifiedCount,
    range: {
      from: first?.date?.toISOString().split('T')[0] || '',
      to: last?.date?.toISOString().split('T')[0] || '',
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// GET META
// ═══════════════════════════════════════════════════════════════

export async function getFedFundsMeta() {
  const meta = await FedFundsMetaModel.findOne().lean();
  const count = await FedFundsModel.countDocuments();
  
  return {
    source: meta?.source || 'NONE',
    startDate: meta?.startDate?.toISOString().split('T')[0] || null,
    endDate: meta?.endDate?.toISOString().split('T')[0] || null,
    count,
    lastIngestAt: meta?.lastIngestAt?.toISOString() || null,
    coverageYears: Math.round(count / 12 * 10) / 10,
  };
}

// ═══════════════════════════════════════════════════════════════
// CHECK INTEGRITY
// ═══════════════════════════════════════════════════════════════

export async function checkFedFundsIntegrity(): Promise<{
  ok: boolean;
  count: number;
  coverageYears: number;
  warning?: string;
}> {
  const count = await FedFundsModel.countDocuments();
  const coverageYears = count / 12;
  
  const MIN_DATA_POINTS = 13; // At least 13 months for 12m delta
  
  if (count < MIN_DATA_POINTS) {
    return {
      ok: false,
      count,
      coverageYears,
      warning: `FED FUNDS DATA INSUFFICIENT: ${count} data points (need ${MIN_DATA_POINTS}+)`,
    };
  }
  
  return { ok: true, count, coverageYears };
}
