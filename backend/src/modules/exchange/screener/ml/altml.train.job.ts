/**
 * BLOCK 1.5.6 — Alt ML Train Job
 * ================================
 * Background job for model training.
 */

import type { Db } from 'mongodb';
import { altMlDatasetBuilder, type DatasetParams } from './altml.dataset.builder.js';
import { trainLogReg, evaluateModel } from './altml.trainer.js';
import { AltMlModelStore } from './altml.model.store.js';
import type { AltMlModel } from './altml.types.js';

export interface TrainJobResult {
  ok: boolean;
  model?: {
    version: string;
    accuracy: number;
    trainingSamples: number;
  };
  error?: string;
  stats?: {
    total: number;
    winners: number;
    winRate: number;
  };
}

/**
 * Run training job for a specific horizon
 */
export async function runAltMlTrainJob(
  db: Db,
  params: DatasetParams
): Promise<TrainJobResult> {
  console.log(`[AltMlTrainJob] Starting for horizon=${params.horizon}`);

  try {
    // Build dataset
    const samples = await altMlDatasetBuilder.buildDataset(db, params);
    const stats = altMlDatasetBuilder.getStats(samples);

    if (samples.length < (params.minSamples ?? 50)) {
      return {
        ok: false,
        error: `Insufficient samples: ${samples.length}`,
        stats,
      };
    }

    // Train model
    const model = trainLogReg(samples, {
      epochs: 60,
      learningRate: 0.1,
      l2Reg: 0.001,
    });

    // Save model
    const store = new AltMlModelStore(db);
    await store.save(model);

    // Cleanup old models
    await store.cleanup(5);

    console.log(`[AltMlTrainJob] Complete: ${model.version}, accuracy=${model.accuracy}`);

    return {
      ok: true,
      model: {
        version: model.version,
        accuracy: model.accuracy,
        trainingSamples: model.trainingSamples,
      },
      stats,
    };
  } catch (error: any) {
    console.error('[AltMlTrainJob] Error:', error);
    return {
      ok: false,
      error: error.message,
    };
  }
}

/**
 * Run training for all horizons
 */
export async function runFullTraining(
  db: Db,
  symbols: string[],
  daysBack = 30
): Promise<Record<string, TrainJobResult>> {
  const results: Record<string, TrainJobResult> = {};
  const toTs = Date.now();
  const fromTs = toTs - daysBack * 24 * 60 * 60 * 1000;

  for (const horizon of ['1h', '4h', '24h'] as const) {
    results[horizon] = await runAltMlTrainJob(db, {
      symbols,
      horizon,
      fromTs,
      toTs,
    });
  }

  return results;
}

console.log('[Screener ML] Train Job loaded');
