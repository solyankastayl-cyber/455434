/**
 * BLOCK 2.9 — Sector State Service
 * =================================
 * Computes sector rotation scores and states.
 * 
 * FIXED: Uses normalized scoring based on score_up values and price momentum
 * to provide meaningful differentiation between sectors.
 */

import type { Db, Collection } from 'mongodb';
import type { Sector, SectorState } from '../types/sector.types.js';
import { assetTagsStore } from '../db/asset_tags.model.js';

function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// Normalize value to 0-1 range
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return clamp01((value - min) / (max - min));
}

export interface FeatureSnapshot {
  symbolKey: string;
  symbol?: string;
  base?: string;
  features: Record<string, number | null>;
  price: number;
  priceChg1h?: number;
  priceChg24h?: number;
}

export class SectorStateService {
  private snapshotCol: Collection<FeatureSnapshot> | null = null;

  init(db: Db) {
    this.snapshotCol = db.collection<FeatureSnapshot>('exchange_symbol_snapshots');
  }

  /**
   * Compute state for a single sector
   * 
   * Uses multiple signals:
   * - score_up: ML bullish signal (0-1)
   * - priceChg24h: 24h price momentum
   * - funding_z: Funding rate z-score for squeeze risk
   * - volume/OI metrics if available
   */
  async computeSectorState(sector: Sector, window: '4h' | '24h' = '4h'): Promise<SectorState | null> {
    const symbols = await assetTagsStore.getSymbolsBySector(sector);
    if (symbols.length === 0) return null;

    // Get snapshots for these symbols
    const snapshots = await this.getLatestSnapshots(symbols);
    if (snapshots.length === 0) return null;

    // Compute metrics using multiple signals
    const scores: number[] = [];
    const priceChanges: number[] = [];
    const topSymbols: Array<{ symbol: string; score: number; priceChg?: number }> = [];

    for (const snap of snapshots) {
      // Use score_up directly as it's the bullish signal (0-1 range)
      const scoreUp = Number(snap.features?.score_up ?? 0.5);
      const scoreDown = Number(snap.features?.score_down ?? 0.5);
      
      // Composite score: weight bullish signal higher, penalize bearish
      const compositeScore = scoreUp * 0.7 - scoreDown * 0.3 + 0.3; // shift to 0-1 range
      scores.push(compositeScore);

      // Track price changes for momentum calculation
      const priceChg = snap.priceChg24h ?? 0;
      priceChanges.push(priceChg);

      const symbol = snap.base ?? snap.symbolKey?.split(':')[0] ?? 'UNKNOWN';
      topSymbols.push({ symbol, score: compositeScore, priceChg });
    }

    // Sort top symbols by composite score
    topSymbols.sort((a, b) => b.score - a.score);

    // === MOMENTUM ===
    // Combine ML score momentum with price momentum
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const avgPriceChg = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
    
    // Normalize price change to -1 to 1 range (assuming -20% to +20% is extreme)
    const normalizedPriceChg = clamp01((avgPriceChg + 20) / 40);
    
    // Combined momentum: ML signals + price action
    const momentum = avgScore * 0.6 + normalizedPriceChg * 0.4;

    // === BREADTH ===
    // Percentage of symbols showing bullish signals (score > 0.5 = bullish)
    const breadth = scores.filter(s => s > 0.55).length / scores.length;

    // === DISPERSION ===
    // Lower is better (cohesive sector move)
    const dispersion = computeStdDev(scores);

    // === SQUEEZE RISK ===
    const fundingZs = snapshots
      .map(s => s.features?.funding_z)
      .filter(z => z != null) as number[];
    const avgFundingZ = fundingZs.length > 0
      ? fundingZs.reduce((a, b) => a + b, 0) / fundingZs.length
      : 0;
    const squeezeRisk = clamp01(Math.abs(avgFundingZ) / 2);

    // === ROTATION SCORE ===
    // Weighted formula for final sector ranking
    // Higher momentum + higher breadth + lower dispersion + lower squeeze = better
    const rotationScore = clamp01(
      0.40 * momentum +           // 40% weight on momentum
      0.30 * breadth +            // 30% weight on breadth
      0.20 * (1 - dispersion) +   // 20% weight on cohesion (low dispersion)
      0.10 * (1 - squeezeRisk)    // 10% weight on low squeeze risk
    );

    return {
      ts: new Date(),
      sector,
      symbols: symbols.length,
      momentum,
      breadth,
      squeezeRisk,
      dispersion,
      rotationScore,
      topSymbols: topSymbols.slice(0, 10).map(s => ({ symbol: s.symbol, score: s.score })),
    };
  }

  /**
   * Get all sector states sorted by rotation score
   * 
   * After computing raw scores, normalizes them relative to each other
   * to provide meaningful differentiation in the UI (spread from ~20% to ~80%)
   */
  async getAllSectorStates(window: '4h' | '24h' = '4h'): Promise<SectorState[]> {
    const sectors: Sector[] = [
      'L1', 'L2', 'DEFI', 'AI', 'MEME', 'NFT', 'INFRA',
      'ORACLE', 'GAMING', 'RWA', 'PERPS', 'DEX', 'CEFI'
    ];

    const states: SectorState[] = [];

    for (const sector of sectors) {
      const state = await this.computeSectorState(sector, window);
      if (state && state.symbols > 0) {
        states.push(state);
      }
    }

    if (states.length === 0) return states;

    // Find min/max rotation scores for normalization
    const rawScores = states.map(s => s.rotationScore);
    const minScore = Math.min(...rawScores);
    const maxScore = Math.max(...rawScores);
    const range = maxScore - minScore;

    // Normalize scores to spread across 20% - 85% range for better visual differentiation
    // This preserves relative ordering while making differences visible
    const MIN_DISPLAY = 0.20;
    const MAX_DISPLAY = 0.85;
    const displayRange = MAX_DISPLAY - MIN_DISPLAY;

    for (const state of states) {
      if (range > 0.001) {
        // Normalize to display range
        const normalizedPosition = (state.rotationScore - minScore) / range;
        state.rotationScore = MIN_DISPLAY + normalizedPosition * displayRange;
      } else {
        // All scores are nearly equal - spread them based on position
        const idx = states.indexOf(state);
        state.rotationScore = MIN_DISPLAY + (idx / states.length) * displayRange * 0.5 + 0.25;
      }
    }

    // Sort by rotation score (highest first)
    states.sort((a, b) => b.rotationScore - a.rotationScore);
    return states;
  }

  /**
   * Get latest snapshots for symbols
   */
  private async getLatestSnapshots(symbols: string[]): Promise<FeatureSnapshot[]> {
    if (!this.snapshotCol) return [];

    // Try different formats for symbol matching
    const results: FeatureSnapshot[] = [];

    for (const symbol of symbols) {
      // Remove USDT suffix for base matching
      const base = symbol.replace('USDT', '');

      const snap = await this.snapshotCol
        .find({
          $or: [
            { base },
            { symbolKey: { $regex: `^${base}:` } },
          ]
        })
        .sort({ ts: -1 })
        .limit(1)
        .toArray();

      if (snap.length > 0) {
        results.push(snap[0]);
      }
    }

    return results;
  }
}

export const sectorStateService = new SectorStateService();

console.log('[Sector] State Service loaded');
