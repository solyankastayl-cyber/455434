/**
 * BLOCK 19: Fractal Labeler Service
 * Resolves labels (y) after horizon passes
 */

import { CanonicalStore } from '../data/canonical.store.js';
import { WindowStore } from '../data/window.store.js';

const ONE_DAY = 86400000;

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let v = 0;
  for (const x of arr) {
    const d = x - m;
    v += d * d;
  }
  return Math.sqrt(v / (arr.length - 1)) || 0;
}

function maxDD(prices: number[]): number {
  if (prices.length === 0) return 0;
  let peak = prices[0];
  let maxdd = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = p / peak - 1;
    if (dd < maxdd) maxdd = dd;
  }
  return maxdd;
}

// ═══════════════════════════════════════════════════════════════
// LABELER SERVICE
// ═══════════════════════════════════════════════════════════════

export class FractalLabelerService {
  private canonical = new CanonicalStore();
  private windows = new WindowStore();

  /**
   * Update labels for windows where horizon has passed
   */
  async updateLabels(limit = 200): Promise<{ updated: number; skipped: number; errors: number }> {
    const pending = await this.windows.findUnlabeled(limit);
    
    if (!pending.length) {
      return { updated: 0, skipped: 0, errors: 0 };
    }

    // Load full series once
    const series = await this.canonical.getClosePrices('BTC', '1d');
    const ts = series.map(x => x.ts);
    const closes = series.map(x => x.close);

    const now = Date.now();
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const w of pending) {
      try {
        const horizonEnd = w.label?.horizonEndTs 
          ? new Date(w.label.horizonEndTs).getTime() 
          : null;

        // Skip if horizon hasn't passed yet (with 1 day buffer)
        if (!horizonEnd || horizonEnd > now - ONE_DAY) {
          skipped++;
          await this.windows.markChecked((w as any)._id);
          continue;
        }

        const endIdx = this.findIndexByTs(ts, new Date(w.windowEndTs));
        const horizonDays = w.meta?.horizonDays ?? 30;
        const horizonEndIdx = endIdx + horizonDays;

        // Skip if we don't have enough data
        if (horizonEndIdx >= closes.length) {
          skipped++;
          await this.windows.markChecked((w as any)._id);
          continue;
        }

        // Calculate realized metrics
        const entry = closes[endIdx];
        const exit = closes[horizonEndIdx];
        const forwardReturn = exit / entry - 1;

        const forwardSegment = closes.slice(endIdx, horizonEndIdx + 1);
        const forwardMaxDD = maxDD(forwardSegment);

        // Forward volatility (std of log returns in forward period)
        const r: number[] = [];
        for (let i = endIdx + 1; i <= horizonEndIdx; i++) {
          r.push(Math.log(closes[i] / closes[i - 1]));
        }
        const forwardVol = std(r);

        // Update label
        await this.windows.setLabel((w as any)._id, {
          ready: true,
          horizonEndTs: new Date(horizonEnd),
          forwardReturn,
          forwardMaxDD,
          forwardVol
        });

        updated++;
      } catch (err) {
        console.error('[FractalLabeler] Error processing window:', err);
        errors++;
      }
    }

    return { updated, skipped, errors };
  }

  /**
   * Binary search to find index by timestamp
   */
  private findIndexByTs(ts: Date[], target: Date): number {
    const t = target.getTime();
    let lo = 0, hi = ts.length - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const mt = ts[mid].getTime();
      if (mt === t) return mid;
      if (mt < t) lo = mid + 1;
      else hi = mid - 1;
    }

    return Math.max(0, hi);
  }
}
