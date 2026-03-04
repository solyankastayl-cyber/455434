/**
 * BLOCK 2.10 — Bybit Universe Adapter
 * ====================================
 */

import type { VenueMarket, IVenueUniversePort, VenueType } from '../db/universe.model.js';

const BYBIT_API_URL = 'https://api.bybit.com';

export class BybitUniverseAdapter implements IVenueUniversePort {
  venue(): VenueType {
    return 'bybit';
  }

  async listMarkets(): Promise<VenueMarket[]> {
    try {
      // Fetch instruments info
      const res = await fetch(`${BYBIT_API_URL}/v5/market/instruments-info?category=linear`);
      if (!res.ok) {
        console.warn('[BybitUniverse] Failed to fetch instruments');
        return [];
      }
      const data = await res.json();

      // Fetch tickers
      const tickerRes = await fetch(`${BYBIT_API_URL}/v5/market/tickers?category=linear`);
      const tickerData: any = tickerRes.ok ? await tickerRes.json() : { result: { list: [] } };

      const volumeMap = new Map<string, { price: number; volume: number }>();
      for (const t of tickerData.result?.list ?? []) {
        volumeMap.set(t.symbol, {
          price: parseFloat(t.lastPrice) || 0,
          volume: parseFloat(t.turnover24h) || 0,
        });
      }

      const markets: VenueMarket[] = [];

      for (const inst of data.result?.list ?? []) {
        if (inst.status !== 'Trading') continue;
        if (!inst.symbol.endsWith('USDT')) continue;

        const ticker = volumeMap.get(inst.symbol);

        markets.push({
          symbol: inst.symbol,
          base: inst.baseCoin,
          quote: inst.quoteCoin,
          marketType: 'perp',
          enabled: true,
          lastPrice: ticker?.price,
          volumeUsd24h: ticker?.volume,
          hasFunding: true,
          hasOI: true,
          hasLiquidations: true,
        });
      }

      console.log(`[BybitUniverse] Fetched ${markets.length} markets`);
      return markets;
    } catch (e: any) {
      console.error('[BybitUniverse] Error:', e.message);
      return [];
    }
  }
}

export const bybitUniverseAdapter = new BybitUniverseAdapter();
