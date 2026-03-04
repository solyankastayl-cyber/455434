/**
 * BLOCK 1.5.2 — Alt ML Dataset Builder
 * ======================================
 * Builds training dataset from observations + outcomes.
 */

import type { Db } from 'mongodb';
import type { AltMlSample } from './altml.types.js';
import { normalizeVector, FEATURE_NAMES } from '../pattern.space.js';
import { altFeatureBuilder } from '../alt.feature.builder.js';
import type { IndicatorVector } from '../../../exchange-alt/types.js';

const WINNER_THRESHOLD = 0.10;  // 10% = winner

export interface DatasetParams {
  symbols: string[];
  horizon: '1h' | '4h' | '24h';
  fromTs: number;
  toTs: number;
  minSamples?: number;
}

export class AltMlDatasetBuilder {
  /**
   * Build dataset from exchange-alt observations + outcomes
   */
  async buildDataset(db: Db, params: DatasetParams): Promise<AltMlSample[]> {
    const { symbols, horizon, fromTs, toTs } = params;
    const samples: AltMlSample[] = [];

    // Get observations collection
    // This connects to existing exchange-alt data
    const snapshotCol = db.collection('cluster_learning_snapshots');
    const outcomeCol = db.collection('cluster_outcomes');

    for (const symbol of symbols) {
      // Get snapshots for this symbol
      const snapshots = await snapshotCol
        .find({
          ts: { $gte: fromTs, $lte: toTs },
          'opportunities.symbol': symbol,
        })
        .sort({ ts: 1 })
        .toArray();

      for (const snapshot of snapshots) {
        // Find the opportunity for this symbol
        const opp = snapshot.opportunities?.find((o: any) => o.symbol === symbol);
        if (!opp?.vector) continue;

        // Get outcome for this timestamp + horizon
        const outcome = await outcomeCol.findOne({
          symbol,
          baseTs: { $gte: snapshot.ts - 60000, $lte: snapshot.ts + 60000 },
          horizon,
        });

        if (!outcome) continue;

        // Build feature vector from IndicatorVector
        const iv = opp.vector as IndicatorVector;
        const afv = await altFeatureBuilder.buildFromIndicatorVector(iv);
        const features = normalizeVector(afv);

        const futureReturn = outcome.returnPct ?? 0;
        const label: 0 | 1 = futureReturn >= WINNER_THRESHOLD ? 1 : 0;

        samples.push({
          symbol,
          ts: snapshot.ts,
          horizon,
          features,
          label,
          futureReturn,
          fundingLabel: afv.fundingLabel,
        });
      }
    }

    console.log(`[AltMlDataset] Built ${samples.length} samples for ${horizon}`);
    return samples;
  }

  /**
   * Get dataset statistics
   */
  getStats(samples: AltMlSample[]): {
    total: number;
    winners: number;
    losers: number;
    winRate: number;
    avgReturn: number;
    byFunding: Record<string, number>;
  } {
    const winners = samples.filter(s => s.label === 1).length;
    const avgReturn = samples.length > 0
      ? samples.reduce((sum, s) => sum + s.futureReturn, 0) / samples.length
      : 0;

    const byFunding: Record<string, number> = {};
    for (const s of samples) {
      byFunding[s.fundingLabel] = (byFunding[s.fundingLabel] ?? 0) + 1;
    }

    return {
      total: samples.length,
      winners,
      losers: samples.length - winners,
      winRate: samples.length > 0 ? winners / samples.length : 0,
      avgReturn,
      byFunding,
    };
  }
}

export const altMlDatasetBuilder = new AltMlDatasetBuilder();

console.log('[Screener ML] Dataset Builder loaded');
