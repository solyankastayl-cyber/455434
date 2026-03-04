/**
 * BLOCK 2.8 — Funding Aggregator Service
 * =======================================
 * Aggregates funding rates across venues into unified signals.
 */

import type { Db, Collection } from 'mongodb';
import type { FundingObservation, FundingState, FundingVenueType } from '../db/funding_observation.model.js';

const LOOKBACK_30D_MS = 30 * 24 * 3600_000;

function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export class FundingAggregatorService {
  private col: Collection<FundingObservation> | null = null;
  private historyCol: Collection<any> | null = null;

  init(db: Db) {
    this.col = db.collection<FundingObservation>('funding_observations');
    this.historyCol = db.collection('funding_history_stats');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.col) return;
    try {
      await this.col.createIndex({ symbol: 1, ts: -1 });
      await this.col.createIndex({ venue: 1, ts: -1 });
      await this.col.createIndex({ ts: -1 });
    } catch (e) {
      console.warn('[FundingAggregator] Index error:', e);
    }
  }

  /**
   * Save funding observation
   */
  async saveObservation(obs: Omit<FundingObservation, '_id' | 'createdAt'>): Promise<void> {
    if (!this.col) return;
    await this.col.insertOne({
      ...obs,
      createdAt: new Date(),
    });
  }

  /**
   * Get latest observations for a symbol across venues
   */
  async getLatestForSymbol(symbol: string): Promise<FundingObservation[]> {
    if (!this.col) return [];

    const venues: FundingVenueType[] = ['binance', 'bybit', 'hyperliquid'];
    const results: FundingObservation[] = [];

    for (const venue of venues) {
      const obs = await this.col
        .find({ symbol, venue })
        .sort({ ts: -1 })
        .limit(1)
        .toArray();
      if (obs.length > 0) {
        results.push(obs[0]);
      }
    }

    return results;
  }

  /**
   * Compute aggregated funding state for a symbol
   */
  async computeFundingState(symbol: string): Promise<FundingState | null> {
    const observations = await this.getLatestForSymbol(symbol);

    if (observations.length === 0) {
      return null;
    }

    const rates = observations.map(o => o.annualized);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const max = Math.max(...rates);
    const min = Math.min(...rates);
    const dispersion = computeStdDev(rates);

    // Find dominant venue (highest absolute rate)
    let dominantVenue = observations[0].venue;
    let maxAbsRate = Math.abs(observations[0].annualized);
    for (const obs of observations) {
      if (Math.abs(obs.annualized) > maxAbsRate) {
        maxAbsRate = Math.abs(obs.annualized);
        dominantVenue = obs.venue;
      }
    }

    // Compute z-score against 30d history
    const zScore = await this.computeZScore(symbol, mean);

    return {
      mean,
      max,
      min,
      dispersion,
      dominantVenue,
      zScore,
    };
  }

  /**
   * Compute z-score against historical mean
   */
  private async computeZScore(symbol: string, currentMean: number): Promise<number> {
    if (!this.col) return 0;

    const from = new Date(Date.now() - LOOKBACK_30D_MS);

    const history = await this.col
      .find({ symbol, ts: { $gte: from } })
      .sort({ ts: -1 })
      .limit(1000)
      .toArray();

    if (history.length < 10) return 0;

    const historicalRates = history.map(o => o.annualized);
    const histMean = historicalRates.reduce((a, b) => a + b, 0) / historicalRates.length;
    const histStd = computeStdDev(historicalRates);

    if (histStd < 0.001) return 0;

    return (currentMean - histMean) / histStd;
  }

  /**
   * Get funding features for feature vector
   */
  async getFundingFeatures(symbol: string): Promise<{
    funding_mean: number | null;
    funding_z: number | null;
    funding_dispersion: number | null;
    funding_max: number | null;
    funding_min: number | null;
  }> {
    const state = await this.computeFundingState(symbol);

    if (!state) {
      return {
        funding_mean: null,
        funding_z: null,
        funding_dispersion: null,
        funding_max: null,
        funding_min: null,
      };
    }

    return {
      funding_mean: state.mean,
      funding_z: state.zScore,
      funding_dispersion: state.dispersion,
      funding_max: state.max,
      funding_min: state.min,
    };
  }

  /**
   * Batch fetch funding states for multiple symbols
   */
  async getFundingStatesForSymbols(symbols: string[]): Promise<Map<string, FundingState>> {
    const results = new Map<string, FundingState>();

    for (const symbol of symbols) {
      const state = await this.computeFundingState(symbol);
      if (state) {
        results.set(symbol, state);
      }
    }

    return results;
  }

  /**
   * Get funding interpretation
   */
  interpretFundingState(state: FundingState): {
    label: string;
    description: string;
    risk: 'LOW' | 'MEDIUM' | 'HIGH';
  } {
    const z = state.zScore;

    if (z > 1.5) {
      return {
        label: 'CROWD_LONG',
        description: 'Market crowded long - squeeze down risk',
        risk: 'HIGH',
      };
    }
    if (z < -1.5) {
      return {
        label: 'CROWD_SHORT',
        description: 'Market crowded short - squeeze up possible',
        risk: 'HIGH',
      };
    }
    if (state.dispersion > 0.1) {
      return {
        label: 'DIVERGENT',
        description: 'Venues disagree - noisy signal',
        risk: 'MEDIUM',
      };
    }
    return {
      label: 'NEUTRAL',
      description: 'Funding neutral',
      risk: 'LOW',
    };
  }
}

export const fundingAggregatorService = new FundingAggregatorService();

console.log('[Funding] Aggregator Service loaded');
