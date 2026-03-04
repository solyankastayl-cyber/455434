/**
 * PHASE 2.3 — Truth Analytics Service
 * ====================================
 * Analyze verdict accuracy vs actual price movements
 */

import { TruthAnalyticsDto, SymbolTruthStats } from '../contracts/observability.types.js';

// In-memory truth storage (in production, use MongoDB)
// Format: Map<symbol, TruthRecord[]>
interface TruthRecord {
  t0: number;
  t1: number;
  horizonBars: number;
  price0: number;
  price1: number;
  priceChangePct: number;
  predictedDirection?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  actualDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confirmed: boolean;
  rawConfidence?: number;
  adjustedConfidence?: number;
}

const truthStore = new Map<string, TruthRecord[]>();

class TruthAnalyticsService {
  
  // Record a truth outcome
  recordTruth(record: {
    symbol: string;
    t0: number;
    t1: number;
    horizonBars: number;
    price0: number;
    price1: number;
    predictedDirection?: string;
    rawConfidence?: number;
    adjustedConfidence?: number;
  }): void {
    const priceChangePct = ((record.price1 - record.price0) / record.price0) * 100;
    
    // Determine actual direction
    let actualDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (priceChangePct > 0.5) actualDirection = 'BULLISH';
    else if (priceChangePct < -0.5) actualDirection = 'BEARISH';
    
    // Check if prediction was confirmed
    const predicted = record.predictedDirection?.toUpperCase();
    const confirmed = predicted === actualDirection || 
      (actualDirection === 'NEUTRAL' && predicted === 'NEUTRAL');
    
    const truthRecord: TruthRecord = {
      t0: record.t0,
      t1: record.t1,
      horizonBars: record.horizonBars,
      price0: record.price0,
      price1: record.price1,
      priceChangePct,
      predictedDirection: predicted as any,
      actualDirection,
      confirmed,
      rawConfidence: record.rawConfidence,
      adjustedConfidence: record.adjustedConfidence,
    };
    
    const records = truthStore.get(record.symbol) || [];
    records.push(truthRecord);
    
    // Keep last 2000 records per symbol
    if (records.length > 2000) {
      records.shift();
    }
    
    truthStore.set(record.symbol, records);
  }
  
  // Get stats for a symbol
  statsForSymbol(symbol: string): SymbolTruthStats {
    const records = truthStore.get(symbol) || [];
    
    if (records.length === 0) {
      return {
        symbol,
        confirmedRate: 0,
        divergedRate: 0,
        neutralRate: 0,
        sampleSize: 0,
      };
    }
    
    let confirmed = 0;
    let diverged = 0;
    let neutral = 0;
    let totalRawConf = 0;
    let totalAdjConf = 0;
    let confCount = 0;
    
    for (const r of records) {
      if (r.actualDirection === 'NEUTRAL') {
        neutral++;
      } else if (r.confirmed) {
        confirmed++;
      } else {
        diverged++;
      }
      
      if (r.rawConfidence !== undefined) {
        totalRawConf += r.rawConfidence;
        confCount++;
      }
      if (r.adjustedConfidence !== undefined) {
        totalAdjConf += r.adjustedConfidence;
      }
    }
    
    const n = records.length;
    
    return {
      symbol,
      confirmedRate: confirmed / n,
      divergedRate: diverged / n,
      neutralRate: neutral / n,
      sampleSize: n,
      avgRawConfidence: confCount > 0 ? totalRawConf / confCount : undefined,
      avgAdjustedConfidence: confCount > 0 ? totalAdjConf / confCount : undefined,
    };
  }
  
  // Get overall analytics
  async overall(symbols?: string[]): Promise<TruthAnalyticsDto> {
    const allSymbols = symbols || Array.from(truthStore.keys());
    
    const bySymbol: SymbolTruthStats[] = [];
    let totalConfirmed = 0;
    let totalDiverged = 0;
    let totalNeutral = 0;
    let totalN = 0;
    
    for (const symbol of allSymbols) {
      const stats = this.statsForSymbol(symbol);
      bySymbol.push(stats);
      
      totalN += stats.sampleSize;
      totalConfirmed += stats.confirmedRate * stats.sampleSize;
      totalDiverged += stats.divergedRate * stats.sampleSize;
      totalNeutral += stats.neutralRate * stats.sampleSize;
    }
    
    // Sort by sample size DESC
    bySymbol.sort((a, b) => b.sampleSize - a.sampleSize);
    
    return {
      ts: new Date().toISOString(),
      overall: {
        confirmedRate: totalN > 0 ? totalConfirmed / totalN : 0,
        divergedRate: totalN > 0 ? totalDiverged / totalN : 0,
        neutralRate: totalN > 0 ? totalNeutral / totalN : 0,
        sampleSize: totalN,
      },
      bySymbol,
    };
  }
  
  // Seed with backfill data
  seedFromBackfill(symbol: string, truths: Array<{
    t0: number;
    t1: number;
    horizonBars: number;
    price0: number;
    price1: number;
  }>): void {
    for (const t of truths) {
      this.recordTruth({
        symbol,
        ...t,
      });
    }
    console.log(`[TruthAnalytics] Seeded ${truths.length} records for ${symbol}`);
  }
  
  // Get symbols with data
  getSymbolsWithData(): string[] {
    return Array.from(truthStore.keys());
  }
}

export const truthAnalyticsService = new TruthAnalyticsService();

console.log('[Phase 2.3] Truth Analytics Service loaded');
