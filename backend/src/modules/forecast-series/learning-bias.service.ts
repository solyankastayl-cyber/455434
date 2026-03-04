/**
 * LEARNING BIAS SERVICE V3.11
 * ===========================
 * 
 * Calculates bias from 7D outcomes to influence 30D/1D trajectories.
 * 
 * bias = average(realClose - predictedTarget) / predictedTarget
 * Positive bias: model underestimates moves
 * Negative bias: model overestimates moves
 */

import type { Db } from 'mongodb';

export type BiasResult = {
  bias7d: number;        // signed, e.g. -0.12 means model overestimates
  samples: number;
  lastResolvedAt?: string;
};

export class LearningBiasService {
  private db: Db;
  private collectionName = 'forecast_snapshots';

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Get bias from 7D resolved outcomes
   * @param symbol - Symbol (BTC, ETH, etc)
   * @param layer - Layer (forecast, exchange)
   * @param lookbackDays - How many days to look back (default 45)
   */
  async get7dBias(params: { 
    symbol: string; 
    layer: string; 
    lookbackDays?: number 
  }): Promise<BiasResult> {
    const { symbol, layer, lookbackDays = 45 } = params;

    try {
      const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

      const docs = await this.db
        .collection(this.collectionName)
        .find({
          symbol,
          layer,
          horizon: '7D',
          'evaluation.status': { $in: ['WIN', 'LOSS'] }, // resolved outcomes
          'evaluation.resolvedAt': { $gte: since },
        })
        .sort({ 'evaluation.resolvedAt': -1 })
        .limit(80)
        .toArray();

      if (!docs.length) {
        return { bias7d: 0, samples: 0 };
      }

      let sum = 0;
      let n = 0;

      for (const d of docs) {
        const predictedTarget = d.targetPrice;
        const realClose = d.evaluation?.realPrice;
        
        if (!predictedTarget || !realClose || predictedTarget === 0) continue;

        // Error: how much we missed by (signed)
        const err = (realClose - predictedTarget) / predictedTarget;
        
        // Clamp to prevent outliers from dominating
        const clamped = Math.max(-0.25, Math.min(0.25, err));
        sum += clamped;
        n += 1;
      }

      const lastResolvedAt = docs[0]?.evaluation?.resolvedAt?.toISOString?.() 
        ?? docs[0]?.evaluation?.resolvedAt?.toString?.() 
        ?? undefined;

      return {
        bias7d: n ? sum / n : 0,
        samples: n,
        lastResolvedAt,
      };
    } catch (err: any) {
      console.error(`[LearningBias] Error fetching bias: ${err.message}`);
      return { bias7d: 0, samples: 0 };
    }
  }
}

// Singleton factory
let instance: LearningBiasService | null = null;

export function getLearningBiasService(db: Db): LearningBiasService {
  if (!instance) {
    instance = new LearningBiasService(db);
  }
  return instance;
}

console.log('[LearningBiasService] Module loaded (V3.11)');
