/**
 * PHASE 2.2 — Data Quality Service
 * =================================
 * Assess data completeness and quality per symbol
 */

import { DataQualityDto, DataMode } from '../contracts/observability.types.js';
import { marketCache } from '../../exchange/cache/market.cache.js';
import { buildGuardInput, evaluateExchangeSLA } from '../../exchange/freeze/exchange.guard.service.js';

// Default symbols to track
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];

class DataQualityService {
  
  async qualityForSymbol(symbol: string): Promise<DataQualityDto> {
    const now = Date.now();
    const ts = new Date().toISOString();
    
    // Get cache status
    const cacheStatus = marketCache.getStatus(symbol);
    
    // Build guard input from cache status
    const guardInput = buildGuardInput({
      dataMode: cacheStatus.dataMode as DataMode || 'MOCK',
      providersUsed: cacheStatus.providersUsed || [],
      missing: cacheStatus.missing || [],
      timestamp: cacheStatus.candlesLastTs || now,
    });
    
    // Evaluate SLA
    const { sla } = evaluateExchangeSLA(guardInput);
    
    return {
      symbol,
      ts,
      dataMode: sla.dataMode,
      completeness: sla.completenessScore,
      staleMs: sla.stalenessMs,
      missingFields: sla.missingCritical,
      downgradeReasons: sla.reasons,
      providersUsed: cacheStatus.providersUsed || [],
    };
  }
  
  async qualityList(symbols?: string[]): Promise<{ ts: string; items: DataQualityDto[] }> {
    const symbolsToCheck = symbols ?? DEFAULT_SYMBOLS;
    const items: DataQualityDto[] = [];
    
    for (const symbol of symbolsToCheck) {
      try {
        const quality = await this.qualityForSymbol(symbol);
        items.push(quality);
      } catch (err: any) {
        items.push({
          symbol,
          ts: new Date().toISOString(),
          dataMode: 'MOCK',
          completeness: 0,
          staleMs: 999999,
          missingFields: ['ERROR'],
          downgradeReasons: [err.message],
          providersUsed: [],
        });
      }
    }
    
    // Sort worst first (by completeness ASC, then staleMs DESC)
    items.sort((a, b) => (a.completeness - b.completeness) || (b.staleMs - a.staleMs));
    
    return {
      ts: new Date().toISOString(),
      items,
    };
  }
  
  async summary(): Promise<{
    ts: string;
    avgCompleteness: number;
    liveCount: number;
    mixedCount: number;
    mockCount: number;
    totalSymbols: number;
  }> {
    const { items } = await this.qualityList();
    
    let totalCompleteness = 0;
    let liveCount = 0;
    let mixedCount = 0;
    let mockCount = 0;
    
    for (const item of items) {
      totalCompleteness += item.completeness;
      if (item.dataMode === 'LIVE') liveCount++;
      else if (item.dataMode === 'MIXED') mixedCount++;
      else mockCount++;
    }
    
    return {
      ts: new Date().toISOString(),
      avgCompleteness: items.length > 0 ? totalCompleteness / items.length : 0,
      liveCount,
      mixedCount,
      mockCount,
      totalSymbols: items.length,
    };
  }
}

export const dataQualityService = new DataQualityService();

console.log('[Phase 2.2] Data Quality Service loaded');
