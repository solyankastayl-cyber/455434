/**
 * БЛОК 1.2 — Funding Normalizer
 * ==============================
 * 
 * Превращает сырые funding rates с разных бирж в единый нормализованный сигнал:
 * - сопоставимый между биржами
 * - устойчивый к выбросам
 * - пригодный для ML
 */

import type { FundingReadResult, FundingSample, FundingVenue } from './contracts/funding.types.js';
import type { NormalizedFunding } from './contracts/funding.normalized.js';

// Веса бирж (Binance доминирует, HyperLiquid = ранний сигнал)
const VENUE_WEIGHTS: Record<FundingVenue, number> = {
  BINANCE: 0.45,
  BYBIT: 0.30,
  HYPERLIQUID: 0.20,
  COINBASE: 0.05,
};

// Безопасность
const CLAMP_Z = 3;
const EPS = 1e-9;

export class FundingNormalizer {
  /**
   * Нормализует funding rates со всех бирж
   */
  normalize(results: FundingReadResult[]): NormalizedFunding[] {
    const bySymbol = this.groupBySymbol(results);
    return Object.entries(bySymbol).map(([symbol, samples]) =>
      this.normalizeSymbol(symbol, samples)
    );
  }

  /**
   * Нормализует для одного символа (если нужен быстрый lookup)
   */
  normalizeOne(symbol: string, results: FundingReadResult[]): NormalizedFunding {
    const bySymbol = this.groupBySymbol(results);
    const samples = bySymbol[symbol] || [];
    return this.normalizeSymbol(symbol, samples);
  }

  private groupBySymbol(results: FundingReadResult[]): Record<string, FundingSample[]> {
    const map: Record<string, FundingSample[]> = {};

    for (const r of results) {
      for (const s of r.samples) {
        if (!map[s.symbol]) map[s.symbol] = [];
        map[s.symbol].push(s);
      }
    }

    return map;
  }

  private normalizeSymbol(symbol: string, samples: FundingSample[]): NormalizedFunding {
    const ts = Date.now();

    if (samples.length === 0) {
      return {
        symbol,
        ts,
        fundingScore: 0,
        raw: [],
        dispersion: 0,
        confidence: 0,
      };
    }

    const rates = samples.map(s => s.fundingRate);
    const mean = this.avg(rates);
    const std = this.stddev(rates, mean);

    let weightedSum = 0;
    let weightSum = 0;

    const raw = samples.map(s => {
      // Z-score с clamp
      const z = this.clamp((s.fundingRate - mean) / (std + EPS), -CLAMP_Z, CLAMP_Z);
      const w = VENUE_WEIGHTS[s.venue] ?? 0.1;

      weightedSum += z * w;
      weightSum += w;

      return {
        venue: s.venue,
        fundingRate: s.fundingRate,
        zScore: z,
        weight: w,
      };
    });

    // Финальный score [-1, 1]
    const fundingScore = this.clamp(weightedSum / (weightSum + EPS), -1, 1);

    return {
      symbol,
      ts,
      fundingScore,
      raw,
      dispersion: std,
      confidence: this.clamp(weightSum, 0, 1),
    };
  }

  private avg(xs: number[]): number {
    if (xs.length === 0) return 0;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  private stddev(xs: number[], mean: number): number {
    if (xs.length === 0) return 0;
    const v = xs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / xs.length;
    return Math.sqrt(v);
  }

  private clamp(x: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, x));
  }
}

export const fundingNormalizer = new FundingNormalizer();

console.log('[Funding] Normalizer loaded');
