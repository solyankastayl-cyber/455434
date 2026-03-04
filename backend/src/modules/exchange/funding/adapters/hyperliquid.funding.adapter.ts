/**
 * БЛОК 1.1 — HyperLiquid Funding Adapter
 * =======================================
 * HyperLiquid has 1h funding intervals - faster signals
 */

import type { IFundingAdapter } from '../contracts/funding.adapter.js';
import type { FundingQuery, FundingReadResult, FundingVenue, FundingSample } from '../contracts/funding.types.js';

const HL_API = 'https://api.hyperliquid.xyz/info';

interface HLFundingResponse {
  coin: string;
  funding: string;
  premium: string;
  openInterest: string;
}

export class HyperliquidFundingAdapter implements IFundingAdapter {
  venue(): FundingVenue {
    return 'HYPERLIQUID';
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await fetch(HL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'meta' }),
      });
      return { ok: res.ok, message: res.ok ? 'UP' : 'DOWN' };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  }

  async readFunding(query: FundingQuery): Promise<FundingReadResult> {
    const asOfTs = query.asOfTs ?? Date.now();
    const samples: FundingSample[] = [];
    const errors: Array<{ symbol: string; reason: string }> = [];

    try {
      // Get all funding rates in one call
      const res = await fetch(HL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      });

      if (!res.ok) {
        return {
          venue: 'HYPERLIQUID',
          asOfTs,
          samples: [],
          partial: true,
          errors: [{ symbol: '*', reason: `HTTP ${res.status}` }],
        };
      }

      const data = await res.json();
      const assetCtxs = data[1] || [];
      const universe = data[0]?.universe || [];

      // Map coin names to USDT format
      const coinMap = new Map<string, any>();
      for (let i = 0; i < universe.length; i++) {
        const coin = universe[i].name;
        const ctx = assetCtxs[i];
        if (ctx) {
          coinMap.set(coin + 'USDT', ctx);
          coinMap.set(coin, ctx);
        }
      }

      for (const symbol of query.symbols) {
        const ctx = coinMap.get(symbol) || coinMap.get(symbol.replace('USDT', ''));
        if (ctx) {
          samples.push({
            venue: 'HYPERLIQUID',
            symbol,
            ts: asOfTs,
            interval: '1h', // HL has hourly funding
            fundingRate: parseFloat(ctx.funding || '0'),
            markPrice: parseFloat(ctx.markPx || '0'),
            openInterestUsd: parseFloat(ctx.openInterest || '0'),
          });
        } else {
          errors.push({ symbol, reason: 'NOT_FOUND' });
        }
      }
    } catch (e) {
      errors.push({ symbol: '*', reason: String(e) });
    }

    return {
      venue: 'HYPERLIQUID',
      asOfTs,
      samples,
      partial: errors.length > 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}

export const hyperliquidFundingAdapter = new HyperliquidFundingAdapter();

console.log('[Funding] HyperLiquid adapter loaded');
