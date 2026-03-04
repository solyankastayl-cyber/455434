/**
 * P9.2 — Brain Simulation Service
 * 
 * Walk-forward simulation: brain_off vs brain_on across date range.
 * Computes hit-rate, risk metrics, stability, verdict.
 */

import * as crypto from 'crypto';
import { BrainSimRunRequest, BrainSimReport, SimSample } from '../contracts/brain_sim.contract.js';
import { getBrainCompareService } from './brain_compare.service.js';
import { getMongoDb } from '../../../db/mongoose.js';

export class BrainSimulationService {

  /**
   * Run walk-forward simulation
   */
  async runSimulation(req: BrainSimRunRequest): Promise<BrainSimReport> {
    const { asset, start, end, stepDays, horizons, mode } = req;
    const id = `sim_${asset}_${crypto.randomBytes(4).toString('hex')}`;
    const compareService = getBrainCompareService();

    // Generate sample dates
    const dates = this.generateDates(start, end, stepDays);
    const nSteps = dates.length;

    console.log(`[BrainSim] Starting simulation: ${asset}, ${start}→${end}, ${nSteps} steps, step=${stepDays}d`);

    // Load price data for realized returns
    const priceMap = await this.loadPriceMap(asset, start, end, Math.max(...horizons));

    // Process each date
    const samples: SimSample[] = [];
    const offExposures: { spx: number; btc: number; cash: number }[] = [];
    const onExposures: { spx: number; btc: number; cash: number }[] = [];
    const scenarios: string[] = [];
    const overrideIntensities: number[] = [];

    for (const asOf of dates) {
      try {
        const compare = await compareService.compare(asOf);

        // Allocations
        offExposures.push({
          spx: compare.base.allocations.spxSize,
          btc: compare.base.allocations.btcSize,
          cash: compare.base.allocations.cashSize,
        });
        onExposures.push({
          spx: compare.brain.allocations.spxSize,
          btc: compare.brain.allocations.btcSize,
          cash: compare.brain.allocations.cashSize,
        });

        scenarios.push(compare.brain.decision.scenario);

        // Override intensity = sum of absolute deltas
        const intensity = Math.abs(compare.diff.allocationsDelta.spx) +
          Math.abs(compare.diff.allocationsDelta.btc) +
          Math.abs(compare.diff.allocationsDelta.cash);
        overrideIntensities.push(intensity);

        // Realized returns for each horizon
        const realized: Record<string, { horizon: number; return: number }> = {};
        for (const h of horizons) {
          const ret = this.getRealizedReturn(asOf, h, priceMap);
          realized[`${h}D`] = { horizon: h, return: ret };
        }

        samples.push({
          asOf,
          compare: {
            scenario: compare.brain.decision.scenario,
            delta: compare.diff.allocationsDelta,
            severity: compare.diff.severity,
            reasons: compare.diff.changed.flatMap(c => c.reasons).slice(0, 3),
            crossAssetLabel: compare.context.crossAsset?.label,
          },
          realized,
        });
      } catch (e) {
        console.warn(`[BrainSim] Skipped ${asOf}: ${(e as Error).message}`);
      }
    }

    if (samples.length === 0) {
      throw new Error('No valid simulation samples produced');
    }

    console.log(`[BrainSim] Processed ${samples.length}/${nSteps} steps`);

    // Compute metrics
    const metrics = this.computeMetrics(samples, horizons, offExposures, onExposures, scenarios, overrideIntensities, stepDays);

    // Compute verdict
    const verdict = this.computeVerdict(metrics, horizons);

    return {
      id,
      asset,
      window: { start, end, stepDays, nSteps: samples.length },
      horizons,
      metrics,
      samples,
      verdict,
    };
  }

  // ─────────────────────────────────────────────────────────
  // METRICS
  // ─────────────────────────────────────────────────────────

  private computeMetrics(
    samples: SimSample[],
    horizons: number[],
    offExposures: { spx: number; btc: number; cash: number }[],
    onExposures: { spx: number; btc: number; cash: number }[],
    scenarios: string[],
    overrideIntensities: number[],
    stepDays: number
  ): BrainSimReport['metrics'] {
    const n = samples.length;

    // Hit rate: how often the directional call was correct
    // brain_off: assume neutral (always expects positive for risk assets)
    // brain_on: use scenario (TAIL/RISK = expects negative)
    const hitRate_off: Record<string, number> = {};
    const hitRate_on: Record<string, number> = {};
    const deltaPp: Record<string, number> = {};

    for (const h of horizons) {
      const key = `${h}D`;
      let hitsOff = 0, hitsOn = 0, total = 0;

      for (const s of samples) {
        const ret = s.realized[key]?.return;
        if (ret === undefined || ret === 0) continue;
        total++;

        const actualSign = ret > 0 ? 1 : -1;

        // brain_off: always expects positive (default bullish for risk-on engine)
        const offSign = 1;
        if (offSign === actualSign) hitsOff++;

        // brain_on: TAIL/RISK expects negative, BASE expects positive
        const onSign = (s.compare.scenario === 'TAIL' || s.compare.scenario === 'RISK') ? -1 : 1;
        if (onSign === actualSign) hitsOn++;
      }

      hitRate_off[key] = total > 0 ? round3(hitsOff / total) : 0;
      hitRate_on[key] = total > 0 ? round3(hitsOn / total) : 0;
      deltaPp[key] = round3((hitRate_on[key] - hitRate_off[key]) * 100); // percentage points
    }

    // Average exposures
    const avgExposure_off = this.avgExposure(offExposures);
    const avgExposure_on = this.avgExposure(onExposures);

    // Stability: scenario flip rate
    let flips = 0;
    for (let i = 1; i < scenarios.length; i++) {
      if (scenarios[i] !== scenarios[i - 1]) flips++;
    }
    const yearsSpan = (n * stepDays) / 365;
    const brainFlipRate = yearsSpan > 0 ? round3(flips / yearsSpan) : 0;

    // Override intensity
    const avgOverrideIntensity = overrideIntensities.length > 0
      ? round3(overrideIntensities.reduce((a, b) => a + b, 0) / overrideIntensities.length)
      : 0;
    const maxOverrideIntensity = overrideIntensities.length > 0
      ? round3(Math.max(...overrideIntensities))
      : 0;

    // PnL proxy (simplified portfolio returns)
    const pnlProxy = this.computePnlProxy(samples, offExposures, onExposures, horizons[0] || 30);

    return {
      hitRate_off,
      hitRate_on,
      deltaPp,
      avgExposure_off,
      avgExposure_on,
      brainFlipRate,
      avgOverrideIntensity,
      maxOverrideIntensity,
      pnlProxy,
    };
  }

  private computePnlProxy(
    samples: SimSample[],
    offExposures: { spx: number; btc: number; cash: number }[],
    onExposures: { spx: number; btc: number; cash: number }[],
    shortHorizon: number
  ): BrainSimReport['metrics']['pnlProxy'] {
    const key = `${shortHorizon}D`;
    const returnsOff: number[] = [];
    const returnsOn: number[] = [];

    for (let i = 0; i < samples.length; i++) {
      const ret = samples[i].realized[key]?.return || 0;
      // Simplified: portfolio return = weighted average of asset returns
      // DXY return applies to both SPX/BTC inversely
      const offExp = offExposures[i] || { spx: 0.5, btc: 0.5, cash: 0 };
      const onExp = onExposures[i] || { spx: 0.5, btc: 0.5, cash: 0 };

      const riskReturn = ret; // proxy: DXY return as single factor
      returnsOff.push(riskReturn * (1 - offExp.cash));
      returnsOn.push(riskReturn * (1 - onExp.cash));
    }

    const maxDD_off = this.maxDrawdown(returnsOff);
    const maxDD_on = this.maxDrawdown(returnsOn);
    const vol_off = this.stdDev(returnsOff);
    const vol_on = this.stdDev(returnsOn);
    const meanOff = returnsOff.reduce((a, b) => a + b, 0) / (returnsOff.length || 1);
    const meanOn = returnsOn.reduce((a, b) => a + b, 0) / (returnsOn.length || 1);

    return {
      maxDD_off: round3(maxDD_off),
      maxDD_on: round3(maxDD_on),
      vol_off: round3(vol_off),
      vol_on: round3(vol_on),
      sharpe_off: vol_off > 0 ? round3(meanOff / vol_off) : 0,
      sharpe_on: vol_on > 0 ? round3(meanOn / vol_on) : 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // VERDICT
  // ─────────────────────────────────────────────────────────

  private computeVerdict(
    metrics: BrainSimReport['metrics'],
    horizons: number[]
  ): BrainSimReport['verdict'] {
    const gates: Record<string, { pass: boolean; value: number; threshold: number }> = {};
    const reasons: string[] = [];

    // Gate 1: deltaHitRateAny >= +2pp on at least 1 horizon
    let bestDelta = -Infinity;
    for (const h of horizons) {
      const key = `${h}D`;
      const d = metrics.deltaPp[key] || 0;
      if (d > bestDelta) bestDelta = d;
    }
    const deltaGate = bestDelta >= 2;
    gates['deltaHitRateAny'] = { pass: deltaGate, value: round3(bestDelta), threshold: 2 };
    if (!deltaGate) reasons.push(`No horizon has delta hit-rate >= +2pp (best: ${bestDelta.toFixed(1)}pp)`);

    // Gate 2: noDegradation < -1pp on any horizon
    let worstDelta = Infinity;
    for (const h of horizons) {
      const key = `${h}D`;
      const d = metrics.deltaPp[key] || 0;
      if (d < worstDelta) worstDelta = d;
    }
    const noDegGate = worstDelta >= -1;
    gates['noDegradation'] = { pass: noDegGate, value: round3(worstDelta), threshold: -1 };
    if (!noDegGate) reasons.push(`Degradation on some horizon: ${worstDelta.toFixed(1)}pp`);

    // Gate 3: brainFlipRate <= 6/year
    const flipGate = metrics.brainFlipRate <= 6;
    gates['brainFlipRate'] = { pass: flipGate, value: metrics.brainFlipRate, threshold: 6 };
    if (!flipGate) reasons.push(`Brain flips too fast: ${metrics.brainFlipRate}/year (max 6)`);

    // Gate 4: maxOverrideIntensity - scenario-dependent thresholds
    // BASE: 0.35, RISK: 0.45, TAIL: 0.60
    const OVERRIDE_THRESHOLDS: Record<string, number> = { BASE: 0.35, RISK: 0.45, TAIL: 0.60 };
    // Use the dominant scenario from samples to pick threshold
    const scenarioCount: Record<string, number> = {};
    for (const s of samples) {
      const sc = s.compare.scenario;
      scenarioCount[sc] = (scenarioCount[sc] || 0) + 1;
    }
    let dominantScenario = 'BASE';
    let maxCount = 0;
    for (const [sc, count] of Object.entries(scenarioCount)) {
      if (count > maxCount) { dominantScenario = sc; maxCount = count; }
    }
    const overrideThreshold = OVERRIDE_THRESHOLDS[dominantScenario] || 0.60;
    const intensityGate = metrics.maxOverrideIntensity <= overrideThreshold;
    gates['maxOverrideIntensity'] = { pass: intensityGate, value: metrics.maxOverrideIntensity, threshold: overrideThreshold };
    if (!intensityGate) reasons.push(`Override too aggressive: ${metrics.maxOverrideIntensity} (max ${overrideThreshold} for ${dominantScenario})`);

    const allPass = Object.values(gates).every(g => g.pass);
    if (allPass) reasons.push('All acceptance gates passed');

    return { ready: allPass, reasons, gates };
  }

  // ─────────────────────────────────────────────────────────
  // DATA HELPERS
  // ─────────────────────────────────────────────────────────

  private async loadPriceMap(
    asset: string,
    start: string,
    end: string,
    maxHorizon: number
  ): Promise<Map<string, number>> {
    const db = getMongoDb()!;
    const extendedEnd = this.addDays(end, maxHorizon + 30);
    const collection = asset === 'dxy' ? 'dxy_candles' : asset === 'spx' ? 'spx_candles' : 'fractal_canonical_ohlcv';

    const priceMap = new Map<string, number>();

    if (asset === 'btc') {
      const docs = await db.collection('fractal_canonical_ohlcv')
        .find({ 'meta.symbol': 'BTC', ts: { $gte: new Date(start), $lte: new Date(extendedEnd) } })
        .sort({ ts: 1 })
        .project({ _id: 0, ts: 1, 'ohlcv.c': 1 })
        .toArray();
      for (const d of docs) {
        if (d.ohlcv?.c > 0) {
          priceMap.set(new Date(d.ts).toISOString().split('T')[0], d.ohlcv.c);
        }
      }
    } else {
      const dateField = asset === 'spx' ? 'date' : 'date';
      const docs = await db.collection(collection)
        .find({ [dateField]: asset === 'dxy'
          ? { $gte: new Date(start), $lte: new Date(extendedEnd) }
          : { $gte: start, $lte: extendedEnd }
        })
        .sort({ [dateField]: 1 })
        .project({ _id: 0, [dateField]: 1, close: 1 })
        .toArray();
      for (const d of docs) {
        const dateStr = typeof d[dateField] === 'string'
          ? d[dateField]
          : new Date(d[dateField]).toISOString().split('T')[0];
        if (d.close > 0) priceMap.set(dateStr, d.close);
      }
    }

    return priceMap;
  }

  private getRealizedReturn(asOf: string, horizonDays: number, priceMap: Map<string, number>): number {
    const p0 = this.findNearestPrice(asOf, priceMap, 5);
    const targetDate = this.addDays(asOf, horizonDays);
    const p1 = this.findNearestPrice(targetDate, priceMap, 5);

    if (!p0 || !p1 || p0 <= 0) return 0;
    return Math.log(p1 / p0);
  }

  private findNearestPrice(dateStr: string, priceMap: Map<string, number>, tolerance: number): number | null {
    if (priceMap.has(dateStr)) return priceMap.get(dateStr)!;
    for (let d = 1; d <= tolerance; d++) {
      const before = this.addDays(dateStr, -d);
      if (priceMap.has(before)) return priceMap.get(before)!;
      const after = this.addDays(dateStr, d);
      if (priceMap.has(after)) return priceMap.get(after)!;
    }
    return null;
  }

  private generateDates(start: string, end: string, stepDays: number): string[] {
    const dates: string[] = [];
    let current = new Date(start);
    const endDate = new Date(end);
    const maxPoints = 200;

    while (current <= endDate && dates.length < maxPoints) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + stepDays);
    }

    return dates;
  }

  private addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }

  private avgExposure(exposures: { spx: number; btc: number; cash: number }[]): { spx: number; btc: number; cash: number } {
    if (exposures.length === 0) return { spx: 0, btc: 0, cash: 0 };
    const sum = exposures.reduce((a, e) => ({
      spx: a.spx + e.spx, btc: a.btc + e.btc, cash: a.cash + e.cash,
    }), { spx: 0, btc: 0, cash: 0 });
    const n = exposures.length;
    return {
      spx: round3(sum.spx / n),
      btc: round3(sum.btc / n),
      cash: round3(sum.cash / n),
    };
  }

  private maxDrawdown(returns: number[]): number {
    let peak = 0, maxDD = 0, cum = 0;
    for (const r of returns) {
      cum += r;
      if (cum > peak) peak = cum;
      const dd = peak - cum;
      if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
  }

  private stdDev(arr: number[]): number {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, v) => a + (v - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// Singleton
let instance: BrainSimulationService | null = null;

export function getBrainSimulationService(): BrainSimulationService {
  if (!instance) instance = new BrainSimulationService();
  return instance;
}
