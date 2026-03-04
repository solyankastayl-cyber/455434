/**
 * BLOCK 29.25: Auto Window Selector Service
 * Builds candidate train windows and selects best based on evaluation metrics
 */

import { FractalSettingsModel } from '../data/schemas/fractal-settings.schema.js';
import { FractalFeedbackModel } from '../data/schemas/fractal-feedback.schema.js';
import { DAY_MS, iso } from '../domain/time.js';

export interface WindowCandidate {
  years: number;
  trainStart: Date;
  trainEnd: Date;
}

export class FractalAutoWindowService {
  async latestSettledTs(symbol: string): Promise<Date> {
    const last = await FractalFeedbackModel.findOne({ symbol }).sort({ settleTs: -1 }).lean();
    return last?.settleTs ? new Date(last.settleTs as Date) : new Date();
  }

  async buildCandidates(symbol = 'BTC'): Promise<{ policy: any; candidates: WindowCandidate[] }> {
    const settings = await FractalSettingsModel.findOne({ symbol }).lean() as any;
    const pol = settings?.autoTrainWindow ?? {};

    const yearsList: number[] = (pol.windowYears ?? [4, 6, 8, 10]).map((x: any) => Number(x));
    const minStart = new Date(String(pol.minStartDate ?? '2014-01-01'));

    const endMode = String(pol.endMode ?? 'LATEST_SETTLED');
    const endTs = endMode === 'LATEST_SETTLED'
      ? await this.latestSettledTs(symbol)
      : new Date();

    // Priority order for window years
    const priority = [6, 8, 4, 10];
    yearsList.sort((a, b) => {
      const ia = priority.indexOf(a);
      const ib = priority.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    const candidates = yearsList.map(y => {
      const start = new Date(endTs.getTime() - y * 365 * DAY_MS);
      const trainStart = start < minStart ? minStart : start;
      return { years: y, trainStart, trainEnd: endTs };
    });

    // Filter by minYears
    const minYears = Number(pol.filters?.minYears ?? 4);
    const filtered = candidates.filter(c => c.years >= minYears);

    // Budget cap
    const maxCandidates = Number(pol.budget?.maxCandidates ?? 5);
    const capped = filtered.slice(0, maxCandidates);

    // Ensure unique by date
    const uniq = new Map<string, WindowCandidate>();
    for (const c of capped) {
      uniq.set(`${iso(c.trainStart)}_${iso(c.trainEnd)}`, c);
    }

    return { policy: pol, candidates: [...uniq.values()] };
  }
}
