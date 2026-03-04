/**
 * BLOCK 2.10 — Binance Universe Adapter
 * ======================================
 */

import type { VenueMarket, IVenueUniversePort, VenueType } from '../db/universe.model.js';

const BINANCE_FAPI_URL = 'https://fapi.binance.com';

export class BinanceUniverseAdapter implements IVenueUniversePort {
  venue(): VenueType {
    return 'binance';
  }

  async listMarkets(): Promise<VenueMarket[]> {
    try {
      // Fetch exchange info
      const infoRes = await fetch(`${BINANCE_FAPI_URL}/fapi/v1/exchangeInfo`);
      if (!infoRes.ok) {
        console.warn('[BinanceUniverse] Failed to fetch exchange info');
        return [];
      }
      const info = await infoRes.json();

      // Fetch 24h tickers for volume
      const tickerRes = await fetch(`${BINANCE_FAPI_URL}/fapi/v1/ticker/24hr`);
      const tickers: any[] = tickerRes.ok ? await tickerRes.json() : [];

      const volumeMap = new Map<string, { price: number; volume: number }>();
      for (const t of tickers) {
        volumeMap.set(t.symbol, {
          price: parseFloat(t.lastPrice) || 0,
          volume: parseFloat(t.quoteVolume) || 0,
        });
      }

      const markets: VenueMarket[] = [];

      for (const sym of info.symbols ?? []) {
        if (sym.status !== 'TRADING') continue;
        if (!sym.symbol.endsWith('USDT')) continue;

        const base = sym.baseAsset;
        const quote = sym.quoteAsset;
        const ticker = volumeMap.get(sym.symbol);

        markets.push({
          symbol: sym.symbol,
          base,
          quote,
          marketType: 'perp',
          enabled: true,
          lastPrice: ticker?.price,
          volumeUsd24h: ticker?.volume,
          hasFunding: true,
          hasOI: true,
          hasLiquidations: true,
        });
      }

      console.log(`[BinanceUniverse] Fetched ${markets.length} markets`);
      return markets;
    } catch (e: any) {
      console.error('[BinanceUniverse] Error:', e.message);
      return [];
    }
  }
}

export const binanceUniverseAdapter = new BinanceUniverseAdapter();
