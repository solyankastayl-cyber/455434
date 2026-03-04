/**
 * B2 — Universe Builder Service
 * 
 * Builds the symbol universe from:
 * - Binance/Bybit market data (via existing providers)
 * - Hyperliquid whale data (LIVE)
 */

import {
  SymbolUniverseItem,
  UniverseBuildResult,
  UniverseHealthResponse,
  ExchangeVenue,
} from './universe.types.js';
import {
  computeLiquidityScore,
  computeDerivativesScore,
  computeWhaleScore,
  computeUniverseScore,
  computeGates,
  computeStatus,
} from './universe.scoring.js';
import { getDb } from '../../../db/mongodb.js';
import * as whaleStorage from '../whales/whale-storage.service.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COLLECTION_NAME = 'exchange_symbol_universe';

// Core symbols that we always want to track
const CORE_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT'];

// ═══════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════

async function getCollection() {
  const db = getDb();
  return db.collection(COLLECTION_NAME);
}

export async function saveUniverseItem(item: SymbolUniverseItem): Promise<void> {
  const collection = await getCollection();
  await collection.updateOne(
    { symbol: item.symbol },
    { $set: item },
    { upsert: true }
  );
}

export async function getUniverseItem(symbol: string): Promise<SymbolUniverseItem | null> {
  const collection = await getCollection();
  return collection.findOne({ symbol }) as Promise<SymbolUniverseItem | null>;
}

export async function getAllUniverse(filter?: {
  status?: string;
  minScore?: number;
  exchange?: string;
  limit?: number;
}): Promise<SymbolUniverseItem[]> {
  const collection = await getCollection();
  
  const query: any = {};
  if (filter?.status) query.status = filter.status;
  if (filter?.minScore) query['scores.universeScore'] = { $gte: filter.minScore };
  if (filter?.exchange) {
    query[`venues.${filter.exchange}.enabled`] = true;
  }
  
  const cursor = collection.find(query)
    .sort({ 'scores.universeScore': -1 })
    .limit(filter?.limit ?? 200);
  
  return cursor.toArray() as Promise<SymbolUniverseItem[]>;
}

// ═══════════════════════════════════════════════════════════════
// GET WHALE DATA FROM HYPERLIQUID (already LIVE)
// ═══════════════════════════════════════════════════════════════

async function getWhaleDataForSymbol(symbol: string): Promise<{
  presence: boolean;
  count: number;
  netBiasPct: number;
  maxPositionUsd: number;
} | null> {
  try {
    // Use existing whale state from storage
    const state = await whaleStorage.getLatestState('hyperliquid', `${symbol}USDT`);
    if (!state) return null;
    
    return {
      presence: state.whaleLongCount + state.whaleShortCount > 0,
      count: state.whaleLongCount + state.whaleShortCount,
      netBiasPct: state.netBias,
      maxPositionUsd: state.maxSinglePositionUsd,
    };
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// BUILD UNIVERSE ITEM
// ═══════════════════════════════════════════════════════════════

async function buildUniverseItem(
  base: string,
  marketData: {
    volume24hUsd: number;
    openInterestUsd: number;
    fundingRate?: number;
    venue: ExchangeVenue;
  }
): Promise<SymbolUniverseItem> {
  const symbol = `${base}USDT`;
  
  // Get whale data from Hyperliquid
  const whaleData = await getWhaleDataForSymbol(base);
  
  // Compute scores
  const liquidityResult = computeLiquidityScore({
    volume24hUsd: marketData.volume24hUsd,
  });
  
  const derivativesResult = computeDerivativesScore({
    openInterestUsd: marketData.openInterestUsd,
    fundingRate: marketData.fundingRate,
  });
  
  const whaleResult = computeWhaleScore({
    whalePresence: whaleData?.presence ?? false,
    whaleCount: whaleData?.count ?? 0,
    maxPositionUsd: whaleData?.maxPositionUsd,
    netBiasPct: whaleData?.netBiasPct,
  });
  
  const scores = {
    liquidityScore: liquidityResult.score,
    derivativesScore: derivativesResult.score,
    whaleScore: whaleResult.score,
    universeScore: computeUniverseScore({
      liquidityScore: liquidityResult.score,
      derivativesScore: derivativesResult.score,
      whaleScore: whaleResult.score,
    }),
  };
  
  const gates = computeGates(scores);
  const { status, reasons } = computeStatus(scores, true);
  
  return {
    symbol,
    base,
    quote: 'USDT',
    
    venues: {
      [marketData.venue]: {
        enabled: true,
        volume24hUsd: marketData.volume24hUsd,
        oiUsd: marketData.openInterestUsd,
        fundingRate: marketData.fundingRate,
      },
      hyperliquid: whaleData ? {
        enabled: true,
        whalePresence: whaleData.presence,
        whaleCount: whaleData.count,
        netWhaleBiasPct: whaleData.netBiasPct,
        volume24hUsd: 0, // We don't track HL volume for now
      } : undefined,
    },
    
    scores,
    gates,
    
    sources: {
      price: marketData.venue,
      derivatives: marketData.venue,
      whales: whaleData ? 'hyperliquid' : 'none',
    },
    
    raw: {
      volume24h: marketData.volume24hUsd,
      openInterest: marketData.openInterestUsd,
      fundingRate: marketData.fundingRate ?? 0,
      whaleNetBias: whaleData?.netBiasPct ?? 0,
      whaleMaxPosition: whaleData?.maxPositionUsd ?? 0,
      whaleCount: whaleData?.count ?? 0,
    },
    
    status,
    reasons,
    updatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
// REBUILD UNIVERSE
// ═══════════════════════════════════════════════════════════════

export async function rebuildUniverse(): Promise<UniverseBuildResult> {
  const startTime = Date.now();
  const items: SymbolUniverseItem[] = [];
  
  let binanceStatus: 'UP' | 'DOWN' = 'UP';
  let bybitStatus: 'UP' | 'DOWN' = 'UP';
  let hyperliquidStatus: 'UP' | 'DOWN' = 'UP';
  
  // Check Hyperliquid health
  try {
    const health = await whaleStorage.getAllHealth();
    const hlHealth = health.find(h => h.exchange === 'hyperliquid');
    hyperliquidStatus = hlHealth?.status === 'UP' ? 'UP' : 'DOWN';
  } catch (e) {
    hyperliquidStatus = 'DOWN';
  }
  
  // For now, use core symbols with mock market data
  // TODO: Replace with real Binance/Bybit API calls
  for (const base of CORE_SYMBOLS) {
    try {
      // Generate realistic mock data for demo
      // In production, this would come from Binance/Bybit APIs
      const mockMarketData = {
        volume24hUsd: getRealisticVolume(base),
        openInterestUsd: getRealisticOI(base),
        fundingRate: (Math.random() - 0.5) * 0.002, // -0.1% to +0.1%
        venue: 'binance' as ExchangeVenue,
      };
      
      const item = await buildUniverseItem(base, mockMarketData);
      await saveUniverseItem(item);
      items.push(item);
    } catch (e: any) {
      console.warn(`[Universe] Failed to build item for ${base}:`, e.message);
    }
  }
  
  const included = items.filter(i => i.status === 'INCLUDED').length;
  const watch = items.filter(i => i.status === 'WATCH').length;
  const excluded = items.filter(i => i.status === 'EXCLUDED').length;
  
  console.log(`[Universe] Rebuilt: ${included} INCLUDED, ${watch} WATCH, ${excluded} EXCLUDED`);
  
  return {
    total: items.length,
    included,
    watch,
    excluded,
    items,
    buildTime: Date.now() - startTime,
    sources: {
      binance: binanceStatus,
      bybit: bybitStatus,
      hyperliquid: hyperliquidStatus,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════

export async function getUniverseHealth(): Promise<UniverseHealthResponse> {
  const items = await getAllUniverse();
  
  let hyperliquidStatus: 'UP' | 'DOWN' = 'DOWN';
  try {
    const health = await whaleStorage.getAllHealth();
    const hlHealth = health.find(h => h.exchange === 'hyperliquid');
    hyperliquidStatus = hlHealth?.status === 'UP' ? 'UP' : 'DOWN';
  } catch (e) {
    // Keep DOWN
  }
  
  return {
    symbols: items.length,
    included: items.filter(i => i.status === 'INCLUDED').length,
    watch: items.filter(i => i.status === 'WATCH').length,
    excluded: items.filter(i => i.status === 'EXCLUDED').length,
    sources: {
      binance: 'UP', // TODO: Real health check
      bybit: 'UP',   // TODO: Real health check
      hyperliquid: hyperliquidStatus,
    },
    lastBuildAt: items[0]?.updatedAt ?? new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS: Realistic mock data
// ═══════════════════════════════════════════════════════════════

function getRealisticVolume(base: string): number {
  const volumes: Record<string, number> = {
    BTC: 25_000_000_000,
    ETH: 12_000_000_000,
    SOL: 3_000_000_000,
    BNB: 1_500_000_000,
    XRP: 2_000_000_000,
    DOGE: 1_000_000_000,
    ADA: 500_000_000,
    AVAX: 400_000_000,
    LINK: 350_000_000,
    DOT: 300_000_000,
  };
  const baseVol = volumes[base] ?? 100_000_000;
  return baseVol * (0.8 + Math.random() * 0.4); // ±20% variance
}

function getRealisticOI(base: string): number {
  const oi: Record<string, number> = {
    BTC: 15_000_000_000,
    ETH: 8_000_000_000,
    SOL: 1_500_000_000,
    BNB: 800_000_000,
    XRP: 1_000_000_000,
    DOGE: 500_000_000,
    ADA: 300_000_000,
    AVAX: 250_000_000,
    LINK: 200_000_000,
    DOT: 150_000_000,
  };
  const baseOI = oi[base] ?? 50_000_000;
  return baseOI * (0.8 + Math.random() * 0.4);
}

console.log('[B2] Universe Builder Service loaded');
