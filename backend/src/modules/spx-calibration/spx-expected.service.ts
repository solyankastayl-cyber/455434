/**
 * SPX CALIBRATION — Expected Counts Service
 * 
 * BLOCK B6.4.1-2 — Calculate expected snapshots/outcomes before running calibration
 */

import { SpxCandleModel } from '../spx/spx.mongo.js';
import type { ExpectedCountsResponse } from './spx-calibration.types.js';
import { SPX_HORIZONS } from './spx-calibration.types.js';

export class SpxExpectedService {
  
  async getExpected(params: {
    start: string;
    end: string;
    presets: string[];
    roles: string[];
  }): Promise<ExpectedCountsResponse> {
    const { start, end, presets, roles } = params;

    // Get candles in range with idx
    const candles = await SpxCandleModel.find({
      symbol: 'SPX',
      date: { $gte: start, $lte: end }
    })
      .select({ idx: 1, date: 1 })
      .sort({ idx: 1 })
      .lean()
      .exec();

    if (!candles.length) {
      return {
        range: { start, end },
        D: 0,
        presets,
        roles,
        byHorizon: {},
        totals: { expectedSnapshots: 0, expectedOutcomes: 0 }
      };
    }

    const firstIdx = (candles[0] as any).idx as number;
    const lastIdx = (candles[candles.length - 1] as any).idx as number;
    const D = candles.length;

    const byHorizon: ExpectedCountsResponse['byHorizon'] = {};
    let totalSnapshots = 0;
    let totalOutcomes = 0;

    for (const h of SPX_HORIZONS) {
      const WL = h.windowLen;
      const AD = h.aftermathDays;

      let validAsOfDays = 0;
      let validOutcomeDays = 0;

      for (const c of candles) {
        const i = (c as any).idx as number;

        // Has enough history for this horizon?
        const hasHistory = (i - firstIdx + 1) >= WL;
        // Has enough future for outcome resolution?
        const hasOutcome = (i + AD) <= lastIdx;

        if (hasHistory) validAsOfDays++;
        if (hasHistory && hasOutcome) validOutcomeDays++;
      }

      const multiplier = presets.length * roles.length;

      const expectedSnapshots = validAsOfDays * multiplier;
      const expectedOutcomes = validOutcomeDays * multiplier;

      totalSnapshots += expectedSnapshots;
      totalOutcomes += expectedOutcomes;

      byHorizon[h.name] = {
        validAsOfDays,
        expectedSnapshots,
        expectedOutcomes
      };
    }

    return {
      range: { start, end },
      D,
      presets,
      roles,
      byHorizon,
      totals: {
        expectedSnapshots: totalSnapshots,
        expectedOutcomes: totalOutcomes
      }
    };
  }
}

export const spxExpectedService = new SpxExpectedService();
export default SpxExpectedService;
