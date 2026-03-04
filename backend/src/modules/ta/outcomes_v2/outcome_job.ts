/**
 * Phase H: Outcome Job
 * 
 * Batch recompute outcomes for scenarios
 */

import { Db } from 'mongodb';
import { MarketProvider, Candle } from './market_provider.js';
import { evaluateOutcome } from './outcome_evaluator.js';

export async function recomputeOutcomes(params: {
  db: Db;
  provider: MarketProvider;
  asset?: string;
  timeframe?: string;
  limitRuns?: number;
}): Promise<{ ok: boolean; processed: number; updated: number }> {
  
  const asset = params.asset;
  const tf = params.timeframe || '1D';
  const limitRuns = Math.min(params.limitRuns || 50, 500);

  const runQuery: any = {};
  if (asset) runQuery.asset = asset;
  if (tf) runQuery.timeframe = tf;

  const runs = await params.db.collection('ta_runs')
    .find(runQuery)
    .sort({ createdAt: -1 })
    .limit(limitRuns)
    .toArray();

  let processed = 0;
  let updated = 0;

  for (const run of runs) {
    const scenarios = await params.db.collection('ta_scenarios')
      .find({ runId: run.runId })
      .sort({ rank: 1 })
      .toArray();

    for (const sc of scenarios) {
      processed++;

      // Check if outcome already exists and is resolved
      const existing = await params.db.collection('ta_outcomes')
        .findOne({ runId: run.runId, scenarioId: sc.scenarioId });
      
      if (existing && existing.status !== 'PENDING') {
        continue;
      }

      // Get forward candles
      const fromTs = new Date(run.createdAt).getTime();
      
      let candles: Candle[] = [];
      try {
        candles = await params.provider.getCandles({
          asset: run.asset,
          timeframe: run.timeframe,
          fromTs,
          limit: 120,
        });
      } catch (err) {
        console.warn(`[Outcome Job] Failed to fetch candles for ${run.asset}:`, err);
        continue;
      }

      // Determine side and prices
      const bias = sc.intent?.bias;
      const side = bias === 'LONG' ? 'LONG' : bias === 'SHORT' ? 'SHORT' : null;
      const entry = sc.riskPack?.entry ?? null;
      const stop = sc.riskPack?.stop ?? null;
      const target1 = sc.riskPack?.target1 ?? sc.riskPack?.targets?.[0]?.price ?? null;

      if (!side) {
        await params.db.collection('ta_outcomes').updateOne(
          { runId: run.runId, scenarioId: sc.scenarioId },
          { 
            $setOnInsert: { 
              runId: run.runId, 
              scenarioId: sc.scenarioId,
              hypothesisId: sc.hypothesisId,
              asset: run.asset,
              timeframe: run.timeframe,
              status: 'NO_ENTRY', 
              reason: 'WAIT_BIAS', 
              computedAt: new Date() 
            } 
          },
          { upsert: true }
        );
        continue;
      }

      const out = evaluateOutcome({
        runId: run.runId,
        asset: run.asset,
        timeframe: run.timeframe,
        scenarioId: sc.scenarioId,
        hypothesisId: sc.hypothesisId,
        createdAt: run.createdAt,
        side,
        entry,
        stop,
        target1,
        candles,
        maxBarsToEntry: 10,
        maxBarsToResolve: 40,
      });

      await params.db.collection('ta_outcomes').updateOne(
        { runId: run.runId, scenarioId: sc.scenarioId },
        { $set: out },
        { upsert: true }
      );

      updated++;
    }
  }

  return { ok: true, processed, updated };
}
