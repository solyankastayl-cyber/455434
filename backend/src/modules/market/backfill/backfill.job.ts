/**
 * PHASE 1.4 — Backfill Job
 * =========================
 * 
 * Job that:
 * 1. Fetches historical price data from provider
 * 2. Stores price bars in database
 * 3. Evaluates verdicts against price history
 * 4. Creates truth records
 */

import { BackfillRunModel } from './backfill.model.js';
import { BackfillRun, Timeframe } from '../history/history.types.js';
import { fetchAndStorePriceBars, getPriceBars, getTimeframeMs } from '../history/priceHistory.service.js';
import { evaluateVerdicts } from '../history/truthEvaluator.service.js';
import { generateMockVerdictHistory } from '../chart/verdict-history.service.js';

/**
 * Generate a simple unique ID
 */
function generateRunId(): string {
  return `backfill_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Create and start a backfill run
 */
export async function createBackfillRun(params: {
  symbol: string;
  tf: Timeframe;
  days: number;
}): Promise<BackfillRun> {
  const { symbol, tf, days } = params;
  
  const runId = generateRunId();
  const now = Date.now();
  const from = now - days * 24 * 60 * 60 * 1000;
  const to = now;
  
  const run: BackfillRun = {
    runId,
    symbol: symbol.toUpperCase(),
    tf,
    days,
    from,
    to,
    status: 'PENDING',
    progress: {
      barsSaved: 0,
      truthRecordsSaved: 0,
      lastTs: null,
    },
    error: null,
    startedAt: now,
    completedAt: null,
  };
  
  await BackfillRunModel.create(run);
  
  // Start job asynchronously
  executeBackfillRun(runId).catch(err => {
    console.error(`[Backfill] Error in run ${runId}:`, err);
  });
  
  return run;
}

/**
 * Execute backfill run
 */
async function executeBackfillRun(runId: string): Promise<void> {
  const run = await BackfillRunModel.findOne({ runId });
  if (!run) {
    console.error(`[Backfill] Run ${runId} not found`);
    return;
  }
  
  try {
    // Update status to RUNNING
    await BackfillRunModel.updateOne(
      { runId },
      { $set: { status: 'RUNNING' } }
    );
    
    const { symbol, tf, from, to } = run;
    
    console.log(`[Backfill] Starting ${runId}: ${symbol} ${tf} ${run.days}d`);
    
    // Step 1: Fetch and store price bars
    let barsSaved = 0;
    const tfMs = getTimeframeMs(tf as Timeframe);
    const batchSize = 500;
    
    // Fetch in batches if needed
    for (let batchFrom = from; batchFrom < to; batchFrom += batchSize * tfMs) {
      const batchTo = Math.min(batchFrom + batchSize * tfMs, to);
      
      const result = await fetchAndStorePriceBars({
        symbol,
        tf: tf as Timeframe,
        from: batchFrom,
        to: batchTo,
        limit: batchSize,
      });
      
      barsSaved += result.stored;
      
      // Update progress
      await BackfillRunModel.updateOne(
        { runId },
        { 
          $set: { 
            'progress.barsSaved': barsSaved,
            'progress.lastTs': batchTo,
          } 
        }
      );
    }
    
    // Step 2: Get stored price bars
    const prices = await getPriceBars({
      symbol,
      tf: tf as Timeframe,
      from,
      to,
    });
    
    // Step 3: Generate mock verdicts for testing
    // In production, this would fetch real verdicts from Meta-Brain
    const verdicts = generateMockVerdictHistory({
      symbol,
      from,
      to,
      intervalMs: tfMs,
    });
    
    // Step 4: Evaluate verdicts against price history
    const truthResult = await evaluateVerdicts({
      symbol,
      tf: tf as Timeframe,
      verdicts: verdicts.map(v => ({
        ts: v.ts,
        verdict: v.verdict,
        confidence: v.confidence,
      })),
      prices,
    });
    
    // Step 5: Update run as completed
    await BackfillRunModel.updateOne(
      { runId },
      {
        $set: {
          status: 'COMPLETED',
          'progress.barsSaved': barsSaved,
          'progress.truthRecordsSaved': truthResult.evaluated,
          completedAt: Date.now(),
        },
      }
    );
    
    console.log(`[Backfill] Completed ${runId}: ${barsSaved} bars, ${truthResult.evaluated} truth records`);
    console.log(`[Backfill] Results: ${truthResult.confirmed} confirmed, ${truthResult.diverged} diverged, ${truthResult.noData} no_data`);
    
  } catch (error) {
    console.error(`[Backfill] Failed ${runId}:`, error);
    
    await BackfillRunModel.updateOne(
      { runId },
      {
        $set: {
          status: 'FAILED',
          error: error instanceof Error ? error.message : String(error),
          completedAt: Date.now(),
        },
      }
    );
  }
}

/**
 * Get backfill run status
 */
export async function getBackfillRun(runId: string): Promise<BackfillRun | null> {
  const run = await BackfillRunModel.findOne({ runId }).lean();
  return run as BackfillRun | null;
}

/**
 * Get recent backfill runs for a symbol
 */
export async function getBackfillRuns(params: {
  symbol?: string;
  limit?: number;
}): Promise<BackfillRun[]> {
  const { symbol, limit = 10 } = params;
  
  const query: any = {};
  if (symbol) query.symbol = symbol.toUpperCase();
  
  const runs = await BackfillRunModel.find(query)
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean();
  
  return runs as BackfillRun[];
}

console.log('[Phase 1.4] Backfill Job loaded');
