/**
 * SPX TERMINAL — Ingestion Service
 * 
 * BLOCK B4 — Idempotent upsert ingestion from Stooq/Yahoo
 * 
 * Tries Stooq first, falls back to Yahoo Finance if rate-limited.
 */

import { SpxCandleModel, SpxIngestionLogModel } from './spx.mongo.js';
import { fetchStooqCsv, parseStooqDailyCsv } from './spx.stooq.client.js';
import { fetchYahooCandles } from './spx.yahoo.client.js';
import { toCanonicalSpxCandles } from './spx.normalizer.js';
import type { SpxIngestResult, SpxCandle } from './spx.types.js';
import { pickSpxCohort } from './spx.cohorts.js';
import { randomUUID } from 'crypto';

/**
 * Convert Yahoo rows to SpxCandle format
 */
function yahooToCandles(rows: { date: string; open: number; high: number; low: number; close: number; volume?: number | null }[]): SpxCandle[] {
  return rows.map(r => {
    const [y, m, d] = r.date.split('-').map(Number);
    const ts = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
    
    return {
      ts,
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume ?? null,
      symbol: 'SPX' as const,
      source: 'STOOQ' as const, // Mark as STOOQ for compatibility
      cohort: pickSpxCohort(r.date),
    };
  });
}

/**
 * Ingest SPX candles from Stooq or Yahoo (idempotent)
 */
export async function ingestSpxFromStooq(): Promise<SpxIngestResult & { runId: string; source: string }> {
  const runId = randomUUID();
  const startTime = Date.now();
  const errors: string[] = [];
  let source = 'STOOQ';

  try {
    let candles: SpxCandle[] = [];
    let fetchedRows = 0;

    // Try Stooq first
    try {
      const csv = await fetchStooqCsv();
      
      // Check for rate limit message
      if (csv.includes('Exceeded') || csv.includes('limit')) {
        throw new Error('Stooq rate limited');
      }
      
      const rows = parseStooqDailyCsv(csv);
      fetchedRows = rows.length;
      candles = toCanonicalSpxCandles(rows);
      source = 'STOOQ';
    } catch (stooqError: any) {
      console.log(`[SPX] Stooq failed (${stooqError.message}), trying Yahoo Finance...`);
      
      // Fallback to Yahoo Finance (^GSPC = S&P 500)
      const { rows } = await fetchYahooCandles('^GSPC', 75);
      fetchedRows = rows.length;
      candles = yahooToCandles(rows);
      source = 'YAHOO';
    }

    if (candles.length === 0) {
      const result = {
        runId,
        source,
        fetchedRows,
        canonicalRows: 0,
        written: 0,
        skipped: 0,
      };

      await SpxIngestionLogModel.create({
        runId,
        source,
        status: 'success',
        fetchedRows,
        insertedRows: 0,
        skippedRows: 0,
        errors: [],
        durationMs: Date.now() - startTime,
      });

      return result;
    }

    // Bulk upsert by ts (unique)
    const ops = candles.map((c) => ({
      updateOne: {
        filter: { ts: c.ts },
        update: { $setOnInsert: c },
        upsert: true,
      },
    }));

    const bulk = await SpxCandleModel.bulkWrite(ops, { ordered: false });
    const written = bulk.upsertedCount ?? 0;
    const skipped = candles.length - written;

    const from = candles[0]?.date;
    const to = candles[candles.length - 1]?.date;

    await SpxIngestionLogModel.create({
      runId,
      source,
      status: 'success',
      fetchedRows,
      insertedRows: written,
      skippedRows: skipped,
      errors,
      rangeFrom: from,
      rangeTo: to,
      durationMs: Date.now() - startTime,
    });

    return {
      runId,
      source,
      fetchedRows,
      canonicalRows: candles.length,
      written,
      skipped,
      from,
      to,
    };
  } catch (e: any) {
    errors.push(e.message || String(e));

    await SpxIngestionLogModel.create({
      runId,
      source,
      status: 'failed',
      fetchedRows: 0,
      insertedRows: 0,
      skippedRows: 0,
      errors,
      durationMs: Date.now() - startTime,
    });

    throw e;
  }
}

/**
 * Get recent ingestion logs
 */
export async function getIngestionLogs(limit = 10) {
  return await SpxIngestionLogModel
    .find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}
