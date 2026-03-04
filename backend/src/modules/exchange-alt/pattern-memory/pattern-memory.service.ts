/**
 * BLOCK 23 — Pattern Performance Memory Service
 * ==============================================
 * 
 * Tracks and stores pattern effectiveness over time.
 */

import type { Venue, Horizon } from '../types.js';
import type {
  PatternPerformanceRecord,
  PatternOutcomeRecord,
  PPMQuery,
  PPMStats,
} from './pattern-memory.types.js';
import {
  calculateExpectancy,
  classifyReturn,
  createEmptyRecord,
} from './pattern-memory.types.js';
import { v4 as uuidv4 } from 'uuid';

// ═══════════════════════════════════════════════════════════════
// PATTERN PERFORMANCE MEMORY SERVICE
// ═══════════════════════════════════════════════════════════════

export class PatternMemoryService {
  private records: Map<string, PatternPerformanceRecord> = new Map();
  private outcomes: PatternOutcomeRecord[] = [];
  private maxOutcomes = 10000;

  /**
   * Record an outcome for a pattern
   */
  recordOutcome(
    patternId: string,
    patternLabel: string,
    symbol: string,
    venue: Venue,
    entryPrice: number,
    exitPrice: number,
    direction: 'UP' | 'DOWN',
    horizon: Horizon,
    confidence: number,
    regime: string,
    sector: string
  ): PatternOutcomeRecord {
    const returnPct = direction === 'UP'
      ? ((exitPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - exitPrice) / entryPrice) * 100;

    const outcome: PatternOutcomeRecord = {
      id: uuidv4(),
      patternId,
      symbol,
      venue,
      entryTime: Date.now() - this.horizonToMs(horizon),
      entryPrice,
      direction,
      confidence,
      regime,
      sector,
      horizon,
      exitTime: Date.now(),
      exitPrice,
      returnPct,
      result: classifyReturn(returnPct),
      createdAt: Date.now(),
    };

    // Store outcome
    this.outcomes.push(outcome);
    if (this.outcomes.length > this.maxOutcomes) {
      this.outcomes = this.outcomes.slice(-this.maxOutcomes / 2);
    }

    // Update pattern record
    this.updatePatternRecord(patternId, patternLabel, venue, outcome);

    return outcome;
  }

  /**
   * Update pattern performance record
   */
  private updatePatternRecord(
    patternId: string,
    patternLabel: string,
    venue: Venue,
    outcome: PatternOutcomeRecord
  ): void {
    let record = this.records.get(patternId);
    
    if (!record) {
      record = createEmptyRecord(patternId, patternLabel, venue);
      this.records.set(patternId, record);
    }

    // Update counts
    record.totalTrades++;
    if (outcome.result === 'WIN') record.wins++;
    else if (outcome.result === 'LOSS') record.losses++;
    else record.neutral++;

    // Update hit rate
    record.hitRate = record.wins / record.totalTrades;

    // Update returns
    const allReturns = this.getPatternReturns(patternId);
    record.avgReturn = allReturns.reduce((a, b) => a + b, 0) / allReturns.length;
    record.medianReturn = this.median(allReturns);
    record.maxReturn = Math.max(...allReturns, record.maxReturn);
    record.maxLoss = Math.min(...allReturns, record.maxLoss);

    // Update expectancy
    const wins = allReturns.filter(r => r >= 2);
    const losses = allReturns.filter(r => r <= -2);
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
    record.expectancy = calculateExpectancy(record.hitRate, avgWin, avgLoss);

    // Update sharpe (simplified)
    const stdDev = this.stdDev(allReturns);
    record.sharpe = stdDev > 0 ? record.avgReturn / stdDev : 0;

    // Update by horizon
    const horizonOutcomes = this.outcomes.filter(
      o => o.patternId === patternId && o.horizon === outcome.horizon
    );
    const horizonReturns = horizonOutcomes.map(o => o.returnPct);
    const horizonWins = horizonOutcomes.filter(o => o.result === 'WIN').length;
    
    record.byHorizon[outcome.horizon] = {
      hitRate: horizonOutcomes.length > 0 ? horizonWins / horizonOutcomes.length : 0,
      avgReturn: horizonReturns.length > 0 
        ? horizonReturns.reduce((a, b) => a + b, 0) / horizonReturns.length 
        : 0,
      samples: horizonOutcomes.length,
    };

    // Update recent 7d
    const recent = this.outcomes.filter(
      o => o.patternId === patternId && 
           o.createdAt > Date.now() - 7 * 24 * 60 * 60 * 1000
    );
    const recentWins = recent.filter(o => o.result === 'WIN').length;
    const recentReturns = recent.map(o => o.returnPct);
    
    record.recent7d = {
      hitRate: recent.length > 0 ? recentWins / recent.length : 0,
      avgReturn: recentReturns.length > 0
        ? recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length
        : 0,
      trades: recent.length,
    };

    // Update by regime
    if (!record.byRegime[outcome.regime]) {
      record.byRegime[outcome.regime] = { hitRate: 0, avgReturn: 0, samples: 0 };
    }
    const regimeOutcomes = this.outcomes.filter(
      o => o.patternId === patternId && o.regime === outcome.regime
    );
    const regimeWins = regimeOutcomes.filter(o => o.result === 'WIN').length;
    const regimeReturns = regimeOutcomes.map(o => o.returnPct);
    
    record.byRegime[outcome.regime] = {
      hitRate: regimeOutcomes.length > 0 ? regimeWins / regimeOutcomes.length : 0,
      avgReturn: regimeReturns.length > 0
        ? regimeReturns.reduce((a, b) => a + b, 0) / regimeReturns.length
        : 0,
      samples: regimeOutcomes.length,
    };

    // Update by sector
    if (!record.bySector[outcome.sector]) {
      record.bySector[outcome.sector] = { hitRate: 0, avgReturn: 0, samples: 0 };
    }
    const sectorOutcomes = this.outcomes.filter(
      o => o.patternId === patternId && o.sector === outcome.sector
    );
    const sectorWins = sectorOutcomes.filter(o => o.result === 'WIN').length;
    const sectorReturns = sectorOutcomes.map(o => o.returnPct);
    
    record.bySector[outcome.sector] = {
      hitRate: sectorOutcomes.length > 0 ? sectorWins / sectorOutcomes.length : 0,
      avgReturn: sectorReturns.length > 0
        ? sectorReturns.reduce((a, b) => a + b, 0) / sectorReturns.length
        : 0,
      samples: sectorOutcomes.length,
    };

    // Update timestamps
    record.lastSeen = Date.now();
    record.lastUpdated = Date.now();
  }

  /**
   * Get pattern record
   */
  getRecord(patternId: string): PatternPerformanceRecord | null {
    return this.records.get(patternId) ?? null;
  }

  /**
   * Query patterns
   */
  query(q: PPMQuery): PatternPerformanceRecord[] {
    let results = Array.from(this.records.values());

    if (q.patternIds) {
      results = results.filter(r => q.patternIds!.includes(r.patternId));
    }
    if (q.venue) {
      results = results.filter(r => r.venue === q.venue);
    }
    if (q.minTrades) {
      results = results.filter(r => r.totalTrades >= q.minTrades!);
    }
    if (q.minHitRate) {
      results = results.filter(r => r.hitRate >= q.minHitRate!);
    }
    if (q.since) {
      results = results.filter(r => r.lastSeen >= q.since!);
    }
    if (q.regime) {
      results = results.filter(r => r.byRegime[q.regime!]?.samples > 0);
    }
    if (q.sector) {
      results = results.filter(r => r.bySector[q.sector!]?.samples > 0);
    }
    if (q.horizon) {
      results = results.filter(r => r.byHorizon[q.horizon!]?.samples > 0);
    }

    return results;
  }

  /**
   * Get overall stats
   */
  getStats(): PPMStats {
    const records = Array.from(this.records.values());
    const recent = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const active = records.filter(r => r.lastSeen >= recent);

    const avgHitRate = records.length > 0
      ? records.reduce((sum, r) => sum + r.hitRate, 0) / records.length
      : 0;

    const avgExpectancy = records.length > 0
      ? records.reduce((sum, r) => sum + r.expectancy, 0) / records.length
      : 0;

    // Top patterns (min 10 trades)
    const qualified = records.filter(r => r.totalTrades >= 10);
    qualified.sort((a, b) => b.hitRate - a.hitRate);

    const topPatterns = qualified.slice(0, 5).map(r => ({
      patternId: r.patternId,
      label: r.patternLabel,
      hitRate: r.hitRate,
      trades: r.totalTrades,
    }));

    const worstPatterns = [...qualified]
      .sort((a, b) => a.hitRate - b.hitRate)
      .slice(0, 5)
      .map(r => ({
        patternId: r.patternId,
        label: r.patternLabel,
        hitRate: r.hitRate,
        trades: r.totalTrades,
      }));

    return {
      totalPatterns: records.length,
      activePatterns: active.length,
      avgHitRate,
      avgExpectancy,
      totalOutcomes: this.outcomes.length,
      topPatterns,
      worstPatterns,
    };
  }

  /**
   * Get pattern performance for a specific regime
   */
  getRegimePerformance(
    patternId: string,
    regime: string
  ): { hitRate: number; avgReturn: number; samples: number } | null {
    const record = this.records.get(patternId);
    return record?.byRegime[regime] ?? null;
  }

  /**
   * Get pattern performance for a specific sector
   */
  getSectorPerformance(
    patternId: string,
    sector: string
  ): { hitRate: number; avgReturn: number; samples: number } | null {
    const record = this.records.get(patternId);
    return record?.bySector[sector] ?? null;
  }

  /**
   * Get all records
   */
  getAllRecords(): PatternPerformanceRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * Get recent outcomes
   */
  getRecentOutcomes(limit: number = 100): PatternOutcomeRecord[] {
    return this.outcomes.slice(-limit);
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private getPatternReturns(patternId: string): number[] {
    return this.outcomes
      .filter(o => o.patternId === patternId)
      .map(o => o.returnPct);
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private stdDev(arr: number[]): number {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sqDiffs = arr.map(x => Math.pow(x - mean, 2));
    return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / arr.length);
  }

  private horizonToMs(horizon: Horizon): number {
    switch (horizon) {
      case '1h': return 60 * 60 * 1000;
      case '4h': return 4 * 60 * 60 * 1000;
      case '24h': return 24 * 60 * 60 * 1000;
    }
  }
}

export const patternMemoryService = new PatternMemoryService();

console.log('[Block23] Pattern Performance Memory Service loaded');
