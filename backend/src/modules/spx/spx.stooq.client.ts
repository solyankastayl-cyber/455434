/**
 * SPX TERMINAL — Stooq Client
 * 
 * BLOCK B1 — SPX Data Adapter (Stooq CSV fetch + parse)
 * 
 * Fetches daily SPX OHLCV data from Stooq (free, no API key).
 * Data available from ~1950 to present.
 */

import { SPX_STOOQ_CSV_URL } from './spx.constants.js';

export interface StooqRow {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

/**
 * Fetch CSV from Stooq
 */
export async function fetchStooqCsv(): Promise<string> {
  const res = await fetch(SPX_STOOQ_CSV_URL, {
    method: 'GET',
    headers: {
      'User-Agent': 'FractalTerminal/1.0',
      'Accept': 'text/csv,*/*',
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`STOOQ_FETCH_FAILED: ${res.status} ${res.statusText} ${txt.slice(0, 200)}`);
  }

  return await res.text();
}

/**
 * Parse number strictly
 */
function toNum(x: string): number {
  const v = Number(x);
  if (!Number.isFinite(v)) throw new Error(`BAD_NUMBER: "${x}"`);
  return v;
}

/**
 * Parse Stooq CSV into rows
 */
export function parseStooqDailyCsv(csv: string): StooqRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase().split(',');
  const idx = {
    date: header.indexOf('date'),
    open: header.indexOf('open'),
    high: header.indexOf('high'),
    low: header.indexOf('low'),
    close: header.indexOf('close'),
    volume: header.indexOf('volume'),
  };

  if (idx.date < 0 || idx.open < 0 || idx.high < 0 || idx.low < 0 || idx.close < 0) {
    throw new Error(`STOOQ_CSV_HEADER_UNEXPECTED: ${lines[0]}`);
  }

  const out: StooqRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const date = parts[idx.date]?.trim();
    if (!date) continue;

    try {
      const row: StooqRow = {
        date,
        open: toNum(parts[idx.open]),
        high: toNum(parts[idx.high]),
        low: toNum(parts[idx.low]),
        close: toNum(parts[idx.close]),
        volume: idx.volume >= 0 && parts[idx.volume] ? Number(parts[idx.volume]) : null,
      };

      // Basic sanity checks (skip impossible candles)
      if (row.low > row.high) {
        errors.push(`Low > High at ${date}`);
        continue;
      }
      if (row.open < row.low || row.open > row.high) {
        errors.push(`Open outside H/L at ${date}`);
        continue;
      }
      if (row.close < row.low || row.close > row.high) {
        errors.push(`Close outside H/L at ${date}`);
        continue;
      }
      if (row.open <= 0 || row.high <= 0 || row.low <= 0 || row.close <= 0) {
        errors.push(`Non-positive OHLC at ${date}`);
        continue;
      }

      out.push(row);
    } catch (e) {
      errors.push(`Parse error at line ${i}: ${e}`);
    }
  }

  // Sort chronologically (Stooq usually DESC, we want ASC)
  out.sort((a, b) => a.date.localeCompare(b.date));

  if (errors.length > 0 && errors.length < 10) {
    console.warn(`[Stooq] Parse warnings:`, errors);
  }

  return out;
}
