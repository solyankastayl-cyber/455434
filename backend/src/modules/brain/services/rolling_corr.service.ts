/**
 * P9.0 — Rolling Correlation Service
 * 
 * Computes rolling Pearson correlations between asset returns.
 * Numerically stable: handles zero-variance, insufficient data.
 */

import { WindowSize, WINDOW_SIZES, CrossAssetCorrWindow } from '../contracts/cross_asset.contract.js';
import {
  CrossAssetReturnsService,
  CrossAssetId,
  ReturnPoint,
  getCrossAssetReturnsService,
} from './cross_asset_returns.service.js';

const ASSETS: CrossAssetId[] = ['btc', 'spx', 'dxy', 'gold'];

export class RollingCorrService {

  /**
   * Compute correlation windows for all asset pairs at asOf
   */
  async computeWindows(asOf: string): Promise<CrossAssetCorrWindow[]> {
    const returnsService = getCrossAssetReturnsService();

    // Need enough history for the largest window (120d) + margin
    const startDate = this.subtractDays(asOf, 250);

    // Load returns for all assets in parallel
    const [btcPrices, spxPrices, dxyPrices, goldPrices] = await Promise.all([
      returnsService.loadPrices('btc', startDate, asOf),
      returnsService.loadPrices('spx', startDate, asOf),
      returnsService.loadPrices('dxy', startDate, asOf),
      returnsService.loadPrices('gold', startDate, asOf),
    ]);

    const btcRet = returnsService.computeReturns(btcPrices);
    const spxRet = returnsService.computeReturns(spxPrices);
    const dxyRet = returnsService.computeReturns(dxyPrices);
    const goldRet = returnsService.computeReturns(goldPrices);

    const returnsMap: Record<CrossAssetId, ReturnPoint[]> = {
      btc: btcRet,
      spx: spxRet,
      dxy: dxyRet,
      gold: goldRet,
    };

    // Compute for each window size
    const windows: CrossAssetCorrWindow[] = [];

    for (const windowDays of WINDOW_SIZES) {
      const w = this.computeWindowCorrelations(returnsMap, windowDays, asOf, returnsService);
      windows.push(w);
    }

    return windows;
  }

  /**
   * Compute all pair correlations for a specific window
   */
  private computeWindowCorrelations(
    returnsMap: Record<CrossAssetId, ReturnPoint[]>,
    windowDays: WindowSize,
    asOf: string,
    returnsService: CrossAssetReturnsService
  ): CrossAssetCorrWindow {
    const cutoff = this.subtractDays(asOf, windowDays);

    // Filter returns to window
    const windowReturns: Record<CrossAssetId, ReturnPoint[]> = {
      btc: returnsMap.btc.filter(r => r.date >= cutoff && r.date <= asOf),
      spx: returnsMap.spx.filter(r => r.date >= cutoff && r.date <= asOf),
      dxy: returnsMap.dxy.filter(r => r.date >= cutoff && r.date <= asOf),
      gold: returnsMap.gold.filter(r => r.date >= cutoff && r.date <= asOf),
    };

    // Compute pair correlations
    const corrBtcSpx = this.computePairCorr(windowReturns.btc, windowReturns.spx, returnsService);
    const corrBtcDxy = this.computePairCorr(windowReturns.btc, windowReturns.dxy, returnsService);
    const corrSpxDxy = this.computePairCorr(windowReturns.spx, windowReturns.dxy, returnsService);
    const corrBtcGold = this.computePairCorr(windowReturns.btc, windowReturns.gold, returnsService);
    const corrSpxGold = this.computePairCorr(windowReturns.spx, windowReturns.gold, returnsService);
    const corrDxyGold = this.computePairCorr(windowReturns.dxy, windowReturns.gold, returnsService);

    // sampleN = minimum aligned pair count for core assets (BTC/SPX/DXY)
    const sampleN = Math.min(
      corrBtcSpx.n, corrBtcDxy.n, corrSpxDxy.n
    );

    return {
      windowDays,
      corr_btc_spx: corrBtcSpx.corr,
      corr_btc_dxy: corrBtcDxy.corr,
      corr_spx_dxy: corrSpxDxy.corr,
      corr_btc_gold: corrBtcGold.corr,
      corr_spx_gold: corrSpxGold.corr,
      corr_dxy_gold: corrDxyGold.corr,
      sampleN,
    };
  }

  /**
   * Compute Pearson correlation between two return series (aligned by date)
   */
  private computePairCorr(
    a: ReturnPoint[],
    b: ReturnPoint[],
    returnsService: CrossAssetReturnsService
  ): { corr: number; n: number } {
    const aligned = returnsService.alignReturns(a, b);
    const n = aligned.dates.length;

    if (n < 5) return { corr: 0, n };

    return { corr: pearsonCorr(aligned.aRet, aligned.bRet), n };
  }

  private subtractDays(dateStr: string, days: number): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  }
}

// ═══════════════════════════════════════════════════════════════
// PEARSON CORRELATION (numerically stable)
// ═══════════════════════════════════════════════════════════════

export function pearsonCorr(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;

  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += x[i]; sumY += y[i]; }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const denom = Math.sqrt(varX * varY);
  if (denom < 1e-12) return 0; // zero variance guard

  const corr = cov / denom;
  return Math.max(-1, Math.min(1, Math.round(corr * 1000) / 1000));
}

// Singleton
let instance: RollingCorrService | null = null;

export function getRollingCorrService(): RollingCorrService {
  if (!instance) {
    instance = new RollingCorrService();
  }
  return instance;
}
