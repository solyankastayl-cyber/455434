/**
 * БЛОК 1.1 — Bybit Funding Adapter
 * =================================
 * Uses existing bybitUsdtPerpProvider
 */

import type { IFundingAdapter } from '../contracts/funding.adapter.js';
import type { FundingQuery, FundingReadResult, FundingVenue, FundingSample } from '../contracts/funding.types.js';
import { bybitUsdtPerpProvider } from '../../providers/bybit.usdtperp.provider.js';

export class BybitFundingAdapter implements IFundingAdapter {
  venue(): FundingVenue {
    return 'BYBIT';
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      const health = await bybitUsdtPerpProvider.health();
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
        const funding = await bybitUsdtPerpProvider.getFunding(symbol);
        if (funding) {
          samples.push({
            venue: 'BYBIT',
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
      venue: 'BYBIT',
      asOfTs,
      samples,
      partial: errors.length > 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}

export const bybitFundingAdapter = new BybitFundingAdapter();

console.log('[Funding] Bybit adapter loaded');
