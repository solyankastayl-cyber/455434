/**
 * BLOCK 34 + 34.1 + 34.2 + 34.3 + 34.4: Simulation Runner Service
 * Time-travel autopilot + trading simulation with asOf control
 * + Experiment Harness + Telemetry Layer
 * + Risk Surface Sweep Support
 * + DD Attribution Engine
 * + Confidence Gating
 */

import { SimClock } from './sim.clock.js';
import { SimTelemetry, SimEventType } from './sim.telemetry.js';
import { SimExperiment, getExperimentOverrides, getExperimentDescription, ExperimentOverrides } from './sim.experiments.js';
import { SimOverrides, applyOverrides } from './sim.overrides.js';
import { DDAttributionEngine, DDAttribution } from './sim.dd-attribution.js';
import { GateConfig, DEFAULT_GATE_CONFIG, canEnter, canFlip, confidenceScale } from './sim.confidence-gate.js';
import { FractalSettingsModel } from '../data/schemas/fractal-settings.schema.js';
import { FractalRiskStateModel } from '../data/schemas/fractal-risk-state.schema.js';
import { FractalAutopilotRunModel } from '../data/schemas/fractal-autopilot-run.schema.js';
import { CanonicalOhlcvModel } from '../data/schemas/fractal-canonical-ohlcv.schema.js';
import { FractalPositionStateModel } from '../data/schemas/fractal-position-state.schema.js';

const DAY_MS = 86400000;

export interface SimConfig {
  symbol: string;
  from: string;
  to: string;
  stepDays?: number;
  mode?: 'AUTOPILOT' | 'FROZEN';
  horizons?: number[];
  costs?: {
    feeBps?: number;
    slippageBps?: number;
    spreadBps?: number;
  };
  experiment?: SimExperiment;
  overrides?: SimOverrides;  // BLOCK 34.2: Direct parameter overrides
  attribution?: boolean;     // BLOCK 34.3: Enable DD attribution
  gateConfig?: GateConfig;   // BLOCK 34.4: Confidence gating
}

export interface SimEquityPoint {
  ts: Date;
  equity: number;
  price: number | null;
  position: string;
  action?: string;
  regime?: { trend: string; volatility: string };
}

export interface SimSummary {
  sharpe: number;
  maxDD: number;
  cagr: number;
  finalEquity: number;
  totalDays: number;
  tradesOpened: number;
  autopilotRuns: number;
  retrainCount: number;
  promoteCount: number;
  rollbackCount: number;
  driftCounts: { OK: number; WARN: number; DEGRADED: number; CRITICAL: number };
  turnover: number;
  totalCosts: number;
  avgHorizon: number;
  regimeBreakdown: Record<string, { trades: number; pnl: number }>;
  yearlyBreakdown: Record<string, { sharpe: number; cagr: number; maxDD: number }>;
}

export interface SimTelemetrySummary {
  eventCounts: Record<string, number>;
  eventsByYear: Record<string, number>;
  retrainCount: number;
  rollbackCount: number;
  promoteCount: number;
  hardKills: number;
  softKills: number;
  horizonChanges: number;
  driftChanges: number;
  avgEventsPerYear: number;
}

export interface SimResult {
  ok: boolean;
  experiment: SimExperiment;
  experimentDescription: string;
  overrides: ExperimentOverrides;
  summary: SimSummary;
  equityCurve: SimEquityPoint[];
  telemetry: SimTelemetrySummary;
  yearlyBreakdown: Array<{
    year: string;
    sharpe: number;
    maxDD: number;
    trades: number;
    events: number;
  }>;
  regimeBreakdown: Array<{
    regime: string;
    trades: number;
    pnl: number;
    avgHoldDays: number;
  }>;
  horizonBreakdown: Array<{
    horizon: number;
    count: number;
    avgReturn: number;
  }>;
  ddAttribution: {
    maxDDPeriod: { start: string; end: string; dd: number };
    topDDPeriods: { start: string; end: string; dd: number }[];
  };
  // BLOCK 34.3: Full DD Attribution
  fullDDAttribution?: DDAttribution;
  events: Array<{ ts: string; type: string; meta?: any }>;
  warnings: string[];
  error?: string;
}

export class FractalSimulationRunner {
  async run(config: SimConfig): Promise<SimResult> {
    const {
      symbol,
      from,
      to,
      stepDays = 7,
      mode = 'FROZEN',
      experiment = 'E0'
    } = config;

    // Get experiment overrides
    const expOverrides = getExperimentOverrides(experiment);
    const experimentDescription = getExperimentDescription(experiment);

    const clock = new SimClock(from);
    const end = new Date(to);

    const equityCurve: SimEquityPoint[] = [];
    const warnings: string[] = [];
    const telemetry = new SimTelemetry();
    
    // BLOCK 34.3: DD Attribution Engine
    const ddEngine = new DDAttributionEngine();
    const enableAttribution = config.attribution ?? false;

    // BLOCK 34.4: Confidence Gating
    const gateConfig: GateConfig = config.gateConfig ?? DEFAULT_GATE_CONFIG;
    let gateBlockEnterCount = 0;
    let gateBlockFlipCount = 0;
    let totalConfScaleSum = 0;
    let confScaleCount = 0;

    // Counters
    let autopilotRuns = 0;
    let retrainCount = 0;
    let promoteCount = 0;
    let rollbackCount = 0;
    const driftCounts = { OK: 0, WARN: 0, DEGRADED: 0, CRITICAL: 0 };
    let tradesOpened = 0;
    let totalCosts = 0;
    let turnover = 0;
    const horizonUsed: number[] = [];
    const regimeStats: Record<string, { trades: number; pnl: number }> = {};
    const yearlyReturns: Record<string, number[]> = {};

    // Simulation state
    let equity = 1.0;
    let peakEquity = 1.0;
    let position: 'FLAT' | 'LONG' | 'SHORT' = 'FLAT';
    let posSize = 0;
    let entryPrice = 0;
    let lastPrice = 0;
    let cooldownUntil: Date | null = null;
    let currentRegimeKey = '';
    let currentHorizon = expOverrides.horizon.fixed;
    let lastHorizonChangeDate: Date | null = null;
    let lastRollbackDate: Date | null = null;
    let consecutiveDegraded = 0;
    let lastRetrainDate: Date | null = null;
    let tradeEntryDate: Date | null = null;
    let currentConfidence = 0;

    // Load settings and apply direct overrides (BLOCK 34.2)
    const baseSettings = await FractalSettingsModel.findOne({ symbol }).lean() as any;
    const settings = applyOverrides(baseSettings, config.overrides);
    
    const posRules = settings?.positionModel ?? {};
    const costModel = config.costs ?? settings?.costModel ?? {};
    
    const feeBps = Number(costModel.feeBps ?? 4);
    const slippageBps = Number(costModel.slippageBps ?? 6);
    const spreadBps = Number(costModel.spreadBps ?? 2);
    const roundTripCost = 2 * (feeBps + slippageBps + spreadBps) / 10000;

    const enterThr = Number(posRules.enterThreshold ?? 0.20);
    const exitThr = Number(posRules.exitThreshold ?? 0.10);
    const minHold = Number(posRules.minHoldDays ?? 10);
    const maxHold = Number(posRules.maxHoldDays ?? 45);
    const cdDays = Number(posRules.coolDownDays ?? 5);

    // BLOCK 34.2: Apply direct DD overrides if provided
    const overrides = { ...expOverrides };
    if (config.overrides?.dd?.soft != null) {
      overrides.dd = { ...overrides.dd, soft: config.overrides.dd.soft };
    }
    if (config.overrides?.dd?.hard != null) {
      overrides.dd = { ...overrides.dd, hard: config.overrides.dd.hard };
    }

    let holdDays = 0;
    let stepCount = 0;
    let tradePnl = 0;

    try {
      while (clock.now() <= end) {
        const asOf = clock.now();
        stepCount++;

        // Get price at asOf
        const priceDoc = await CanonicalOhlcvModel.findOne({
          'meta.symbol': symbol,
          ts: { $lte: asOf }
        }).sort({ ts: -1 }).lean() as any;

        const price = priceDoc?.ohlcv?.c ?? lastPrice;
        if (!price) {
          clock.addDays(stepDays);
          continue;
        }

        // Calculate step PnL if in position
        let stepPnl = 0;
        if (position !== 'FLAT' && lastPrice > 0) {
          const ret = price / lastPrice - 1;
          stepPnl = position === 'LONG' ? ret * posSize : -ret * posSize;
          equity *= (1 + stepPnl);
          holdDays += stepDays;
          tradePnl += stepPnl;
        }

        // Track yearly returns
        telemetry.trackYearlyReturn(asOf, stepPnl);

        // Update peak
        if (equity > peakEquity) peakEquity = equity;

        // Calculate current DD
        const currentDD = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;

        // Get signal (simplified - use rule-based from canonical data)
        const signal = await this.getSignalAtDate(symbol, asOf, settings, currentHorizon);
        currentConfidence = signal.confidence;
        
        // Track regime changes
        const regimeKey = `${signal.regime?.trend ?? 'UNK'}_${signal.regime?.volatility ?? 'UNK'}`;
        if (regimeKey !== currentRegimeKey && currentRegimeKey !== '') {
          telemetry.log('REGIME_CHANGE', asOf, { 
            from: currentRegimeKey, 
            to: regimeKey 
          });
        }
        currentRegimeKey = regimeKey;

        // BLOCK 34.3: Track DD Attribution
        if (enableAttribution && currentDD > 0.05) {
          ddEngine.track({
            ts: asOf,
            equity,
            peakEquity,
            regime: signal.regime,
            horizon: currentHorizon,
            side: position,
            confidence: currentConfidence,
            holdDays,
            entryPrice,
            currentPrice: price,
            positionPnl: tradePnl
          });
        }
        
        // Position lifecycle simulation
        const inCooldown = cooldownUntil && asOf < cooldownUntil;
        
        let action = 'HOLD';

        // === DD-based kill switches (experiment-aware) ===
        const softDD = overrides.dd.soft;
        const hardDD = overrides.dd.hard;
        
        // Per-regime DD (R2 experiment)
        let effectiveHardDD = hardDD;
        if (overrides.dd.perRegime) {
          if (signal.regime?.trend === 'DOWN_TREND' && signal.regime?.volatility === 'HIGH_VOL') {
            effectiveHardDD = overrides.dd.perRegime.crash;
          } else if (signal.regime?.trend === 'SIDEWAYS') {
            effectiveHardDD = overrides.dd.perRegime.sideways;
          } else {
            effectiveHardDD = overrides.dd.perRegime.trend;
          }
        }

        // Hard kill
        if (currentDD >= effectiveHardDD && position !== 'FLAT') {
          telemetry.log('HARD_KILL', asOf, { dd: currentDD, threshold: effectiveHardDD });
          const exitCost = roundTripCost / 2 * posSize;
          equity *= (1 - exitCost);
          totalCosts += exitCost;
          
          // Track regime performance
          telemetry.trackRegimeTrade(regimeKey, tradePnl, holdDays);
          
          position = 'FLAT';
          posSize = 0;
          holdDays = 0;
          tradePnl = 0;
          cooldownUntil = new Date(asOf.getTime() + cdDays * 2 * DAY_MS); // Double cooldown
          action = 'HARD_KILL';
        }
        // Soft kill (taper exposure)
        else if (currentDD >= softDD && position !== 'FLAT') {
          telemetry.log('SOFT_KILL', asOf, { dd: currentDD, threshold: softDD });
          // Reduce position by 50%
          const reduceSize = posSize * 0.5;
          const exitCost = roundTripCost / 2 * reduceSize;
          equity *= (1 - exitCost);
          totalCosts += exitCost;
          turnover += reduceSize;
          posSize -= reduceSize;
          action = 'SOFT_KILL';
        }
        // Force exit by maxHold
        else if (position !== 'FLAT' && maxHold > 0 && holdDays >= maxHold) {
          telemetry.log('FORCE_EXIT', asOf, { holdDays, maxHold });
          const exitCost = roundTripCost / 2 * posSize;
          equity *= (1 - exitCost);
          totalCosts += exitCost;
          
          telemetry.trackRegimeTrade(regimeKey, tradePnl, holdDays);
          
          position = 'FLAT';
          posSize = 0;
          holdDays = 0;
          tradePnl = 0;
          cooldownUntil = new Date(asOf.getTime() + cdDays * DAY_MS);
          action = 'FORCE_EXIT';
        }
        // Normal exit
        else if (position !== 'FLAT' && holdDays >= minHold) {
          if (signal.direction === 'NEUTRAL' || signal.confidence < exitThr) {
            telemetry.log('EXIT', asOf, { reason: 'SIGNAL_WEAK', confidence: signal.confidence });
            const exitCost = roundTripCost / 2 * posSize;
            equity *= (1 - exitCost);
            totalCosts += exitCost;
            
            telemetry.trackRegimeTrade(regimeKey, tradePnl, holdDays);
            
            position = 'FLAT';
            posSize = 0;
            holdDays = 0;
            tradePnl = 0;
            cooldownUntil = new Date(asOf.getTime() + cdDays * DAY_MS);
            action = 'EXIT';
          }
        }
        // Enter (with BLOCK 34.4 Confidence Gating)
        else if (position === 'FLAT' && !inCooldown) {
          if (signal.direction !== 'NEUTRAL' && signal.confidence >= enterThr) {
            // BLOCK 34.4: Check confidence gate
            const enterCheck = canEnter(signal.confidence, gateConfig);
            
            if (!enterCheck.allowed) {
              // Gate blocked entry
              telemetry.log('GATE_BLOCK_ENTER' as SimEventType, asOf, { 
                confidence: signal.confidence, 
                minRequired: gateConfig.minEnterConfidence,
                reason: enterCheck.reason 
              });
              gateBlockEnterCount++;
              action = 'GATE_BLOCK_ENTER';
            } else {
              // Gate passed - calculate scaled exposure
              const confScale = confidenceScale(signal.confidence, gateConfig);
              const baseExposure = Math.min(2, Math.max(0, signal.confidence * 2));
              const exposure = baseExposure * confScale;
              
              // Track confidence scaling
              telemetry.log('CONF_SCALE' as SimEventType, asOf, { 
                confidence: signal.confidence, 
                scale: confScale, 
                baseExposure, 
                finalExposure: exposure 
              });
              totalConfScaleSum += confScale;
              confScaleCount++;

              if (exposure > 0.01) { // Minimum exposure threshold
                const entryCost = roundTripCost / 2 * exposure;
                equity *= (1 - entryCost);
                totalCosts += entryCost;
                
                telemetry.log('ENTER', asOf, { 
                  side: signal.direction, 
                  confidence: signal.confidence,
                  confScale,
                  exposure,
                  regime: regimeKey
                });
                
                position = signal.direction as 'LONG' | 'SHORT';
                posSize = exposure;
                entryPrice = price;
                holdDays = 0;
                tradePnl = 0;
                tradeEntryDate = asOf;
                tradesOpened++;
                turnover += exposure;
                action = 'ENTER_' + signal.direction;

                // Track horizon
                horizonUsed.push(signal.horizon ?? currentHorizon);
                telemetry.trackHorizon(currentHorizon, 0); // Will update on exit

                // Track regime
                if (!regimeStats[regimeKey]) regimeStats[regimeKey] = { trades: 0, pnl: 0 };
                regimeStats[regimeKey].trades++;
              }
            }
          }
        }

        // Track yearly returns (for summary)
        const year = asOf.getFullYear().toString();
        if (!yearlyReturns[year]) yearlyReturns[year] = [];
        yearlyReturns[year].push(stepPnl);

        // Store equity point
        equityCurve.push({
          ts: new Date(asOf),
          equity,
          price,
          position,
          action: action !== 'HOLD' ? action : undefined,
          regime: signal.regime
        });

        // === AUTOPILOT MODE: Simulate drift, retrain, promote, rollback ===
        if (mode === 'AUTOPILOT' && stepCount % Math.floor(30 / stepDays) === 0) {
          autopilotRuns++;
          
          // Simulate drift check
          const drift = this.simulateDrift(equity, peakEquity, overrides);
          const prevLevel = driftCounts.OK > 0 || driftCounts.WARN > 0 || driftCounts.DEGRADED > 0 || driftCounts.CRITICAL > 0 
            ? 'PREVIOUS' : 'NONE';
          
          driftCounts[drift.level as keyof typeof driftCounts]++;
          
          // Log drift change
          telemetry.log('DRIFT_CHANGE', asOf, { level: drift.level });

          // === Apply experiment rules ===
          
          // D3: Rollback cooldown
          const rollbackCooldownDays = overrides.drift.rollbackCooldownDays;
          const canRollback = !lastRollbackDate || 
            (asOf.getTime() - lastRollbackDate.getTime()) >= rollbackCooldownDays * DAY_MS;

          // D2: Critical confirmations
          const criticalConfirmations = overrides.drift.criticalConfirmations;

          if (drift.level === 'CRITICAL') {
            if (canRollback) {
              // Check if we need confirmations
              if (criticalConfirmations > 1) {
                consecutiveDegraded++; // Reuse counter
                if (consecutiveDegraded >= criticalConfirmations) {
                  telemetry.log('ROLLBACK', asOf, { reason: 'CRITICAL_CONFIRMED', confirmations: consecutiveDegraded });
                  rollbackCount++;
                  lastRollbackDate = asOf;
                  consecutiveDegraded = 0;
                }
              } else {
                telemetry.log('ROLLBACK', asOf, { reason: 'CRITICAL_DRIFT' });
                rollbackCount++;
                lastRollbackDate = asOf;
              }
            } else {
              warnings.push(`${asOf.toISOString().slice(0, 10)}: Rollback blocked by cooldown`);
            }
          }

          // A1/A2: Retrain rules
          if (drift.level === 'DEGRADED') {
            consecutiveDegraded++;
            
            const degradedThreshold = overrides.autolearn.degradedThreshold;
            const minRetrainInterval = overrides.autolearn.minRetrainIntervalDays;
            
            const canRetrain = !lastRetrainDate ||
              (asOf.getTime() - lastRetrainDate.getTime()) >= minRetrainInterval * DAY_MS;

            if (consecutiveDegraded >= degradedThreshold && canRetrain) {
              telemetry.log('RETRAIN', asOf, { 
                reason: 'DEGRADED_THRESHOLD', 
                consecutiveDegraded 
              });
              retrainCount++;
              lastRetrainDate = asOf;
              consecutiveDegraded = 0;
              
              // Simulate promote after retrain (50% chance)
              if (Math.random() > 0.5) {
                telemetry.log('PROMOTE', asOf, { reason: 'RETRAIN_SUCCESS' });
                promoteCount++;
              }
            }
          } else {
            consecutiveDegraded = 0;
          }

          // === H3: Horizon hysteresis ===
          if (overrides.horizon.adaptive) {
            const newHorizon = this.selectAdaptiveHorizon(signal, settings);
            const hysteresisDays = overrides.horizon.hysteresisDays;
            
            const canChangeHorizon = !lastHorizonChangeDate ||
              (asOf.getTime() - lastHorizonChangeDate.getTime()) >= hysteresisDays * DAY_MS;

            if (newHorizon !== currentHorizon && canChangeHorizon) {
              telemetry.log('HORIZON_CHANGE', asOf, { 
                from: currentHorizon, 
                to: newHorizon 
              });
              currentHorizon = newHorizon;
              lastHorizonChangeDate = asOf;
            }
          }
        }

        lastPrice = price;
        clock.addDays(stepDays);
      }

      // Compute summary
      const summary = this.computeSummary({
        equityCurve,
        autopilotRuns,
        retrainCount,
        promoteCount,
        rollbackCount,
        driftCounts,
        tradesOpened,
        totalCosts,
        turnover,
        horizonUsed,
        regimeStats,
        yearlyReturns
      });

      // Get telemetry breakdowns
      const yearlyBreakdown = telemetry.getYearlyBreakdown().map(y => ({
        year: y.year,
        sharpe: Math.round(y.sharpe * 1000) / 1000,
        maxDD: Math.round(y.maxDD * 10000) / 10000,
        trades: y.trades,
        events: y.events
      }));

      const regimeBreakdown = telemetry.getRegimeBreakdown().map(r => ({
        regime: r.regime,
        trades: r.trades,
        pnl: Math.round(r.pnl * 10000) / 10000,
        avgHoldDays: Math.round(r.avgHoldDays * 10) / 10
      }));

      const horizonBreakdown = telemetry.getHorizonBreakdown().map(h => ({
        horizon: h.horizon,
        count: h.count,
        avgReturn: Math.round(h.avgReturn * 10000) / 10000
      }));

      const ddAttribution = telemetry.getDDAttribution(equityCurve);
      
      // BLOCK 34.3: Compute full DD Attribution if enabled
      const fullDDAttribution = enableAttribution ? ddEngine.compute() : undefined;

      return {
        ok: true,
        experiment,
        experimentDescription,
        overrides,
        summary,
        equityCurve,
        telemetry: telemetry.getSummary(),
        yearlyBreakdown,
        regimeBreakdown,
        horizonBreakdown,
        ddAttribution,
        fullDDAttribution,
        events: telemetry.getEvents(5000),
        warnings
      };

    } catch (error) {
      return {
        ok: false,
        experiment,
        experimentDescription,
        overrides,
        summary: {} as SimSummary,
        equityCurve,
        telemetry: telemetry.getSummary(),
        yearlyBreakdown: [],
        regimeBreakdown: [],
        horizonBreakdown: [],
        ddAttribution: { maxDDPeriod: { start: '', end: '', dd: 0 }, topDDPeriods: [] },
        events: telemetry.getEvents(1000),
        warnings,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async getSignalAtDate(symbol: string, asOf: Date, settings: any, horizon: number): Promise<{
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    confidence: number;
    horizon: number;
    regime?: { trend: string; volatility: string };
  }> {
    // Get last 90 days of prices
    const prices = await CanonicalOhlcvModel.find({
      'meta.symbol': symbol,
      ts: { $lte: asOf }
    }).sort({ ts: -1 }).limit(90).lean() as any[];

    if (prices.length < 60) {
      return { direction: 'NEUTRAL', confidence: 0, horizon };
    }

    const closes = prices.map(p => p.ohlcv?.c ?? 0).reverse();
    
    // Simple momentum signal
    const recent = closes.slice(-Math.min(horizon, 30));
    const older = closes.slice(-60, -30);
    
    const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderMean = older.reduce((a, b) => a + b, 0) / older.length;
    
    const momentum = (recentMean / olderMean - 1);
    
    // Volatility
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
    const vol = Math.sqrt(returns.reduce((a, b) => a + b * b, 0) / returns.length) * Math.sqrt(365);
    
    // Regime
    const trend = momentum > 0.05 ? 'UP_TREND' : momentum < -0.05 ? 'DOWN_TREND' : 'SIDEWAYS';
    const volatility = vol > 0.8 ? 'HIGH_VOL' : vol < 0.4 ? 'LOW_VOL' : 'NORMAL_VOL';
    
    // Signal
    let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = Math.abs(momentum) * 2;
    
    if (momentum > 0.03) direction = 'LONG';
    else if (momentum < -0.03) direction = 'SHORT';
    
    // Reduce confidence in bad regimes
    if (trend === 'DOWN_TREND' && volatility === 'HIGH_VOL') {
      confidence *= 0.3;
    }

    return {
      direction,
      confidence: Math.min(1, confidence),
      horizon,
      regime: { trend, volatility }
    };
  }

  private simulateDrift(equity: number, peakEquity: number, overrides: ExperimentOverrides): { level: string } {
    const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
    
    // Use experiment thresholds
    const hardDD = overrides.dd.hard;
    const softDD = overrides.dd.soft;
    
    if (dd > hardDD) return { level: 'CRITICAL' };
    if (dd > (hardDD + softDD) / 2) return { level: 'DEGRADED' };
    if (dd > softDD) return { level: 'WARN' };
    return { level: 'OK' };
  }

  private selectAdaptiveHorizon(signal: any, settings: any): number {
    const horizons = settings?.adaptiveHorizon?.horizons ?? [14, 30, 60];
    const regime = signal.regime;
    
    // Simple heuristic:
    // HIGH_VOL -> shorter horizon (14)
    // LOW_VOL -> longer horizon (60)
    // else -> medium (30)
    if (regime?.volatility === 'HIGH_VOL') return horizons[0] ?? 14;
    if (regime?.volatility === 'LOW_VOL') return horizons[horizons.length - 1] ?? 60;
    return horizons[Math.floor(horizons.length / 2)] ?? 30;
  }

  private computeSummary(data: {
    equityCurve: SimEquityPoint[];
    autopilotRuns: number;
    retrainCount: number;
    promoteCount: number;
    rollbackCount: number;
    driftCounts: Record<string, number>;
    tradesOpened: number;
    totalCosts: number;
    turnover: number;
    horizonUsed: number[];
    regimeStats: Record<string, { trades: number; pnl: number }>;
    yearlyReturns: Record<string, number[]>;
  }): SimSummary {
    const { equityCurve } = data;

    // Calculate returns
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const ret = equityCurve[i].equity / equityCurve[i - 1].equity - 1;
      returns.push(ret);
    }

    const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length > 1 
      ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1) 
      : 0;
    const vol = Math.sqrt(variance);
    
    // Annualized Sharpe (assuming weekly steps = 52 periods)
    const periodsPerYear = 52;
    const sharpe = vol > 0 ? (mean * Math.sqrt(periodsPerYear)) / vol : 0;

    // Max drawdown
    let peak = 1;
    let maxDD = 0;
    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const dd = (peak - point.equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    // CAGR
    const startEq = equityCurve[0]?.equity ?? 1;
    const endEq = equityCurve[equityCurve.length - 1]?.equity ?? 1;
    const years = equityCurve.length / periodsPerYear;
    const cagr = years > 0 ? Math.pow(endEq / startEq, 1 / years) - 1 : 0;

    // Average horizon
    const avgHorizon = data.horizonUsed.length 
      ? data.horizonUsed.reduce((a, b) => a + b, 0) / data.horizonUsed.length 
      : 30;

    // Yearly breakdown
    const yearlyBreakdown: Record<string, { sharpe: number; cagr: number; maxDD: number }> = {};
    for (const [year, rets] of Object.entries(data.yearlyReturns)) {
      if (rets.length === 0) continue;
      const m = rets.reduce((a, b) => a + b, 0) / rets.length;
      const v = rets.length > 1 ? rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1) : 0;
      const s = Math.sqrt(v);
      
      // Calculate yearly max DD
      let yearPeak = 1;
      let yearMaxDD = 0;
      let yearEquity = 1;
      for (const r of rets) {
        yearEquity *= (1 + r);
        if (yearEquity > yearPeak) yearPeak = yearEquity;
        const dd = (yearPeak - yearEquity) / yearPeak;
        if (dd > yearMaxDD) yearMaxDD = dd;
      }
      
      yearlyBreakdown[year] = {
        sharpe: s > 0 ? m / s * Math.sqrt(52) : 0,
        cagr: rets.reduce((acc, r) => acc * (1 + r), 1) - 1,
        maxDD: yearMaxDD
      };
    }

    return {
      sharpe,
      maxDD,
      cagr,
      finalEquity: endEq,
      totalDays: equityCurve.length * 7,
      tradesOpened: data.tradesOpened,
      autopilotRuns: data.autopilotRuns,
      retrainCount: data.retrainCount,
      promoteCount: data.promoteCount,
      rollbackCount: data.rollbackCount,
      driftCounts: data.driftCounts as any,
      turnover: data.turnover,
      totalCosts: data.totalCosts,
      avgHorizon,
      regimeBreakdown: data.regimeStats,
      yearlyBreakdown
    };
  }
}
