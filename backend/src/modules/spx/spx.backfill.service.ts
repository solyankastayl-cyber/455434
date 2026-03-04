/**
 * SPX TERMINAL — Backfill Service
 * 
 * BLOCK B2/B5 — Resume-safe backfill with cohort tagging
 * 
 * Features:
 * - Resume-safe (can continue after interruption)
 * - Batch processing
 * - Progress tracking
 * - Cohort assignment
 */

import { SpxCandleModel, SpxBackfillProgressModel } from './spx.mongo.js';
import { fetchStooqCsv, parseStooqDailyCsv } from './spx.stooq.client.js';
import { toCanonicalSpxCandles, filterByDateRange } from './spx.normalizer.js';
import type { SpxCohort } from './spx.types.js';

interface BackfillArgs {
  from: string;       // YYYY-MM-DD
  to: string;         // YYYY-MM-DD
  batchSize?: number; // default 1000
  jobId?: string;     // default 'spx_full_backfill'
}

function isoToTs(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Run SPX backfill for a date range (resume-safe)
 */
export async function runSpxBackfill(args: BackfillArgs) {
  const jobId = args.jobId || 'spx_full_backfill';
  const batchSize = args.batchSize ?? 1000;
  const fromTs = isoToTs(args.from);
  const toTs = isoToTs(args.to);

  // Get or create progress
  let progress = await SpxBackfillProgressModel.findOne({ jobId });
  if (!progress) {
    progress = await SpxBackfillProgressModel.create({ 
      jobId,
      status: 'idle',
      lastProcessedTs: 0,
      totalInserted: 0,
      totalUpdated: 0,
      errors: 0,
    });
  }

  // Check if already running
  if (progress.status === 'running') {
    throw new Error(`Backfill job ${jobId} is already running`);
  }

  // Start job
  progress.status = 'running';
  progress.startedAt = new Date();
  await progress.save();

  try {
    // Fetch and parse CSV
    const csv = await fetchStooqCsv();
    const rows = parseStooqDailyCsv(csv);
    const candlesAll = toCanonicalSpxCandles(rows);

    // Filter by date range
    const candles = candlesAll.filter(c => c.ts >= fromTs && c.ts <= toTs);
    candles.sort((a, b) => a.ts - b.ts);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    // Process in batches
    for (let i = 0; i < candles.length; i += batchSize) {
      const batch = candles.slice(i, i + batchSize);

      for (const c of batch) {
        // Skip if already processed (resume-safe)
        if (c.ts <= progress.lastProcessedTs) {
          skipped++;
          continue;
        }

        try {
          const res = await SpxCandleModel.updateOne(
            { ts: c.ts },
            { $set: c },
            { upsert: true }
          );

          const upserted = (res as any).upsertedCount ?? 0;
          const modified = (res as any).modifiedCount ?? 0;

          if (upserted > 0) inserted++;
          else if (modified > 0) updated++;
          else skipped++;

          progress.lastProcessedTs = c.ts;
        } catch (e: any) {
          // Handle duplicate key errors gracefully
          if (e.code === 11000) {
            skipped++;
          } else {
            progress.errors++;
            console.error(`[SPX Backfill] Error at ${c.date}:`, e.message);
          }
        }
      }

      // Save progress after each batch
      await progress.save();
    }

    // Complete job
    progress.status = 'completed';
    progress.totalInserted += inserted;
    progress.totalUpdated += updated;
    progress.completedAt = new Date();
    await progress.save();

    return {
      ok: true,
      jobId,
      range: { from: args.from, to: args.to },
      totalFiltered: candles.length,
      inserted,
      updated,
      skipped,
      errors: progress.errors,
      lastProcessedTs: progress.lastProcessedTs,
    };
  } catch (e: any) {
    progress.status = 'failed';
    progress.errors++;
    await progress.save();
    throw e;
  }
}

/**
 * Get backfill progress
 */
export async function getBackfillProgress(jobId = 'spx_full_backfill') {
  return await SpxBackfillProgressModel.findOne({ jobId }).lean();
}

/**
 * Reset backfill progress (for re-run)
 */
export async function resetBackfillProgress(jobId = 'spx_full_backfill') {
  const result = await SpxBackfillProgressModel.updateOne(
    { jobId },
    { 
      $set: { 
        status: 'idle',
        lastProcessedTs: 0,
        totalInserted: 0,
        totalUpdated: 0,
        errors: 0,
        startedAt: null,
        completedAt: null,
      }
    }
  );
  return { ok: true, reset: result.modifiedCount > 0 };
}

/**
 * Get candle counts by cohort
 */
export async function getCohortCounts(): Promise<Record<SpxCohort | 'total', number>> {
  const pipeline = [
    { $group: { _id: '$cohort', count: { $sum: 1 } } },
  ];

  const results = await SpxCandleModel.aggregate(pipeline);
  const total = await SpxCandleModel.countDocuments({});

  const counts: Record<string, number> = { total };
  for (const r of results) {
    counts[r._id] = r.count;
  }

  return counts as Record<SpxCohort | 'total', number>;
}
