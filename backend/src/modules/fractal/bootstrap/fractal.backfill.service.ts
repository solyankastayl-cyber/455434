/**
 * BLOCK 29: Dataset Backfill Service
 * Generates ML training data by walking through historical candles
 */

import { CanonicalStore } from '../data/canonical.store.js';
import { WindowStore } from '../data/window.store.js';
import { FeatureExtractor } from '../engine/feature.extractor.js';
import { RegimeEngine } from '../engine/regime.engine.js';

interface BackfillConfig {
  symbol: string;
  windowLen: number;
  horizonDays: number;
  topK: number;
  minGapDays: number;
  stepDays: number;  // how many days to skip between samples
  startDate?: Date;
  endDate?: Date;
}

export class FractalBackfillService {
  private canonical = new CanonicalStore();
  private windows = new WindowStore();
  private features = new FeatureExtractor();
  private regime = new RegimeEngine();

  async backfill(config: BackfillConfig): Promise<{
    created: number;
    labeled: number;
    skipped: number;
  }> {
    const series = await this.canonical.getSeriesWithQuality(
      config.symbol,
      '1d'
    );

    const ts = series.map(x => x.ts);
    const closes = series.map(x => x.close);
    const quality = series.map(x => x.quality);

    console.log(`[Backfill] Loaded ${closes.length} candles`);

    if (closes.length < config.windowLen + config.horizonDays + config.minGapDays + 60) {
      return { created: 0, labeled: 0, skipped: 0 };
    }

    let created = 0;
    let labeled = 0;
    let skipped = 0;

    // Walk through history
    for (
      let i = config.windowLen + config.minGapDays;
      i < closes.length - config.horizonDays;
      i += config.stepDays
    ) {
      const currentTs = ts[i];

      if (config.startDate && currentTs < config.startDate) continue;
      if (config.endDate && currentTs > config.endDate) continue;

      // Get regime at this point
      const regimeInfo = this.regime.buildHistoricalRegime(closes, i);

      // Find similar patterns and calculate forward stats
      const { matches, forwardStats } = await this.findMatches({
        closes,
        ts,
        quality,
        endIdx: i,
        windowLen: config.windowLen,
        horizonDays: config.horizonDays,
        topK: config.topK,
        minGapDays: config.minGapDays
      });

      if (!forwardStats || matches.length < 5) {
        skipped++;
        continue;
      }

      // Extract window data
      const windowStart = i - config.windowLen;
      const windowPrices = closes.slice(windowStart, i + 1);
      const windowQuality = quality.slice(windowStart, i + 1);

      // Extract features
      const windowFeatures = this.features.extract({
        closesWindow: windowPrices,
        qualityWindow: windowQuality,
        regimeVol: this.features.encodeVolRegime(regimeInfo?.volatility ?? 'NORMAL_VOL'),
        regimeTrend: this.features.encodeTrendRegime(regimeInfo?.trend ?? 'SIDEWAYS'),
        topMatchScore: matches[0]?.score ?? 0,
        avgTopKScore: matches.length > 0 
          ? matches.reduce((s, m) => s + m.score, 0) / matches.length 
          : 0,
        regimeConsistency: 0.5,
        effectiveSampleSize: matches.length
      });

      // Calculate actual forward return for labeling
      const futureIdx = i + config.horizonDays;
      const forwardReturn = (closes[futureIdx] / closes[i]) - 1;

      // Calculate forward vol and maxDD
      const futurePrices = closes.slice(i, futureIdx + 1);
      const futureLogRets = [];
      for (let j = 1; j < futurePrices.length; j++) {
        futureLogRets.push(Math.log(futurePrices[j] / futurePrices[j - 1]));
      }
      const forwardVol = this.std(futureLogRets);
      const forwardMaxDD = this.maxDD(futurePrices);

      // Create window document
      const doc = {
        meta: {
          symbol: config.symbol,
          timeframe: '1d',
          windowLen: config.windowLen,
          horizonDays: config.horizonDays
        },
        windowEndTs: currentTs,
        features: {
          ...windowFeatures,
          regimeVol: regimeInfo?.volatility === 'HIGH_VOL' ? 1 : regimeInfo?.volatility === 'LOW_VOL' ? -1 : 0,
          regimeTrend: regimeInfo?.trend === 'UP_TREND' ? 1 : regimeInfo?.trend === 'DOWN_TREND' ? -1 : 0,
          topMatchScore: matches[0]?.score ?? 0,
          avgTopKScore: matches.length > 0 
            ? matches.reduce((s, m) => s + m.score, 0) / matches.length 
            : 0
        },
        prediction: {
          p50Return: forwardStats.p50,
          p10Return: forwardStats.p10,
          p90Return: forwardStats.p90,
          impliedDirection: forwardStats.implied,
          matchCount: matches.length
        },
        label: {
          ready: true,
          forwardReturn,
          forwardVol,
          forwardMaxDD,
          labeledAt: new Date()
        },
        createdAt: new Date()
      };

      await this.windows.upsertWindow(doc);
      created++;
      labeled++;
    }

    console.log(`[Backfill] Created ${created} windows, labeled ${labeled}, skipped ${skipped}`);

    return { created, labeled, skipped };
  }

  private async findMatches(params: {
    closes: number[];
    ts: Date[];
    quality: number[];
    endIdx: number;
    windowLen: number;
    horizonDays: number;
    topK: number;
    minGapDays: number;
  }): Promise<{
    matches: { idx: number; score: number }[];
    forwardStats: { p10: number; p50: number; p90: number; implied: string } | null;
  }> {
    const { closes, endIdx, windowLen, topK, minGapDays, horizonDays } = params;

    // Build log returns for current window
    const windowStart = endIdx - windowLen;
    if (windowStart < 0) return { matches: [], forwardStats: null };

    const logReturns: number[] = [];
    for (let j = windowStart + 1; j <= endIdx; j++) {
      logReturns.push(Math.log(closes[j] / closes[j - 1]));
    }

    // Z-score normalize
    const mean = logReturns.reduce((s, x) => s + x, 0) / logReturns.length;
    const variance = logReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / (logReturns.length - 1);
    const std = Math.sqrt(variance) || 0.01;
    const curWindow = logReturns.map(x => (x - mean) / std);

    let curNorm = 0;
    for (const v of curWindow) curNorm += v * v;
    curNorm = Math.sqrt(curNorm) || 1;

    // Find matches
    const candidates: { idx: number; score: number }[] = [];
    const maxLookback = endIdx - windowLen - minGapDays;

    for (let histEnd = windowLen; histEnd < maxLookback; histEnd++) {
      const histStart = histEnd - windowLen;

      const histReturns: number[] = [];
      for (let j = histStart + 1; j <= histEnd; j++) {
        histReturns.push(Math.log(closes[j] / closes[j - 1]));
      }

      const hMean = histReturns.reduce((s, x) => s + x, 0) / histReturns.length;
      const hVariance = histReturns.reduce((s, x) => s + (x - hMean) ** 2, 0) / (histReturns.length - 1);
      const hStd = Math.sqrt(hVariance) || 0.01;
      const histWindow = histReturns.map(x => (x - hMean) / hStd);

      let dot = 0, histNorm = 0;
      for (let k = 0; k < curWindow.length && k < histWindow.length; k++) {
        dot += curWindow[k] * histWindow[k];
        histNorm += histWindow[k] * histWindow[k];
      }
      histNorm = Math.sqrt(histNorm) || 1;

      const score = dot / (curNorm * histNorm + 1e-12);
      if (score > 0.3) {
        candidates.push({ idx: histEnd, score });
      }
    }

    if (candidates.length < 5) return { matches: [], forwardStats: null };

    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, topK);

    // Calculate forward returns
    const forwardReturns: number[] = [];
    for (const m of top) {
      const fwdIdx = m.idx + horizonDays;
      if (fwdIdx < endIdx - minGapDays) {
        forwardReturns.push(closes[fwdIdx] / closes[m.idx] - 1);
      }
    }

    if (forwardReturns.length < 3) return { matches: top, forwardStats: null };

    forwardReturns.sort((a, b) => a - b);
    const p10 = forwardReturns[Math.floor(forwardReturns.length * 0.1)];
    const p50 = forwardReturns[Math.floor(forwardReturns.length * 0.5)];
    const p90 = forwardReturns[Math.floor(forwardReturns.length * 0.9)];

    let implied = 'MIXED';
    if (p10 > 0 && p90 > 0) implied = 'UP';
    else if (p10 < 0 && p90 < 0) implied = 'DOWN';

    return {
      matches: top,
      forwardStats: { p10, p50, p90, implied }
    };
  }

  private std(arr: number[]): number {
    if (arr.length < 2) return 0;
    const m = arr.reduce((s, x) => s + x, 0) / arr.length;
    let v = 0;
    for (const x of arr) v += (x - m) ** 2;
    return Math.sqrt(v / (arr.length - 1));
  }

  private maxDD(prices: number[]): number {
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
}
