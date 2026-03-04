/**
 * BLOCK 2.10 — HyperLiquid Universe Adapter
 * ==========================================
 * Enhanced with Volume and OI data from metaAndAssetCtxs
 */

import type { VenueMarket, IVenueUniversePort, VenueType } from '../db/universe.model.js';

const HL_API_URL = 'https://api.hyperliquid.xyz';

export class HyperliquidUniverseAdapter implements IVenueUniversePort {
  venue(): VenueType {
    return 'hyperliquid';
  }

  async listMarkets(): Promise<VenueMarket[]> {
    try {
      // Fetch meta + asset contexts in one call (includes volume, OI, funding)
      const metaRes = await fetch(`${HL_API_URL}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      });

      if (!metaRes.ok) {
        console.warn('[HLUniverse] Failed to fetch metaAndAssetCtxs');
        return [];
      }

      const [meta, assetCtxs] = await metaRes.json();
      const universe = meta?.universe ?? [];

      const markets: VenueMarket[] = [];

      for (let i = 0; i < universe.length; i++) {
        const asset = universe[i];
        const ctx = assetCtxs[i];
        const symbol = asset?.name;
        
        if (!symbol) continue;

        const markPrice = ctx?.markPx ? parseFloat(ctx.markPx) : undefined;
        const volumeUsd24h = ctx?.dayNtlVlm ? parseFloat(ctx.dayNtlVlm) : undefined;
        const openInterestUnits = ctx?.openInterest ? parseFloat(ctx.openInterest) : undefined;
        
        // Calculate OI in USD
        const openInterestUsd = (openInterestUnits && markPrice) 
          ? openInterestUnits * markPrice 
          : undefined;

        markets.push({
          symbol: `${symbol}USDT`, // Standardize format
          base: symbol,
          quote: 'USDT',
          marketType: 'perp',
          enabled: true,
          lastPrice: markPrice,
          volumeUsd24h,
          openInterestUsd,
          hasFunding: true,
          hasOI: openInterestUsd !== undefined && openInterestUsd > 0,
          hasLiquidations: false,
        });
      }

      console.log(`[HLUniverse] Fetched ${markets.length} markets with volume/OI data`);
      return markets;
    } catch (e: any) {
      console.error('[HLUniverse] Error:', e.message);
      return [];
    }
  }
}

export const hyperliquidUniverseAdapter = new HyperliquidUniverseAdapter();
