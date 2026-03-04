/**
 * S10.1 — Exchange Data Service
 * 
 * RESPONSIBILITIES:
 * - Pull data on schedule
 * - Cache snapshots
 * - Serve read-only API
 * 
 * NO:
 * - Signals
 * - Smart aggregations
 * - Conclusions
 */

import { binanceProvider } from './providers/binance/binance.provider.js';
import {
  ExchangeMarketSnapshot,
  OrderBookSnapshot,
  TradeFlowSnapshot,
  OpenInterestSnapshot,
  LiquidationEvent,
  ExchangeOverview,
  MarketRegime,
  ExchangeConfig,
} from './models/exchange.types.js';
import {
  ExchangeMarketModel,
  OrderBookModel,
  TradeFlowModel,
  OpenInterestModel,
  LiquidationModel,
  ExchangeConfigModel,
  providerStatusCache,
} from './models/exchange.model.js';

// Default config
const DEFAULT_CONFIG: ExchangeConfig = {
  enabled: false,
  pollingIntervalMs: 30000,
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
  provider: 'binance',
};

// In-memory cache
let marketsCache: ExchangeMarketSnapshot[] = [];
let orderBookCache: Map<string, OrderBookSnapshot> = new Map();
let tradeFlowCache: Map<string, TradeFlowSnapshot> = new Map();
let openInterestCache: Map<string, OpenInterestSnapshot> = new Map();
let liquidationsCache: LiquidationEvent[] = [];
let lastOverview: ExchangeOverview | null = null;
let pollingInterval: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Get or create config
 */
export async function getConfig(): Promise<ExchangeConfig> {
  const config = await ExchangeConfigModel.findOne();
  if (config) {
    return {
      enabled: config.enabled,
      pollingIntervalMs: config.pollingIntervalMs,
      symbols: config.symbols,
      provider: config.provider,
    };
  }
  
  // Create default config
  const newConfig = await ExchangeConfigModel.create(DEFAULT_CONFIG);
  return {
    enabled: newConfig.enabled,
    pollingIntervalMs: newConfig.pollingIntervalMs,
    symbols: newConfig.symbols,
    provider: newConfig.provider,
  };
}

/**
 * Update config
 */
export async function updateConfig(updates: Partial<ExchangeConfig>): Promise<ExchangeConfig> {
  const config = await ExchangeConfigModel.findOneAndUpdate(
    {},
    { $set: updates },
    { new: true, upsert: true }
  );
  
  // Restart polling if interval changed
  if (updates.pollingIntervalMs && isRunning) {
    stopPolling();
    startPolling();
  }
  
  return {
    enabled: config!.enabled,
    pollingIntervalMs: config!.pollingIntervalMs,
    symbols: config!.symbols,
    provider: config!.provider,
  };
}

/**
 * Fetch all data for configured symbols
 */
async function fetchAllData(): Promise<void> {
  const config = await getConfig();
  if (!config.enabled) {
    console.log('[ExchangeService] Polling disabled, skipping fetch');
    return;
  }

  console.log('[ExchangeService] Fetching exchange data...');
  const startTime = Date.now();

  try {
    // 1. Fetch markets
    const markets = await binanceProvider.getMarkets();
    if (markets.length > 0) {
      marketsCache = markets;
      
      // Save to DB (upsert)
      for (const market of markets.slice(0, 20)) {
        await ExchangeMarketModel.findOneAndUpdate(
          { symbol: market.symbol },
          market,
          { upsert: true }
        );
      }
    }

    // 2. Fetch detailed data for configured symbols
    for (const symbol of config.symbols) {
      // Order book
      const orderBook = await binanceProvider.getOrderBook(symbol);
      if (orderBook) {
        orderBookCache.set(symbol, orderBook);
        await OrderBookModel.create(orderBook);
      }

      // Trade flow
      const tradeFlow = await binanceProvider.getTrades(symbol);
      if (tradeFlow) {
        tradeFlowCache.set(symbol, tradeFlow);
        await TradeFlowModel.create(tradeFlow);
      }

      // Open interest
      const oi = await binanceProvider.getOpenInterest(symbol);
      if (oi) {
        // Calculate OI change from previous
        const prevOi = openInterestCache.get(symbol);
        if (prevOi && prevOi.oi > 0) {
          oi.oiChange = ((oi.oi - prevOi.oi) / prevOi.oi) * 100;
        }
        openInterestCache.set(symbol, oi);
        await OpenInterestModel.create(oi);
      }
    }

    // 3. Fetch liquidations
    const liquidations = await binanceProvider.getLiquidations();
    if (liquidations.length > 0) {
      liquidationsCache = liquidations;
      for (const liq of liquidations) {
        await LiquidationModel.create(liq);
      }
    }

    // 4. Update overview
    lastOverview = computeOverview();

    console.log(`[ExchangeService] Fetch complete in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('[ExchangeService] Fetch error:', error);
  }
}

/**
 * Compute market overview (no ML, just aggregation)
 */
function computeOverview(): ExchangeOverview {
  // Volatility: average of top markets
  const avgVolatility = marketsCache.length > 0
    ? marketsCache.slice(0, 10).reduce((sum, m) => sum + m.volatility, 0) / 10 * 100
    : 0;

  // Aggression: average of trade flows
  let totalAggression = 0;
  let flowCount = 0;
  tradeFlowCache.forEach((flow) => {
    totalAggression += flow.aggressorRatio;
    flowCount++;
  });
  const avgAggression = flowCount > 0 ? totalAggression / flowCount : 0;

  // OI trend
  let oiExpanding = 0;
  let oiContracting = 0;
  openInterestCache.forEach((oi) => {
    if (oi.oiChange > 1) oiExpanding++;
    else if (oi.oiChange < -1) oiContracting++;
  });
  const oiTrend: ExchangeOverview['oiTrend'] = 
    oiExpanding > oiContracting ? 'EXPANDING' :
    oiContracting > oiExpanding ? 'CONTRACTING' : 'NEUTRAL';

  // Liquidation pressure (last hour volume)
  const oneHourAgo = Date.now() - 3600000;
  const recentLiqs = liquidationsCache.filter(l => l.timestamp.getTime() > oneHourAgo);
  const liqVolume = recentLiqs.reduce((sum, l) => sum + l.size, 0);
  const liqPressure = Math.min(liqVolume / 10000000, 100); // Normalize to 0-100

  // Regime (placeholder - UNKNOWN or LOW_ACTIVITY)
  const regime: MarketRegime = avgVolatility < 10 ? 'LOW_ACTIVITY' : 'UNKNOWN';

  return {
    regime,
    volatilityIndex: avgVolatility,
    aggressionRatio: avgAggression,
    oiTrend,
    liquidationPressure: liqPressure,
    lastUpdate: new Date(),
  };
}

/**
 * Start polling
 */
export async function startPolling(): Promise<void> {
  if (isRunning) {
    console.log('[ExchangeService] Already running');
    return;
  }

  const config = await getConfig();
  if (!config.enabled) {
    console.log('[ExchangeService] Exchange module is disabled');
    return;
  }

  console.log(`[ExchangeService] Starting polling every ${config.pollingIntervalMs}ms`);
  isRunning = true;

  // Initial fetch
  await fetchAllData();

  // Start interval
  pollingInterval = setInterval(fetchAllData, config.pollingIntervalMs);
}

/**
 * Stop polling
 */
export function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  isRunning = false;
  console.log('[ExchangeService] Polling stopped');
}

/**
 * Check if running
 */
export function isPollingRunning(): boolean {
  return isRunning;
}

// ========== READ-ONLY API ==========

export function getMarkets(): ExchangeMarketSnapshot[] {
  return marketsCache;
}

export function getOrderBook(symbol: string): OrderBookSnapshot | null {
  return orderBookCache.get(symbol) || null;
}

export function getTradeFlow(symbol: string): TradeFlowSnapshot | null {
  return tradeFlowCache.get(symbol) || null;
}

export function getOpenInterest(symbol: string): OpenInterestSnapshot | null {
  return openInterestCache.get(symbol) || null;
}

export function getLiquidations(symbol?: string): LiquidationEvent[] {
  if (symbol) {
    return liquidationsCache.filter(l => l.symbol === symbol);
  }
  return liquidationsCache;
}

export function getOverview(): ExchangeOverview {
  return lastOverview || {
    regime: 'UNKNOWN',
    volatilityIndex: 0,
    aggressionRatio: 0,
    oiTrend: 'NEUTRAL',
    liquidationPressure: 0,
    lastUpdate: new Date(),
  };
}

export function getProviderStatus() {
  return providerStatusCache.get('binance') || {
    provider: 'binance',
    status: 'UNKNOWN',
    lastUpdate: new Date(0),
    errorCount: 0,
    rateLimitUsed: 0,
    latencyMs: 0,
  };
}

/**
 * Get health summary
 */
export function getHealth() {
  const providerStatus = getProviderStatus();
  const config = getConfig();
  
  return {
    service: 's10-exchange',
    status: isRunning && providerStatus.status === 'OK' ? 'ok' : 'degraded',
    provider: providerStatus,
    polling: {
      running: isRunning,
      lastUpdate: lastOverview?.lastUpdate || null,
    },
    cache: {
      markets: marketsCache.length,
      orderBooks: orderBookCache.size,
      tradeFlows: tradeFlowCache.size,
      openInterest: openInterestCache.size,
      liquidations: liquidationsCache.length,
    },
  };
}
