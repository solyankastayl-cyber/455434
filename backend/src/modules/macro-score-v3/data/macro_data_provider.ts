/**
 * MACRO DATA PROVIDER
 * 
 * Abstraction layer for macro series data access.
 * Supports both mock and MongoDB data sources.
 * 
 * Key principle: Backtest/MacroScore don't know where data comes from.
 * This enables:
 * - Clean mock → mongo switch via MACRO_DATA_MODE
 * - Same API for both sources
 * - NoLookahead guarantee in both modes
 */

import { Db } from 'mongodb';
import { SeriesData } from '../macro_score.service.js';
import { MacroSeriesRepo, MacroSeriesPoint } from '../repos/macro_series.repo.js';
import { generateAllMockSeries } from '../macro_score.audit.js';
import { SERIES_CONFIG } from '../macro_score.contract.js';

// ═══════════════════════════════════════════════════════════════
// CONTRACTS
// ═══════════════════════════════════════════════════════════════

export type DataMode = 'mock' | 'mongo';

export interface DataProviderMeta {
  dataMode: DataMode;
  missingSeries: string[];
  availableSeries: string[];
  coveragePct: number;
  timestamp: string;
}

export interface MacroDataResult {
  seriesData: SeriesData[];
  meta: DataProviderMeta;
}

export interface MultiSeriesRequest {
  seriesIds: string[];
  asOf: Date;
  windowDays: number;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function getDataMode(): DataMode {
  const mode = process.env.MACRO_DATA_MODE || 'mock';
  return mode === 'mongo' ? 'mongo' : 'mock';
}

// ═══════════════════════════════════════════════════════════════
// MOCK DATA PROVIDER
// ═══════════════════════════════════════════════════════════════

function getMockData(): MacroDataResult {
  const seriesData = generateAllMockSeries();
  const seriesIds = SERIES_CONFIG.map(s => s.key);
  const availableSeries = seriesData.map(s => s.key);
  const missingSeries = seriesIds.filter(id => !availableSeries.includes(id));
  
  return {
    seriesData,
    meta: {
      dataMode: 'mock',
      missingSeries,
      availableSeries,
      coveragePct: availableSeries.length / seriesIds.length,
      timestamp: new Date().toISOString(),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// MONGODB DATA PROVIDER
// ═══════════════════════════════════════════════════════════════

async function getMongoData(
  db: Db,
  asOf: string,
  windowDays: number = 365
): Promise<MacroDataResult> {
  const repo = new MacroSeriesRepo(db);
  const asOfDate = new Date(asOf);
  const seriesIds = SERIES_CONFIG.map(s => s.key);
  
  const seriesData: SeriesData[] = [];
  const availableSeries: string[] = [];
  const missingSeries: string[] = [];
  
  for (const seriesId of seriesIds) {
    try {
      // Use release-time safe query (releasedAt <= asOf)
      const points = await repo.getWindow(seriesId, asOfDate, windowDays);
      
      if (points.length > 0) {
        seriesData.push({
          key: seriesId,
          data: points.map(p => ({
            date: p.periodEnd.toISOString().slice(0, 10),
            value: p.value,
          })),
        });
        availableSeries.push(seriesId);
      } else {
        missingSeries.push(seriesId);
      }
    } catch (e) {
      console.warn(`[MacroDataProvider] Failed to fetch ${seriesId}:`, e);
      missingSeries.push(seriesId);
    }
  }
  
  return {
    seriesData,
    meta: {
      dataMode: 'mongo',
      missingSeries,
      availableSeries,
      coveragePct: availableSeries.length / seriesIds.length,
      timestamp: new Date().toISOString(),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN PROVIDER CLASS
// ═══════════════════════════════════════════════════════════════

export class MacroDataProvider {
  private db: Db | null = null;
  
  constructor(db?: Db) {
    this.db = db || null;
  }
  
  /**
   * Get macro series data for a specific asOf date
   * 
   * @param asOf - Date string (YYYY-MM-DD)
   * @param options - Configuration options
   * @returns MacroDataResult with seriesData and meta
   */
  async getData(
    asOf: string,
    options: {
      dataMode?: DataMode;
      windowDays?: number;
    } = {}
  ): Promise<MacroDataResult> {
    const mode = options.dataMode || getDataMode();
    const windowDays = options.windowDays || 365;
    
    if (mode === 'mongo') {
      if (!this.db) {
        console.warn('[MacroDataProvider] MongoDB not configured, falling back to mock');
        return getMockData();
      }
      return getMongoData(this.db, asOf, windowDays);
    }
    
    return getMockData();
  }
  
  /**
   * Get latest value for a series as of a specific date
   * NoLookahead safe: uses releasedAt <= asOf
   */
  async getLatestAsOf(
    seriesId: string,
    asOf: string
  ): Promise<MacroSeriesPoint | null> {
    const mode = getDataMode();
    
    if (mode === 'mongo' && this.db) {
      const repo = new MacroSeriesRepo(this.db);
      return repo.getLatestAvailableValue(seriesId, new Date(asOf));
    }
    
    // Mock fallback: return last point from mock data
    const mockData = generateAllMockSeries();
    const series = mockData.find(s => s.key === seriesId);
    if (!series || series.data.length === 0) return null;
    
    const lastPoint = series.data[series.data.length - 1];
    return {
      seriesId,
      periodEnd: new Date(lastPoint.date),
      value: lastPoint.value,
      releasedAt: new Date(lastPoint.date), // Mock: assume same as periodEnd
    };
  }
  
  /**
   * Get series window as of a specific date
   * NoLookahead safe: uses releasedAt <= asOf
   */
  async getSeriesWindow(
    seriesId: string,
    asOf: string,
    windowSize: number
  ): Promise<MacroSeriesPoint[]> {
    const mode = getDataMode();
    
    if (mode === 'mongo' && this.db) {
      const repo = new MacroSeriesRepo(this.db);
      return repo.getWindow(seriesId, new Date(asOf), windowSize);
    }
    
    // Mock fallback
    const mockData = generateAllMockSeries();
    const series = mockData.find(s => s.key === seriesId);
    if (!series) return [];
    
    return series.data.slice(-windowSize).map(p => ({
      seriesId,
      periodEnd: new Date(p.date),
      value: p.value,
      releasedAt: new Date(p.date),
    }));
  }
  
  /**
   * Get current data mode
   */
  getMode(): DataMode {
    return getDataMode();
  }
  
  /**
   * Check if MongoDB is available
   */
  hasMongoDb(): boolean {
    return this.db !== null;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON FACTORY
// ═══════════════════════════════════════════════════════════════

let _providerInstance: MacroDataProvider | null = null;

export function getMacroDataProvider(db?: Db): MacroDataProvider {
  if (!_providerInstance) {
    _providerInstance = new MacroDataProvider(db);
  } else if (db && !_providerInstance.hasMongoDb()) {
    // Update with DB if not already set
    _providerInstance = new MacroDataProvider(db);
  }
  return _providerInstance;
}

export default MacroDataProvider;
