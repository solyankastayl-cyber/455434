/**
 * БЛОК 1.1 — Coinbase Funding Adapter (Fallback)
 * ===============================================
 * Coinbase = spot only, no funding. Returns empty/partial.
 */

import type { IFundingAdapter } from '../contracts/funding.adapter.js';
import type { FundingQuery, FundingReadResult, FundingVenue } from '../contracts/funding.types.js';

export class CoinbaseFundingAdapter implements IFundingAdapter {
  venue(): FundingVenue {
    return 'COINBASE';
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: 'spot-only (no funding)' };
  }

  async readFunding(query: FundingQuery): Promise<FundingReadResult> {
    const asOfTs = query.asOfTs ?? Date.now();
    return {
      venue: 'COINBASE',
      asOfTs,
      samples: [],
      partial: true,
      errors: query.symbols.map(s => ({ symbol: s, reason: 'COINBASE_NO_FUNDING' })),
    };
  }
}

export const coinbaseFundingAdapter = new CoinbaseFundingAdapter();

console.log('[Funding] Coinbase adapter loaded');
