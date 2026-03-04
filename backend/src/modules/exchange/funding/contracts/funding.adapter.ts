/**
 * БЛОК 1.1 — Funding Adapter Interface
 * =====================================
 */

import type { FundingQuery, FundingReadResult, FundingVenue } from './funding.types.js';

export interface IFundingAdapter {
  venue(): FundingVenue;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
  readFunding(query: FundingQuery): Promise<FundingReadResult>;
}

console.log('[Funding] Adapter interface loaded');
