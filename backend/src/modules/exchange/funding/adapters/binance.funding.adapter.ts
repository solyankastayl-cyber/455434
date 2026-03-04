/**
 * БЛОК 1.1 — Binance Funding Adapter
 * ===================================
 * Uses existing binanceUSDMProvider
 */

import type { IFundingAdapter } from '../contracts/funding.adapter.js';
import type { FundingQuery, FundingReadResult, FundingVenue, FundingSample } from '../contracts/funding.types.js';
import { binanceUSDMProvider } from '../../providers/binance.usdm.provider.js';

export class BinanceFundingAdapter implements IFundingAdapter {
  venue(): FundingVenue {
    return 'BINANCE';
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      const health = await binanceUSDMProvider.health();
      return { ok: health.status === 'UP', message: health.message };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  }

  async readFunding(query: FundingQuery): Promise<FundingReadResult> {
    const asOfTs = query.asOfTs ?? Date.now();
    const samples: FundingSample[] = [];
    const errors: Array<{ symbol: string; reason: string }> = [];

    for (const symbol of query.symbols) {
      try {
        const funding = await binanceUSDMProvider.getFunding(symbol);
        if (funding) {
          samples.push({
            venue: 'BINANCE',
            symbol,
            ts: asOfTs,
            interval: '8h',
            fundingRate: funding.fundingRate,
            markPrice: funding.markPrice,
            indexPrice: funding.indexPrice,
          });
        }
      } catch (e) {
        errors.push({ symbol, reason: String(e) });
      }
    }

    return {
      venue: 'BINANCE',
      asOfTs,
      samples,
      partial: errors.length > 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}

export const binanceFundingAdapter = new BinanceFundingAdapter();

console.log('[Funding] Binance adapter loaded');
