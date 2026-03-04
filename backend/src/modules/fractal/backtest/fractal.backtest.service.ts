/**
 * BLOCK 24 + 29.16-29.19: Shadow Backtest Engine
 * Walk-forward simulation with:
 * - Transaction costs (29.16)
 * - Volatility targeting (29.17)
 * - DD taper / kill switch (29.18)
 * - Regime exposure map (29.19)
 */

import { CanonicalStore } from '../data/canonical.store.js';
import { RegimeEngine } from '../engine/regime.engine.js';
import { FractalSettingsModel } from '../data/schemas/fractal-settings.schema.js';
import { FractalMLService } from '../bootstrap/fractal.ml.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface BacktestConfig {
  symbol: string;
  timeframe?: string;
  windowLen: number;
  horizonDays: number;
  minGapDays: number;
  topK: number;
  startDate?: Date;
  endDate?: Date;
  mlVersion?: string;
  // Risk params override
  applyCosts?: boolean;
  applyVolTarget?: boolean;
  applyDDTaper?: boolean;
  applyRegimeExposure?: boolean;
}

export interface BacktestResult {
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  maxDrawdown: number;
  maxDD: number;
  sharpe: number;
  cagr: number;
  avgLeverage?: number;
  avgVolAnn?: number;
  avgRegimeMult?: number;
  totalCosts?: number;
  equityCurve: { ts: Date; equity: number }[];
  regimeReport: RegimeReportRow[];
  warnings?: string[];
  positionLifecycle?: {
    enterThr: number;
    exitThr: number;
    minHold: number;
    maxHold: number;
    flipAllowed: boolean;
    flipThr: number;
    cdDays: number;
    tradesOpened: number;
    equityFinal: number;
  };
}

export interface RegimeReportRow {
  trend: string;
  vol: string;
  count: number;
  hitRate: number;
  avgReturn: number;
  sharpe: number;
  maxDD: number;
}

interface Trade {
  ts: Date;
  tradeReturn: number;
  grossReturn: number;
  implied: 'UP' | 'DOWN' | 'MIXED';
  vol: string;
  trend: string;
  hit: boolean;
  leverage: number;
  cost: number;
}

interface Settings {
  costModel?: {
    feeBps?: number;
    slippageBps?: number;
    spreadBps?: number;
  };
  riskModel?: {
    volTargetAnnual?: number;
    maxLeverage?: number;
    minLeverage?: number;
    volLookbackDays?: number;
  };
  ddModel?: {
    softDD?: number;
    hardDD?: number;
    minMult?: number;
    taperPower?: number;
  };
  regimeExposure?: {
    enabled?: boolean;
    defaults?: Record<string, number>;
    overrides?: { trend: string; vol: string; mult: number }[];
  };
}

// ═══════════════════════════════════════════════════════════════
// BACKTEST SERVICE
// ═══════════════════════════════════════════════════════════════

export class FractalBacktestService {
  private canonical = new CanonicalStore();
  private regime = new RegimeEngine();
  private ml = new FractalMLService();

  async run(config: BacktestConfig): Promise<BacktestResult> {
    const timeframe = config.timeframe ?? '1d';
    const series = await this.canonical.getSeriesWithQuality(config.symbol, timeframe);

    const ts = series.map(x => x.ts);
    const closes = series.map(x => x.close);
    const quality = series.map(x => x.quality);

    if (closes.length < config.windowLen + config.horizonDays + config.minGapDays) {
      return this.emptyResult();
    }

    // Load settings
    const settings = await FractalSettingsModel.findOne({ symbol: config.symbol }).lean() as Settings | null;

    // Cost model (BLOCK 29.16)
    const applyCosts = config.applyCosts ?? true;
    const feeBps = settings?.costModel?.feeBps ?? 4;
    const slippageBps = settings?.costModel?.slippageBps ?? 6;
    const spreadBps = settings?.costModel?.spreadBps ?? 2;
    const roundTripCost = applyCosts ? 2 * (feeBps + slippageBps + spreadBps) / 10000 : 0;

    // Vol targeting (BLOCK 29.17)
    const applyVolTarget = config.applyVolTarget ?? true;
    const volTarget = settings?.riskModel?.volTargetAnnual ?? 0.6;
    const maxLev = settings?.riskModel?.maxLeverage ?? 2.0;
    const minLev = settings?.riskModel?.minLeverage ?? 0.0;
    const volLookback = settings?.riskModel?.volLookbackDays ?? 60;

    // DD model (BLOCK 29.18)
    const applyDDTaper = config.applyDDTaper ?? true;

    // Regime exposure (BLOCK 29.19)
    const applyRegimeExposure = config.applyRegimeExposure ?? true;

    // BLOCK 29.20: Position lifecycle settings
    const positionModel = settings?.positionModel as any;
    const enterThr = Number(positionModel?.enterThreshold ?? 0.20);
    const exitThr = Number(positionModel?.exitThreshold ?? 0.10);
    const minHold = Number(positionModel?.minHoldDays ?? 10);
    const maxHold = Number(positionModel?.maxHoldDays ?? 45);
    const flipAllowed = !!(positionModel?.flipAllowed ?? true);
    const flipThr = Number(positionModel?.flipThreshold ?? 0.35);
    const cdDays = Number(positionModel?.coolDownDays ?? 5);

    const results: number[] = [];
    const trades: Trade[] = [];
    const equityCurve: { ts: Date; equity: number }[] = [];
    let equity = 1;
    let peakEquity = 1;
    let skipped = 0;
    let matched = 0;
    let levSum = 0;
    let volSum = 0;
    let regimeMultSum = 0;
    let costSum = 0;
    let levCount = 0;

    // BLOCK 29.20.7: In-memory position machine
    type Side = 'FLAT' | 'LONG' | 'SHORT';
    let posSide: Side = 'FLAT';
    let posSize = 0;
    let entryIdx = -1;
    let coolDownUntilIdx = -1;
    let tradeCount = 0;
    let wins = 0;

    function desiredSideFromSignal(sig: 'LONG' | 'SHORT' | 'NEUTRAL'): Side {
      if (sig === 'LONG') return 'LONG';
      if (sig === 'SHORT') return 'SHORT';
      return 'FLAT';
    }

    // Walk-forward loop (step every day for position lifecycle)
    const stepDays = 7; // sample every 7 days for efficiency
    for (
      let i = config.windowLen + config.minGapDays;
      i < closes.length - config.horizonDays;
      i += stepDays
    ) {
      const currentTs = ts[i];

      if (config.startDate && currentTs < config.startDate) continue;
      if (config.endDate && currentTs > config.endDate) continue;

      // Get match at this historical point
      const match = await this.matchAtIndex({
        closes,
        ts,
        quality,
        endIdx: i,
        windowLen: config.windowLen,
        horizonDays: config.horizonDays,
        topK: config.topK,
        minGapDays: config.minGapDays,
        mlVersion: config.mlVersion
      });

      if (!match) {
        skipped++;
        // Still apply step PnL if position is open
        if (posSide !== 'FLAT' && i + stepDays < closes.length) {
          const stepReturn = closes[i + stepDays] / closes[i] - 1;
          let stepPnl = 0;
          if (posSide === 'LONG') stepPnl = stepReturn * posSize;
          else if (posSide === 'SHORT') stepPnl = -stepReturn * posSize;
          equity *= (1 + stepPnl);
          if (equity > peakEquity) peakEquity = equity;
        }
        continue;
      }

      matched++;

      // Calculate DD (BLOCK 29.18)
      if (equity > peakEquity) peakEquity = equity;
      const ddAbs = peakEquity > 0 ? (1 - equity / peakEquity) : 0;
      const ddMult = applyDDTaper ? this.ddMultiplier(ddAbs, settings?.ddModel) : 1.0;

      // Calculate volatility and leverage (BLOCK 29.17)
      let lev = 1.0;
      let volAnn = 0;
      
      if (applyVolTarget) {
        volAnn = this.realizedVolAnnualized(closes, i, volLookback);
        lev = volAnn > 0 ? (volTarget / volAnn) : 1.0;
        lev = Math.max(minLev, Math.min(maxLev, lev));
      }

      // Apply regime exposure (BLOCK 29.19)
      const currentRegime = match.regime;
      const regimeMult = applyRegimeExposure 
        ? this.regimeMultiplier(currentRegime, settings?.regimeExposure)
        : 1.0;

      // Final exposure
      const exposure = lev * ddMult * regimeMult;

      // Determine signal - for MIXED, use p50 to decide direction
      let sig: 'LONG' | 'SHORT' | 'NEUTRAL';
      if (match.implied === 'UP') {
        sig = 'LONG';
      } else if (match.implied === 'DOWN') {
        sig = 'SHORT';
      } else {
        // MIXED: use p50 threshold
        if (match.p50Return > 0.02) sig = 'LONG';
        else if (match.p50Return < -0.02) sig = 'SHORT';
        else sig = 'NEUTRAL';
      }
      
      // Confidence: scale p50Return to 0-1 range (typical p50 is -0.2 to +0.2)
      const confidence = Math.min(1, Math.max(0, Math.abs(match.p50Return) * 3 + 0.15));

      // Cooldown check
      const inCooldown = i <= coolDownUntilIdx;
      const holdSteps = entryIdx >= 0 ? Math.floor((i - entryIdx) / stepDays) * stepDays : 0;
      const desired = desiredSideFromSignal(sig);

      // BLOCK 29.20.7: Position lifecycle actions
      let action: 'NONE' | 'ENTER' | 'EXIT' | 'FLIP' | 'RESIZE' | 'FORCE_EXIT_MAXHOLD' = 'NONE';

      // Force exit by max hold
      if (posSide !== 'FLAT' && maxHold > 0 && holdSteps >= maxHold) {
        action = 'FORCE_EXIT_MAXHOLD';
      }

      // Normal exit (after minHold)
      if (action === 'NONE' && posSide !== 'FLAT' && holdSteps >= minHold) {
        if (desired === 'FLAT' || confidence < exitThr) {
          action = 'EXIT';
        }
      }

      // Flip
      if (action === 'NONE' && posSide !== 'FLAT' && flipAllowed) {
        if (!inCooldown && desired !== 'FLAT' && desired !== posSide) {
          const flipPenalty = 2 * roundTripCost;
          const effective = confidence - flipPenalty;
          if (effective >= flipThr) action = 'FLIP';
        }
      }

      // Enter
      if (action === 'NONE' && posSide === 'FLAT') {
        if (!inCooldown && desired !== 'FLAT' && confidence >= enterThr && exposure > 0 && ddMult > 0) {
          action = 'ENTER';
        }
      }

      // Resize
      if (action === 'NONE' && posSide !== 'FLAT' && desired === posSide) {
        if (Math.abs(exposure - posSize) >= 0.15) action = 'RESIZE';
      }

      // Apply actions and costs
      if (action === 'ENTER') {
        posSide = desired;
        posSize = exposure;
        entryIdx = i;
        tradeCount++;
        // Entry cost
        const entryCost = roundTripCost / 2 * posSize;
        equity *= (1 - entryCost);
        costSum += entryCost;
        if (cdDays > 0) coolDownUntilIdx = i + cdDays;
      }

      if (action === 'EXIT' || action === 'FORCE_EXIT_MAXHOLD') {
        // Exit cost
        const exitCost = roundTripCost / 2 * posSize;
        equity *= (1 - exitCost);
        costSum += exitCost;
        posSide = 'FLAT';
        posSize = 0;
        entryIdx = -1;
        if (cdDays > 0) coolDownUntilIdx = i + cdDays;
      }

      if (action === 'FLIP') {
        // Flip cost = exit + enter
        const flipCost = roundTripCost * posSize;
        equity *= (1 - flipCost);
        costSum += flipCost;
        posSide = desired;
        posSize = exposure;
        entryIdx = i;
        tradeCount++;
        if (cdDays > 0) coolDownUntilIdx = i + cdDays;
      }

      if (action === 'RESIZE') {
        posSize = exposure;
      }

      // Apply step PnL (only if position open)
      if (i + stepDays < closes.length) {
        const stepReturn = closes[i + stepDays] / closes[i] - 1;
        let stepPnl = 0;
        if (posSide === 'LONG') stepPnl = stepReturn * posSize;
        else if (posSide === 'SHORT') stepPnl = -stepReturn * posSize;

        equity *= (1 + stepPnl);

        if (posSide !== 'FLAT') {
          results.push(stepPnl);
          if (stepPnl > 0) wins++;
        }
      }

      // DD tracking
      if (equity > peakEquity) peakEquity = equity;

      equityCurve.push({ ts: currentTs, equity });

      const implied = match.implied;
      const realized = i + config.horizonDays < closes.length 
        ? closes[i + config.horizonDays] / closes[i] - 1 
        : 0;
      const hit = (implied === 'UP' && realized >= 0) || (implied === 'DOWN' && realized < 0);

      trades.push({
        ts: currentTs,
        tradeReturn: results[results.length - 1] ?? 0,
        grossReturn: 0,
        implied,
        vol: currentRegime?.volatility ?? 'NORMAL_VOL',
        trend: currentRegime?.trend ?? 'SIDEWAYS',
        hit,
        leverage: exposure,
        cost: 0
      });

      levSum += exposure;
      volSum += volAnn;
      regimeMultSum += regimeMult;
      levCount++;
    }

    const stats = this.computeStats(results, equityCurve, config.horizonDays);
    const regimeReport = this.computeRegimeReport(trades, config.horizonDays);

    // Save bad regimes to settings
    const badRegimes = this.deriveBadRegimes(regimeReport);
    await FractalSettingsModel.updateOne(
      { symbol: config.symbol },
      { $set: { badRegimes, updatedAt: new Date() } },
      { upsert: true }
    );

    // Warnings
    const warnings: string[] = [];
    if (levCount > 0) {
      const avgLev = levSum / levCount;
      const avgVol = volSum / levCount;
      if (avgLev > 1.6) warnings.push('AVG_LEVERAGE_HIGH');
      if (avgVol < 0.2 && applyVolTarget) warnings.push('VOL_ESTIMATE_LOW');
    }

    return {
      ...stats,
      avgLeverage: levCount > 0 ? levSum / levCount : undefined,
      avgVolAnn: levCount > 0 ? volSum / levCount : undefined,
      avgRegimeMult: levCount > 0 ? regimeMultSum / levCount : undefined,
      totalCosts: costSum,
      regimeReport,
      warnings: warnings.length > 0 ? warnings : undefined,
      positionLifecycle: {
        enterThr,
        exitThr,
        minHold,
        maxHold,
        flipAllowed,
        flipThr,
        cdDays,
        tradesOpened: tradeCount,
        equityFinal: equity
      }
    };
  }

  /**
   * BLOCK 29.17: Calculate realized volatility (annualized)
   */
  private realizedVolAnnualized(closes: number[], endIdx: number, lookback: number): number {
    const start = Math.max(1, endIdx - lookback);
    const rets: number[] = [];
    
    for (let i = start; i <= endIdx; i++) {
      const ret = Math.log(closes[i] / closes[i - 1]);
      rets.push(ret);
    }

    if (rets.length < 10) return 0;

    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
    const dailyStd = Math.sqrt(variance);

    // Annualize (365 for crypto)
    return dailyStd * Math.sqrt(365);
  }

  /**
   * BLOCK 29.18: DD multiplier with taper
   */
  private ddMultiplier(ddAbs: number, ddModel?: Settings['ddModel']): number {
    const soft = ddModel?.softDD ?? 0.12;
    const hard = ddModel?.hardDD ?? 0.25;
    const minMult = ddModel?.minMult ?? 0.15;
    const power = ddModel?.taperPower ?? 1.5;

    if (ddAbs <= soft) return 1.0;
    if (ddAbs >= hard) return 0.0; // Kill switch

    const x = (ddAbs - soft) / (hard - soft);
    const tapered = 1 - Math.pow(x, power);
    return minMult + (1 - minMult) * tapered;
  }

  /**
   * BLOCK 29.19: Regime exposure multiplier
   */
  private regimeMultiplier(
    regime: { trend: string; volatility: string } | null,
    config?: Settings['regimeExposure']
  ): number {
    if (!config?.enabled) return 1.0;
    if (!regime) return 1.0;

    const { trend, volatility: vol } = regime;

    // Check overrides first
    const override = config.overrides?.find(o => o.trend === trend && o.vol === vol);
    if (override?.mult != null) return override.mult;

    // Use defaults
    const defaults = config.defaults ?? {};
    const trendMult = defaults[trend] ?? 1.0;
    const volMult = defaults[vol] ?? 1.0;

    return trendMult * volMult;
  }

  /**
   * Match at specific historical index (no look-ahead)
   */
  private async matchAtIndex(params: {
    closes: number[];
    ts: Date[];
    quality: number[];
    endIdx: number;
    windowLen: number;
    horizonDays: number;
    topK: number;
    minGapDays: number;
    mlVersion?: string;
  }): Promise<{
    implied: 'UP' | 'DOWN' | 'MIXED';
    regime: { trend: string; volatility: string } | null;
    p50Return: number;
  } | null> {
    const { closes, endIdx, windowLen, topK, minGapDays, horizonDays, mlVersion } = params;

    const windowStart = endIdx - windowLen;
    if (windowStart < 0) return null;

    // Build log returns for current window
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

    // Find matches in history
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

    if (candidates.length < 5) return null;

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

    if (forwardReturns.length < 3) return null;

    forwardReturns.sort((a, b) => a - b);
    const p10 = forwardReturns[Math.floor(forwardReturns.length * 0.1)];
    const p50 = forwardReturns[Math.floor(forwardReturns.length * 0.5)];
    const p90 = forwardReturns[Math.floor(forwardReturns.length * 0.9)];

    const regime = this.regime.buildHistoricalRegime(closes, endIdx);
    const vol = std;

    // Determine implied direction
    let implied: 'UP' | 'DOWN' | 'MIXED' = 'MIXED';

    if (mlVersion) {
      const features: Record<string, number> = {
        rule_p50: p50,
        rule_p10: p10,
        rule_p90: p90,
        meanLogRet: mean,
        volLogRet: vol,
        regimeVol: regime?.volatility === 'HIGH_VOL' ? 1 : regime?.volatility === 'LOW_VOL' ? -1 : 0,
        regimeTrend: regime?.trend === 'UP_TREND' ? 1 : regime?.trend === 'DOWN_TREND' ? -1 : 0
      };

      const mlPred = await this.ml.predict('BTC', features, mlVersion);

      if (mlPred) {
        const ruleSignal = Math.max(-0.5, Math.min(0.5, p50)) * 2;
        const mlSignal = (mlPred.probUp - 0.5) * 2;
        const ensembleScore = 0.5 * ruleSignal + 0.5 * mlSignal;

        if (ensembleScore > 0.1) implied = 'UP';
        else if (ensembleScore < -0.1) implied = 'DOWN';
      } else {
        if (p10 > 0 && p90 > 0) implied = 'UP';
        else if (p10 < 0 && p90 < 0) implied = 'DOWN';
      }
    } else {
      if (p10 > 0 && p90 > 0) implied = 'UP';
      else if (p10 < 0 && p90 < 0) implied = 'DOWN';
    }

    return { implied, regime, p50Return: p50 };
  }

  private computeStats(
    returns: number[],
    equityCurve: { ts: Date; equity: number }[],
    horizonDays: number
  ): Omit<BacktestResult, 'regimeReport' | 'equityCurve' | 'warnings' | 'avgLeverage' | 'avgVolAnn' | 'avgRegimeMult' | 'totalCosts'> & { equityCurve: { ts: Date; equity: number }[] } {
    const totalTrades = returns.length;

    if (totalTrades === 0) {
      const empty = this.emptyResult();
      return {
        totalTrades: 0,
        winRate: 0,
        avgReturn: 0,
        maxDrawdown: 0,
        maxDD: 0,
        sharpe: 0,
        cagr: 0,
        equityCurve: []
      };
    }

    const winRate = returns.filter(r => r > 0).length / totalTrades;
    const avgReturn = returns.reduce((s, r) => s + r, 0) / totalTrades;
    const maxDrawdown = this.calculateMaxDD(equityCurve);

    const dailyReturns: number[] = [];
    for (const r of returns) {
      const dr = Math.pow(1 + r, 1 / horizonDays) - 1;
      for (let k = 0; k < horizonDays; k++) {
        dailyReturns.push(dr);
      }
    }
    const sharpe = this.calculateSharpe(dailyReturns);

    let cagr = 0;
    if (equityCurve.length >= 2) {
      const first = equityCurve[0];
      const last = equityCurve[equityCurve.length - 1];
      const days = (last.ts.getTime() - first.ts.getTime()) / (1000 * 60 * 60 * 24);
      if (days > 0) {
        cagr = Math.pow(last.equity / first.equity, 365 / days) - 1;
      }
    }

    return {
      totalTrades,
      winRate,
      avgReturn,
      maxDrawdown,
      maxDD: maxDrawdown,
      sharpe,
      cagr,
      equityCurve
    };
  }

  private computeRegimeReport(trades: Trade[], horizonDays: number): RegimeReportRow[] {
    const groups = new Map<string, {
      trend: string;
      vol: string;
      count: number;
      hits: number;
      sum: number;
      rets: number[];
      equity: number[];
    }>();

    for (const t of trades) {
      const k = `${t.trend}__${t.vol}`;
      if (!groups.has(k)) {
        groups.set(k, {
          trend: t.trend,
          vol: t.vol,
          count: 0,
          hits: 0,
          sum: 0,
          rets: [],
          equity: [1]
        });
      }
      const g = groups.get(k)!;
      g.count++;
      if (t.hit) g.hits++;
      g.sum += t.tradeReturn;
      g.rets.push(t.tradeReturn);
      g.equity.push(g.equity[g.equity.length - 1] * (1 + t.tradeReturn));
    }

    const rows: RegimeReportRow[] = [];
    for (const g of groups.values()) {
      if (g.count === 0) continue;

      const hitRate = g.hits / g.count;
      const avgReturn = g.sum / g.count;

      const daily: number[] = [];
      for (const r of g.rets) {
        const dr = Math.pow(1 + r, 1 / horizonDays) - 1;
        for (let i = 0; i < horizonDays; i++) daily.push(dr);
      }

      const sharpe = this.calculateSharpe(daily);
      const maxDD = this.calculateMaxDD(g.equity.map(e => ({ equity: e })));

      rows.push({ trend: g.trend, vol: g.vol, count: g.count, hitRate, avgReturn, sharpe, maxDD });
    }

    rows.sort((a, b) => b.count - a.count);
    return rows;
  }

  private deriveBadRegimes(report: RegimeReportRow[]): { trend: string; vol: string }[] {
    return report
      .filter(r => r.count > 20 && (r.sharpe < 0.3 || r.avgReturn < 0 || r.maxDD < -0.4))
      .map(r => ({ trend: r.trend, vol: r.vol }));
  }

  private calculateMaxDD(curve: { equity: number }[]): number {
    let peak = 1;
    let maxDD = 0;
    for (const p of curve) {
      if (p.equity > peak) peak = p.equity;
      const dd = p.equity / peak - 1;
      if (dd < maxDD) maxDD = dd;
    }
    return maxDD;
  }

  private calculateSharpe(returns: number[]): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    return std === 0 ? 0 : (mean / std) * Math.sqrt(252);
  }

  private emptyResult(): BacktestResult {
    return {
      totalTrades: 0,
      winRate: 0,
      avgReturn: 0,
      maxDrawdown: 0,
      maxDD: 0,
      sharpe: 0,
      cagr: 0,
      equityCurve: [],
      regimeReport: []
    };
  }
}
