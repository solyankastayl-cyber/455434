/**
 * Phase I.0: Regime Job
 * 
 * Batch recompute regime labels for ta_runs
 */

import { Db } from 'mongodb';
import { buildRegimeLabel, inferRegimeSignals } from './regime_engine.js';

export async function recomputeRegimes(params: {
  db: Db;
  asset?: string;
  timeframe?: string;
  limitRuns?: number;
}): Promise<{ ok: boolean; updated: number }> {
  const limit = Math.min(params.limitRuns ?? 200, 2000);

  const query: any = {};
  if (params.asset) query.asset = params.asset;
  if (params.timeframe) query.timeframe = params.timeframe;

  const runs = await params.db.collection('ta_runs')
    .find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  let updated = 0;

  for (const run of runs) {
    const snap = run.snapshot ?? {};
    const features = run.features ?? run.signals ?? run.featurePack ?? {};
    const structure = run.structure ?? {};

    // Infer signals from available data
    const signals = inferRegimeSignals(features, structure);

    // Build label
    const label = buildRegimeLabel({
      maAlignment: signals.maAlignment || 'MIXED',
      maSlope20: signals.maSlope20 || 0,
      maSlope50: signals.maSlope50 || 0,
      structure: signals.structure || 'UNKNOWN',
      compression: signals.compression || 0,
      atrPercentile: signals.atrPercentile || 0.5,
    });

    await params.db.collection('ta_runs').updateOne(
      { runId: run.runId },
      {
        $set: {
          'snapshot.marketRegime': label.marketRegime,
          'snapshot.volRegime': label.volRegime,
          'snapshot.regimeConfidence': label.confidence,
          'snapshot.regimeSignals': label.signals,
        },
      }
    );

    updated++;
  }

  return { ok: true, updated };
}
