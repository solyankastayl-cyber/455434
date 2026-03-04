/**
 * БЛОК 1.1 — Funding Registry
 * ============================
 */

import type { IFundingAdapter } from './contracts/funding.adapter.js';
import type { FundingVenue } from './contracts/funding.types.js';

export class FundingRegistry {
  private readonly map = new Map<FundingVenue, IFundingAdapter>();

  constructor(adapters: IFundingAdapter[]) {
    for (const a of adapters) {
      this.map.set(a.venue(), a);
    }
  }

  get(venue: FundingVenue): IFundingAdapter {
    const a = this.map.get(venue);
    if (!a) throw new Error(`Funding adapter missing for venue=${venue}`);
    return a;
  }

  list(): FundingVenue[] {
    return [...this.map.keys()];
  }

  all(): IFundingAdapter[] {
    return [...this.map.values()];
  }
}

console.log('[Funding] Registry loaded');
