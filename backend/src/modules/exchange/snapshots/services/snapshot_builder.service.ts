/**
 * BLOCK 2.11 — Snapshot Builder Service
 * ======================================
 * Builds feature snapshots for all universe symbols.
 */

import type { Db, Collection } from 'mongodb';
import type { ExchangeSymbolSnapshotDoc, TimeFrame } from '../db/exchange_symbol_snapshot.model.js';
import type { UniverseSymbolDoc } from '../../universe-v2/db/universe.model.js';
import { buildFeatures, computeQualityScore } from '../features/feature_builder.js';
import type { SymbolRawData } from '../features/feature_registry.js';

function roundTo5m(d: Date): Date {
  const ms = 5 * 60 * 1000;
  return new Date(Math.floor(d.getTime() / ms) * ms);
}

function tierLiquidity(v: number): 'LOW' | 'MID' | 'HIGH' {
  if (v >= 50_000_000) return 'HIGH';
  if (v >= 5_000_000) return 'MID';
  return 'LOW';
}

export interface SnapshotBuildConfig {
  tf: TimeFrame;
  concurrency: number;
  maxSymbols: number;
  minQualityScore: number;
}

const DEFAULT_CONFIG: SnapshotBuildConfig = {
  tf: '5m',
  concurrency: 10,
  maxSymbols: 500,
  minQualityScore: 0.35, // Lowered for HyperLiquid which has limited data
};

// Binance API helpers
const BINANCE_FAPI = 'https://fapi.binance.com';

async function fetchBinancePrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${BINANCE_FAPI}/fapi/v1/ticker/price?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    return parseFloat(data.price) || null;
  } catch {
    return null;
  }
}

async function fetchBinanceFunding(symbol: string): Promise<{ rate: number; annualized: number } | null> {
  try {
    const res = await fetch(`${BINANCE_FAPI}/fapi/v1/premiumIndex?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    const rate = parseFloat(data.lastFundingRate) || 0;
    return {
      rate,
      annualized: rate * 3 * 365 * 100, // 8h funding * 3 * 365 = annualized %
    };
  } catch {
    return null;
  }
}

async function fetchBinanceOI(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    return parseFloat(data.openInterest) || null;
  } catch {
    return null;
  }
}

async function fetchBinance24hTicker(symbol: string): Promise<{
  volume: number;
  priceChg: number;
  high: number;
  low: number;
  prevClose: number;
} | null> {
  try {
    const res = await fetch(`${BINANCE_FAPI}/fapi/v1/ticker/24hr?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      volume: parseFloat(data.quoteVolume) || 0,
      priceChg: parseFloat(data.priceChangePercent) || 0,
      high: parseFloat(data.highPrice) || 0,
      low: parseFloat(data.lowPrice) || 0,
      prevClose: parseFloat(data.prevClosePrice) || 0,
    };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// HyperLiquid API Helpers
// ═══════════════════════════════════════════════════════════════
const HL_API = 'https://api.hyperliquid.xyz';

async function fetchHLAllMids(): Promise<Map<string, number>> {
  try {
    const res = await fetch(`${HL_API}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    });
    if (!res.ok) return new Map();
    const data: Record<string, string> = await res.json();
    const result = new Map<string, number>();
    for (const [symbol, price] of Object.entries(data)) {
      result.set(symbol, parseFloat(price));
    }
    return result;
  } catch {
    return new Map();
  }
}

async function fetchHLMeta(): Promise<any[]> {
  try {
    const res = await fetch(`${HL_API}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.universe || [];
  } catch {
    return [];
  }
}

interface HLAssetData {
  rate: number;
  annualized: number;
  openInterest: number;
  volumeUsd24h: number;
  markPrice: number;
  prevDayPrice: number;
}

async function fetchHLAssetData(): Promise<Map<string, HLAssetData>> {
  try {
    const res = await fetch(`${HL_API}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    if (!res.ok) return new Map();
    const [meta, contexts] = await res.json();
    
    const result = new Map<string, HLAssetData>();
    const universe = meta?.universe || [];
    
    for (let i = 0; i < universe.length && i < contexts.length; i++) {
      const symbol = universe[i]?.name;
      const ctx = contexts[i];
      if (symbol && ctx) {
        const rate = parseFloat(ctx.funding) || 0;
        const markPrice = parseFloat(ctx.markPx) || 0;
        const openInterest = parseFloat(ctx.openInterest) || 0;
        const volumeUsd24h = parseFloat(ctx.dayNtlVlm) || 0;
        const prevDayPrice = parseFloat(ctx.prevDayPx) || 0;
        
        result.set(symbol, {
          rate,
          annualized: rate * 24 * 365 * 100, // HL funding is hourly
          openInterest,
          volumeUsd24h,
          markPrice,
          prevDayPrice,
        });
      }
    }
    return result;
  } catch (e) {
    console.error('[SnapshotBuilder] HL fetchAssetData error:', e);
    return new Map();
  }
}

// Legacy function for backward compatibility
async function fetchHLFundingRates(): Promise<Map<string, { rate: number; annualized: number }>> {
  const data = await fetchHLAssetData();
  const result = new Map<string, { rate: number; annualized: number }>();
  data.forEach((d, symbol) => {
    result.set(symbol, { rate: d.rate, annualized: d.annualized });
  });
  return result;
}

export class SnapshotBuilderService {
  private snapshotCol: Collection<ExchangeSymbolSnapshotDoc> | null = null;
  private universeCol: Collection<UniverseSymbolDoc> | null = null;

  init(db: Db) {
    this.snapshotCol = db.collection<ExchangeSymbolSnapshotDoc>('exchange_symbol_snapshots');
    this.universeCol = db.collection<UniverseSymbolDoc>('universe_symbols_v2');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.snapshotCol) return;
    try {
      await this.snapshotCol.createIndex({ symbolKey: 1, ts: -1 });
      await this.snapshotCol.createIndex({ ts: -1, venue: 1, marketType: 1 });
      await this.snapshotCol.createIndex({ base: 1, ts: -1 });
    } catch (e) {
      console.warn('[SnapshotBuilder] Index error:', e);
    }
  }

  /**
   * Build snapshots for all enabled symbols
   */
  async buildOnce(cfg: Partial<SnapshotBuildConfig> = {}, opts?: { venue?: string }): Promise<{
    scanned: number;
    kept: number;
    upserted: number;
    errors: number;
  }> {
    const config = { ...DEFAULT_CONFIG, ...cfg };

    if (!this.universeCol || !this.snapshotCol) {
      return { scanned: 0, kept: 0, upserted: 0, errors: 0 };
    }

    // Get enabled symbols from universe - try specified venue or fallback
    const query: any = { enabled: true };
    if (opts?.venue) {
      query.venue = opts.venue;
    }

    let symbols = await this.universeCol
      .find(query)
      .sort({ avgUsdVolume24h: -1 })
      .limit(config.maxSymbols)
      .toArray();

    // Fallback: if no symbols found with specified venue, try any available
    if (symbols.length === 0 && opts?.venue) {
      symbols = await this.universeCol
        .find({ enabled: true })
        .sort({ avgUsdVolume24h: -1 })
        .limit(config.maxSymbols)
        .toArray();
    }

    if (symbols.length === 0) {
      console.log('[SnapshotBuilder] No symbols in universe');
      return { scanned: 0, kept: 0, upserted: 0, errors: 0 };
    }

    const ts = roundTo5m(new Date());
    const docs: ExchangeSymbolSnapshotDoc[] = [];
    let errors = 0;

    // Determine venue - use first symbol's venue
    const venue = symbols[0]?.venue || 'hyperliquid';

    // Pre-fetch all data for HyperLiquid (more efficient)
    let hlPrices: Map<string, number> = new Map();
    let hlAssetData: Map<string, HLAssetData> = new Map();
    
    if (venue === 'hyperliquid') {
      console.log('[SnapshotBuilder] Fetching HyperLiquid data...');
      [hlPrices, hlAssetData] = await Promise.all([
        fetchHLAllMids(),
        fetchHLAssetData(),
      ]);
      console.log(`[SnapshotBuilder] HL prices: ${hlPrices.size}, asset data: ${hlAssetData.size}`);
    }

    // Process in batches
    const batchSize = config.concurrency;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (s) => {
          try {
            if (s.venue === 'hyperliquid') {
              return await this.buildSnapshotForHL(s, ts, config.tf, hlPrices, hlAssetData);
            } else {
              return await this.buildSnapshotForSymbol(s, ts, config.tf);
            }
          } catch (e) {
            errors++;
            return null;
          }
        })
      );

      for (const doc of results) {
        if (doc && doc.dataQuality.qualityScore >= config.minQualityScore) {
          docs.push(doc);
        }
      }
    }

    // Upsert to DB
    const upserted = await this.upsertSnapshots(docs);

    console.log(`[SnapshotBuilder] Scanned: ${symbols.length}, Kept: ${docs.length}, Upserted: ${upserted}`);
    return {
      scanned: symbols.length,
      kept: docs.length,
      upserted,
      errors,
    };
  }

  /**
   * Build snapshot for HyperLiquid symbol with enhanced data (Volume, OI)
   */
  private async buildSnapshotForHL(
    s: UniverseSymbolDoc,
    ts: Date,
    tf: TimeFrame,
    prices: Map<string, number>,
    assetData: Map<string, HLAssetData>
  ): Promise<ExchangeSymbolSnapshotDoc | null> {
    const price = prices.get(s.base);
    if (!price) return null;

    const data = assetData.get(s.base);

    // Calculate OI in USD (openInterest is in asset units, multiply by price)
    const oiUsd = data?.openInterest ? data.openInterest * price : undefined;
    
    // Calculate 24h price change percentage
    const priceChg24h = data?.prevDayPrice && data.prevDayPrice > 0
      ? ((price - data.prevDayPrice) / data.prevDayPrice) * 100
      : undefined;

    // Build raw data object with enhanced fields
    const raw: SymbolRawData = {
      price,
      volumeUsd24h: data?.volumeUsd24h,
      oiUsd,
      fundingRate: data?.rate,
      fundingAnnualized: data?.annualized,
      ohlc: data?.prevDayPrice ? {
        close24hAgo: data.prevDayPrice,
      } : undefined,
    };

    // Build features
    const { features, missing } = buildFeatures(raw);
    const qualityScore = computeQualityScore(raw, missing);

    const symbolKey = `${s.base}:${s.quote}:${s.marketType}:${s.venue}`;

    return {
      symbolKey,
      base: s.base,
      quote: s.quote,
      venue: s.venue,
      marketType: s.marketType,
      ts,
      tf,
      price,
      priceChg24h,
      volumeUsd24h: data?.volumeUsd24h,
      oiUsd,
      fundingRate: data?.rate,
      fundingAnnualized: data?.annualized,
      features,
      dataQuality: {
        sources: [`${s.venue}:${s.marketType}`],
        missing,
        qualityScore,
      },
      tags: {
        hasFunding: data?.rate !== undefined,
        hasOI: oiUsd !== undefined && oiUsd > 0,
        hasLiquidations: false,
        liquidityTier: tierLiquidity(data?.volumeUsd24h ?? 0),
      },
      createdAt: new Date(),
    };
  }

  /**
   * Build snapshot for single symbol
   */
  private async buildSnapshotForSymbol(
    s: UniverseSymbolDoc,
    ts: Date,
    tf: TimeFrame
  ): Promise<ExchangeSymbolSnapshotDoc | null> {
    // Fetch raw data from Binance
    const [price, funding, oi, ticker24h] = await Promise.all([
      fetchBinancePrice(s.symbol),
      fetchBinanceFunding(s.symbol),
      fetchBinanceOI(s.symbol),
      fetchBinance24hTicker(s.symbol),
    ]);

    if (!price) return null;

    // Build raw data object
    const raw: SymbolRawData = {
      price,
      volumeUsd24h: ticker24h?.volume,
      ohlc: ticker24h ? {
        close24hAgo: ticker24h.prevClose,
        high24h: ticker24h.high,
        low24h: ticker24h.low,
      } : undefined,
      oiUsd: oi ? oi * price : undefined,
      fundingRate: funding?.rate,
      fundingAnnualized: funding?.annualized,
    };

    // Build features
    const { features, missing } = buildFeatures(raw);
    const qualityScore = computeQualityScore(raw, missing);

    const symbolKey = `${s.base}:${s.quote}:${s.marketType}:${s.venue}`;

    return {
      symbolKey,
      base: s.base,
      quote: s.quote,
      venue: s.venue,
      marketType: s.marketType,
      ts,
      tf,
      price,
      priceChg24h: ticker24h?.priceChg,
      volumeUsd24h: ticker24h?.volume,
      oiUsd: raw.oiUsd,
      fundingRate: funding?.rate,
      fundingAnnualized: funding?.annualized,
      features,
      dataQuality: {
        sources: [`${s.venue}:${s.marketType}`],
        missing,
        qualityScore,
      },
      tags: {
        hasFunding: funding !== null,
        hasOI: oi !== null,
        hasLiquidations: false,
        liquidityTier: tierLiquidity(ticker24h?.volume ?? 0),
      },
      createdAt: new Date(),
    };
  }

  /**
   * Upsert snapshots
   */
  private async upsertSnapshots(docs: ExchangeSymbolSnapshotDoc[]): Promise<number> {
    if (!this.snapshotCol || docs.length === 0) return 0;

    const ops = docs.map(d => ({
      updateOne: {
        filter: { symbolKey: d.symbolKey, ts: d.ts, tf: d.tf },
        update: { $set: d },
        upsert: true,
      },
    }));

    const result = await this.snapshotCol.bulkWrite(ops, { ordered: false });
    return (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0);
  }

  /**
   * Get latest snapshots
   */
  async getLatest(opts: {
    venue?: string;
    marketType?: string;
    limit?: number;
    minQuality?: number;
  }): Promise<ExchangeSymbolSnapshotDoc[]> {
    if (!this.snapshotCol) return [];

    const query: any = {};
    if (opts.venue) query.venue = opts.venue;
    if (opts.marketType) query.marketType = opts.marketType;
    if (opts.minQuality) query['dataQuality.qualityScore'] = { $gte: opts.minQuality };

    return this.snapshotCol
      .find(query)
      .sort({ ts: -1 })
      .limit(opts.limit ?? 50)
      .toArray();
  }

  /**
   * Get snapshot history for symbol
   */
  async getHistory(symbolKey: string, limit = 288): Promise<ExchangeSymbolSnapshotDoc[]> {
    if (!this.snapshotCol) return [];

    return this.snapshotCol
      .find({ symbolKey })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get health stats
   */
  async getHealth(): Promise<{
    totalSnapshots: number;
    uniqueSymbols: number;
    latestTs: Date | null;
    avgQuality: number;
    fundingCoverage: number;
  }> {
    if (!this.snapshotCol) {
      return { totalSnapshots: 0, uniqueSymbols: 0, latestTs: null, avgQuality: 0, fundingCoverage: 0 };
    }

    const pipeline = [
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          uniqueSymbols: { $addToSet: '$symbolKey' },
          latestTs: { $max: '$ts' },
          avgQuality: { $avg: '$dataQuality.qualityScore' },
          withFunding: { $sum: { $cond: ['$tags.hasFunding', 1, 0] } },
        },
      },
    ];

    const results = await this.snapshotCol.aggregate(pipeline).toArray();
    const r = results[0];

    if (!r) {
      return { totalSnapshots: 0, uniqueSymbols: 0, latestTs: null, avgQuality: 0, fundingCoverage: 0 };
    }

    return {
      totalSnapshots: r.total ?? 0,
      uniqueSymbols: r.uniqueSymbols?.length ?? 0,
      latestTs: r.latestTs ?? null,
      avgQuality: r.avgQuality ?? 0,
      fundingCoverage: r.total > 0 ? (r.withFunding ?? 0) / r.total : 0,
    };
  }
}

export const snapshotBuilderService = new SnapshotBuilderService();

console.log('[SnapshotBuilder] Service loaded');
