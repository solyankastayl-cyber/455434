/**
 * DXY INGEST SERVICE — Idempotent Data Loading
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 * Source: STOOQ (CSV)
 */

import { DxyCandleModel, DxyMetaModel } from '../storage/dxy-candles.model.js';
import type { DxyCandle, DxyIngestResponse } from '../contracts/dxy.types.js';

// ═══════════════════════════════════════════════════════════════
// STOOQ CLIENT
// ═══════════════════════════════════════════════════════════════

const STOOQ_DXY_URL = 'https://stooq.com/q/d/l/?s=dxy.us&i=d';

interface StooqRow {
  Date: string;
  Open: string;
  High: string;
  Low: string;
  Close: string;
  Volume?: string;
}

async function fetchFromStooq(): Promise<DxyCandle[]> {
  const response = await fetch(STOOQ_DXY_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FractalBot/1.0)',
      'Accept': 'text/csv,*/*',
    },
  });
  
  if (!response.ok) {
    throw new Error(`STOOQ fetch failed: ${response.status}`);
  }
  
  const text = await response.text();
  return parseStooqCsv(text);
}

function parseStooqCsv(csv: string): DxyCandle[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  
  const candles: DxyCandle[] = [];
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 5) continue;
    
    const date = parts[0].trim();
    const open = parseFloat(parts[1]);
    const high = parseFloat(parts[2]);
    const low = parseFloat(parts[3]);
    const close = parseFloat(parts[4]);
    const volume = parts[5] ? parseFloat(parts[5]) : 0;
    
    if (date && !isNaN(close) && close > 0) {
      candles.push({
        date,
        open,
        high,
        low,
        close,
        volume,
        source: 'STOOQ',
      });
    }
  }
  
  return candles;
}

// ═══════════════════════════════════════════════════════════════
// LOCAL CSV INGEST
// ═══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

export async function ingestFromLocalCsv(csvPath: string): Promise<DxyIngestResponse> {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }
  
  const content = fs.readFileSync(csvPath, 'utf-8');
  const candles = parseStooqCsv(content);
  
  return ingestCandles(candles, 'LOCAL_CSV');
}

// ═══════════════════════════════════════════════════════════════
// STOOQ INGEST (online)
// ═══════════════════════════════════════════════════════════════

export async function ingestFromStooq(): Promise<DxyIngestResponse> {
  const candles = await fetchFromStooq();
  return ingestCandles(candles, 'STOOQ');
}

// ═══════════════════════════════════════════════════════════════
// CORE INGEST (idempotent upsert)
// ═══════════════════════════════════════════════════════════════

async function ingestCandles(candles: DxyCandle[], source: string): Promise<DxyIngestResponse> {
  if (!candles || candles.length === 0) {
    return {
      ok: false,
      source,
      written: 0,
      updated: 0,
      range: { from: '', to: '' },
    };
  }
  
  // Sort by date
  candles.sort((a, b) => a.date.localeCompare(b.date));
  
  // Bulk upsert
  const bulkOps = candles.map(c => ({
    updateOne: {
      filter: { date: new Date(c.date) },
      update: {
        $set: {
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0,
          source,
        },
      },
      upsert: true,
    },
  }));
  
  const result = await DxyCandleModel.bulkWrite(bulkOps, { ordered: false });
  
  // Update meta
  const count = await DxyCandleModel.countDocuments();
  const first = await DxyCandleModel.findOne().sort({ date: 1 }).lean();
  const last = await DxyCandleModel.findOne().sort({ date: -1 }).lean();
  
  await DxyMetaModel.updateOne(
    {},
    {
      $set: {
        source,
        startDate: first?.date,
        endDate: last?.date,
        count,
        lastIngestAt: new Date(),
        checksum: `${count}-${last?.date?.toISOString().split('T')[0]}`,
      },
    },
    { upsert: true }
  );
  
  return {
    ok: true,
    source,
    written: result.upsertedCount,
    updated: result.modifiedCount,
    range: {
      from: first?.date?.toISOString().split('T')[0] || '',
      to: last?.date?.toISOString().split('T')[0] || '',
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// INTEGRITY CHECK
// ═══════════════════════════════════════════════════════════════

export async function checkDxyIntegrity(): Promise<{
  ok: boolean;
  count: number;
  coverageYears: number;
  warning?: string;
}> {
  const count = await DxyCandleModel.countDocuments();
  const coverageYears = count / 252; // ~252 trading days/year
  
  const MIN_CANDLES = 5000; // ~20 years minimum
  
  if (count < MIN_CANDLES) {
    return {
      ok: false,
      count,
      coverageYears,
      warning: `DXY DATA INSUFFICIENT: ${count} candles (need ${MIN_CANDLES}+)`,
    };
  }
  
  return { ok: true, count, coverageYears };
}

// ═══════════════════════════════════════════════════════════════
// GET META
// ═══════════════════════════════════════════════════════════════

export async function getDxyMeta() {
  const meta = await DxyMetaModel.findOne().lean();
  const count = await DxyCandleModel.countDocuments();
  
  return {
    source: meta?.source || 'NONE',
    startDate: meta?.startDate?.toISOString().split('T')[0] || null,
    endDate: meta?.endDate?.toISOString().split('T')[0] || null,
    count,
    lastIngestAt: meta?.lastIngestAt?.toISOString() || null,
    checksum: meta?.checksum || null,
    coverageYears: Math.round(count / 252 * 10) / 10,
  };
}
