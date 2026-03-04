/**
 * Phase H: MFE/MAE Calculator
 * 
 * MFE = Max Favorable Excursion (best unrealized profit)
 * MAE = Max Adverse Excursion (worst unrealized loss)
 */

import { Candle } from './market_provider.js';

export function calcMfeMae(params: {
  candles: Candle[];
  entry: number;
  side: 'LONG' | 'SHORT';
}): { mfe: number; mae: number } {
  let mfe = 0;
  let mae = 0;

  for (const c of params.candles) {
    if (params.side === 'LONG') {
      const fav = c.h - params.entry;
      const adv = params.entry - c.l;
      if (fav > mfe) mfe = fav;
      if (adv > mae) mae = adv;
    } else {
      const fav = params.entry - c.l;
      const adv = c.h - params.entry;
      if (fav > mfe) mfe = fav;
      if (adv > mae) mae = adv;
    }
  }

  return { mfe, mae };
}
