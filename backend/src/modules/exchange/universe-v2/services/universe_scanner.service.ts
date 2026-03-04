/**
 * BLOCK 2.10 — Universe Scanner Service
 * ======================================
 * Scans exchanges and populates universe database.
 */

import type { Db, Collection } from 'mongodb';
import type { 
  UniverseSymbolDoc, 
  VenueMarket, 
  IVenueUniversePort, 
  UniverseScanResult,
  VenueType,
  MarketType
} from '../db/universe.model.js';
import { binanceUniverseAdapter } from '../adapters/binance.universe.adapter.js';
import { bybitUniverseAdapter } from '../adapters/bybit.universe.adapter.js';
import { hyperliquidUniverseAdapter } from '../adapters/hyperliquid.universe.adapter.js';

function tierLiquidity(volume: number): 'LOW' | 'MID' | 'HIGH' {
  if (volume >= 50_000_000) return 'HIGH';
  if (volume >= 5_000_000) return 'MID';
  return 'LOW';
}

export interface UniverseScannerConfig {
  minVolumeUsd24h: number;
  allowQuotes: string[];
  allowMarketTypes: MarketType[];
  maxSymbolsPerVenue: number;
}

const DEFAULT_CONFIG: UniverseScannerConfig = {
  minVolumeUsd24h: 2_000_000,
  allowQuotes: ['USDT', 'USDC'],
  allowMarketTypes: ['perp'],
  maxSymbolsPerVenue: 500,
};

export class UniverseScannerService {
  private col: Collection<UniverseSymbolDoc> | null = null;
  private ports: IVenueUniversePort[] = [
    binanceUniverseAdapter,
    bybitUniverseAdapter,
    hyperliquidUniverseAdapter,
  ];
  private config = DEFAULT_CONFIG;

  init(db: Db) {
    this.col = db.collection<UniverseSymbolDoc>('universe_symbols_v2');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.col) return;
    try {
      await this.col.createIndex({ venue: 1, enabled: 1, marketType: 1 });
      await this.col.createIndex({ symbol: 1, venue: 1 }, { unique: true });
      await this.col.createIndex({ base: 1 });
      await this.col.createIndex({ liquidityTier: 1 });
    } catch (e) {
      console.warn('[UniverseScanner] Index error:', e);
    }
  }

  /**
   * Scan all venues
   */
  async scanAll(): Promise<UniverseScanResult[]> {
    const results: UniverseScanResult[] = [];

    for (const port of this.ports) {
      const venue = port.venue();
      try {
        const markets = await port.listMarkets();
        const filtered = this.applyFilters(markets);

        const seenSymbols = filtered.map(m => m.symbol);
        const upserted = await this.upsertMany(venue, filtered);
        const disabled = await this.disableMissing(venue, seenSymbols);

        results.push({
          venue,
          fetched: markets.length,
          upserted,
          disabled,
          filteredOut: markets.length - filtered.length,
          errors: [],
        });

        console.log(`[UniverseScanner] ${venue}: ${upserted} upserted, ${disabled} disabled`);
      } catch (e: any) {
        results.push({
          venue,
          fetched: 0,
          upserted: 0,
          disabled: 0,
          filteredOut: 0,
          errors: [e.message ?? String(e)],
        });
      }
    }

    return results;
  }

  /**
   * Scan single venue
   */
  async scanVenue(venue: VenueType): Promise<UniverseScanResult> {
    const port = this.ports.find(p => p.venue() === venue);
    if (!port) {
      return { venue, fetched: 0, upserted: 0, disabled: 0, filteredOut: 0, errors: ['Unknown venue'] };
    }

    try {
      const markets = await port.listMarkets();
      const filtered = this.applyFilters(markets);

      const seenSymbols = filtered.map(m => m.symbol);
      const upserted = await this.upsertMany(venue, filtered);
      const disabled = await this.disableMissing(venue, seenSymbols);

      return {
        venue,
        fetched: markets.length,
        upserted,
        disabled,
        filteredOut: markets.length - filtered.length,
        errors: [],
      };
    } catch (e: any) {
      return {
        venue,
        fetched: 0,
        upserted: 0,
        disabled: 0,
        filteredOut: 0,
        errors: [e.message ?? String(e)],
      };
    }
  }

  /**
   * Apply filters
   */
  private applyFilters(markets: VenueMarket[]): VenueMarket[] {
    const { minVolumeUsd24h, allowQuotes, allowMarketTypes, maxSymbolsPerVenue } = this.config;

    return markets
      .filter(m => m.enabled !== false)
      .filter(m => allowQuotes.includes(m.quote))
      .filter(m => allowMarketTypes.includes(m.marketType))
      .filter(m => (m.volumeUsd24h ?? 0) >= minVolumeUsd24h || m.volumeUsd24h === undefined)
      .slice(0, maxSymbolsPerVenue);
  }

  /**
   * Upsert markets
   */
  private async upsertMany(venue: VenueType, markets: VenueMarket[]): Promise<number> {
    if (!this.col || markets.length === 0) return 0;

    const now = new Date();
    const ops = markets.map(m => ({
      updateOne: {
        filter: { symbol: m.symbol, venue },
        update: {
          $set: {
            base: m.base,
            quote: m.quote,
            marketType: m.marketType,
            enabled: true,
            avgUsdVolume24h: m.volumeUsd24h,
            lastPrice: m.lastPrice,
            hasFunding: m.hasFunding,
            hasOI: m.hasOI,
            hasLiquidations: m.hasLiquidations,
            liquidityTier: tierLiquidity(m.volumeUsd24h ?? 0),
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        upsert: true,
      },
    }));

    const result = await this.col.bulkWrite(ops, { ordered: false });
    return (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0);
  }

  /**
   * Disable missing symbols
   */
  private async disableMissing(venue: VenueType, seenSymbols: string[]): Promise<number> {
    if (!this.col) return 0;

    const result = await this.col.updateMany(
      { venue, symbol: { $nin: seenSymbols }, enabled: true },
      { $set: { enabled: false, updatedAt: new Date() } }
    );

    return result.modifiedCount;
  }

  /**
   * Get enabled symbols
   */
  async listEnabled(opts: {
    venue?: VenueType;
    marketType?: MarketType;
    liquidityTier?: 'LOW' | 'MID' | 'HIGH';
    limit?: number;
  }): Promise<UniverseSymbolDoc[]> {
    if (!this.col) return [];

    const query: any = { enabled: true };
    if (opts.venue) query.venue = opts.venue;
    if (opts.marketType) query.marketType = opts.marketType;
    if (opts.liquidityTier) query.liquidityTier = opts.liquidityTier;

    return this.col
      .find(query)
      .sort({ avgUsdVolume24h: -1 })
      .limit(opts.limit ?? 500)
      .toArray();
  }

  /**
   * Get stats
   */
  async getStats(): Promise<{
    total: number;
    enabled: number;
    byVenue: Record<string, number>;
    byLiquidity: Record<string, number>;
  }> {
    if (!this.col) return { total: 0, enabled: 0, byVenue: {}, byLiquidity: {} };

    const all = await this.col.find({}).toArray();
    const enabled = all.filter(d => d.enabled);

    const byVenue: Record<string, number> = {};
    const byLiquidity: Record<string, number> = {};

    for (const d of enabled) {
      byVenue[d.venue] = (byVenue[d.venue] ?? 0) + 1;
      byLiquidity[d.liquidityTier ?? 'UNKNOWN'] = (byLiquidity[d.liquidityTier ?? 'UNKNOWN'] ?? 0) + 1;
    }

    return {
      total: all.length,
      enabled: enabled.length,
      byVenue,
      byLiquidity,
    };
  }
}

export const universeScannerService = new UniverseScannerService();

console.log('[Universe] Scanner Service loaded');
