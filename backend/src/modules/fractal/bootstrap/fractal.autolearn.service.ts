/**
 * BLOCK 29.10 + 29.13-29.15: AutoLearn Service (Orchestrator)
 * Train -> WF Eval -> Shadow Backtest -> Compare -> Promote/Discard
 * 
 * With safer promotion criteria:
 * - CV accuracy gate
 * - Walk-forward stability gate
 * - Trading metrics comparison
 */

import { FractalRetrainService } from './fractal.retrain.service.js';
import { FractalBacktestService } from '../backtest/fractal.backtest.service.js';
import { FractalPromotionService } from './fractal.promotion.service.js';
import { FractalWFTradingEvalService } from './fractal.wf-trading-eval.service.js';
import { FractalModelRegistryModel } from '../data/schemas/fractal-model-registry.schema.js';
import { FractalAutoLearnStateModel } from '../data/schemas/fractal-autolearn-state.schema.js';

interface BacktestMetrics {
  sharpe?: number;
  hitRate?: number;
  maxDD?: number;
  cagr?: number;
  totalTrades?: number;
}

interface CVMetrics {
  cv_acc: number;
  cv_logloss: number;
  samples: number;
}

interface WFMetrics {
  windows: number;
  median_proxy_sharpe: number;
  stability_score: number;
  positive_window_frac?: number;
}

interface WFTradingMetrics {
  median_sharpe: number;
  std_sharpe: number;
  positive_window_frac: number;
  stability_score: number;
  median_maxDD: number;
  median_hitRate: number;
}

interface AutoLearnConfig {
  symbol?: string;
  fromDate?: string;   // YYYY-MM-DD - train data start
  toDate?: string;     // YYYY-MM-DD - train data end
  purgeDays?: number;
  splits?: number;
}

interface AutoLearnResult {
  ok: boolean;
  action: 'PROMOTED' | 'DISCARDED' | 'TRAIN_FAILED';
  version: string;
  trainWindow?: any;
  cv?: CVMetrics;
  walkForward?: WFMetrics;
  walkForwardTrading?: WFTradingMetrics;
  active?: BacktestMetrics;
  shadow?: BacktestMetrics;
  promotionChecks?: {
    cvOk: boolean;
    wfProxyOk: boolean;
    wfTradingOk: boolean;
    tradingBetter: boolean;
    allPassed: boolean;
  };
  error?: string;
}

export class FractalAutoLearnService {
  private retrain = new FractalRetrainService();
  private backtest = new FractalBacktestService();
  private promo = new FractalPromotionService();
  private wfTrading = new FractalWFTradingEvalService();

  async run(config: AutoLearnConfig = {}): Promise<AutoLearnResult> {
    const symbol = config.symbol ?? 'BTC';

    // 1) Train -> SHADOW version
    console.log(`[AutoLearn] Starting retrain for ${symbol}`);
    
    const train = await this.retrain.retrain({
      symbol,
      fromDate: config.fromDate,
      toDate: config.toDate,
      purgeDays: config.purgeDays,
      splits: config.splits
    });

    if (!train.ok) {
      return {
        ok: false,
        action: 'TRAIN_FAILED',
        version: train.version,
        trainWindow: train.trainWindow,
        error: train.error
      };
    }

    const version = train.version;

    // 2) Shadow backtest (walk-forward, honest)
    console.log(`[AutoLearn] Running shadow backtest for ${version}`);
    const shadowRun = await this.backtest.run({
      symbol,
      windowLen: 60,
      horizonDays: 30,
      topK: 25,
      minGapDays: 60,
      mlVersion: version
    });

    const shadowM: BacktestMetrics = {
      sharpe: shadowRun.sharpe,
      hitRate: shadowRun.winRate,
      maxDD: shadowRun.maxDD,
      cagr: shadowRun.cagr,
      totalTrades: shadowRun.totalTrades
    };

    // 3) Active backtest (for comparison)
    console.log(`[AutoLearn] Running active backtest for comparison`);
    const activeRun = await this.backtest.run({
      symbol,
      windowLen: 60,
      horizonDays: 30,
      topK: 25,
      minGapDays: 60,
      mlVersion: 'ACTIVE'
    });

    const activeM: BacktestMetrics = {
      sharpe: activeRun.sharpe,
      hitRate: activeRun.winRate,
      maxDD: activeRun.maxDD,
      cagr: activeRun.cagr,
      totalTrades: activeRun.totalTrades
    };

    // 4) Walk-forward trading evaluation (BLOCK 29.15)
    let shadowWFTrading: WFTradingMetrics | undefined;
    let activeWFTrading: WFTradingMetrics | undefined;
    
    const wfEnabled = process.env.FRACTAL_WF_TRADING_ENABLED !== 'false';
    
    if (wfEnabled) {
      console.log(`[AutoLearn] Running walk-forward trading evaluation`);
      
      const wfStart = new Date(process.env.FRACTAL_WF_TRADING_START ?? '2020-01-01');
      const wfEnd = new Date(process.env.FRACTAL_WF_TRADING_END ?? new Date().toISOString().slice(0, 10));
      const wfWindowDays = Number(process.env.FRACTAL_WF_TRADING_WINDOW_DAYS ?? '180');
      const wfStepDays = Number(process.env.FRACTAL_WF_TRADING_STEP_DAYS ?? '90');

      try {
        const shadowWF = await this.wfTrading.evaluate({
          symbol,
          mlVersion: version,
          evalStart: wfStart,
          evalEnd: wfEnd,
          windowDays: wfWindowDays,
          stepDays: wfStepDays
        });

        shadowWFTrading = {
          median_sharpe: shadowWF.median_sharpe,
          std_sharpe: shadowWF.std_sharpe,
          positive_window_frac: shadowWF.positive_window_frac,
          stability_score: shadowWF.stability_score,
          median_maxDD: shadowWF.median_maxDD,
          median_hitRate: shadowWF.median_hitRate
        };

        const activeWF = await this.wfTrading.evaluate({
          symbol,
          mlVersion: 'ACTIVE',
          evalStart: wfStart,
          evalEnd: wfEnd,
          windowDays: wfWindowDays,
          stepDays: wfStepDays
        });

        activeWFTrading = {
          median_sharpe: activeWF.median_sharpe,
          std_sharpe: activeWF.std_sharpe,
          positive_window_frac: activeWF.positive_window_frac,
          stability_score: activeWF.stability_score,
          median_maxDD: activeWF.median_maxDD,
          median_hitRate: activeWF.median_hitRate
        };

        // Save to registry
        await FractalModelRegistryModel.updateOne(
          { symbol, version },
          { $set: { walkForwardTrading: shadowWF } }
        );
      } catch (err) {
        console.warn(`[AutoLearn] WF Trading evaluation failed:`, err);
      }
    }

    // 5) Update shadow metrics in registry
    await FractalModelRegistryModel.updateOne(
      { symbol, version },
      {
        $set: {
          'metrics.shadow_sharpe': shadowM.sharpe ?? 0,
          'metrics.shadow_hitRate': shadowM.hitRate ?? 0,
          'metrics.shadow_maxDD': shadowM.maxDD ?? 0,
          'metrics.shadow_cagr': shadowM.cagr ?? 0
        }
      }
    );

    // 6) Promotion decision (BLOCK 29.13-29.15 safer criteria)
    const checks = this.checkPromotion({
      cv: train.metrics,
      wfProxy: train.walkForward,
      wfTrading: shadowWFTrading,
      activeWFTrading,
      shadowTrading: shadowM,
      activeTrading: activeM
    });

    if (checks.allPassed) {
      await this.promo.promote(symbol, version);

      await FractalAutoLearnStateModel.updateOne(
        { symbol },
        {
          $set: {
            lastRunAt: new Date(),
            consecutiveBad: 0,
            activeVersion: version,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );

      console.log(`[AutoLearn] ${version} PROMOTED. Shadow Sharpe: ${shadowM.sharpe?.toFixed(2)}`);

      return {
        ok: true,
        action: 'PROMOTED',
        version,
        trainWindow: train.trainWindow,
        cv: train.metrics,
        walkForward: train.walkForward,
        walkForwardTrading: shadowWFTrading,
        active: activeM,
        shadow: shadowM,
        promotionChecks: checks
      };
    }

    // Not better -> archive shadow
    await FractalModelRegistryModel.updateOne(
      { symbol, version },
      { $set: { status: 'ARCHIVED' } }
    );

    await FractalAutoLearnStateModel.updateOne(
      { symbol },
      { $set: { lastRunAt: new Date(), updatedAt: new Date() } },
      { upsert: true }
    );

    console.log(`[AutoLearn] ${version} DISCARDED. Checks: ${JSON.stringify(checks)}`);

    return {
      ok: true,
      action: 'DISCARDED',
      version,
      trainWindow: train.trainWindow,
      cv: train.metrics,
      walkForward: train.walkForward,
      walkForwardTrading: shadowWFTrading,
      active: activeM,
      shadow: shadowM,
      promotionChecks: checks
    };
  }

  /**
   * BLOCK 29.13-29.15: Safer Promotion Criteria
   */
  private checkPromotion(params: {
    cv?: CVMetrics;
    wfProxy?: WFMetrics;
    wfTrading?: WFTradingMetrics;
    activeWFTrading?: WFTradingMetrics;
    shadowTrading: BacktestMetrics;
    activeTrading: BacktestMetrics;
  }): {
    cvOk: boolean;
    wfProxyOk: boolean;
    wfTradingOk: boolean;
    tradingBetter: boolean;
    allPassed: boolean;
  } {
    const { cv, wfProxy, wfTrading, activeWFTrading, shadowTrading, activeTrading } = params;

    // 1) CV sanity gate (BLOCK 29.13)
    const cvAcc = cv?.cv_acc ?? 0;
    const cvLL = cv?.cv_logloss ?? 999;
    const cvOk = cvAcc >= 0.52 && cvLL <= 0.69;

    // 2) WF Proxy stability gate (BLOCK 29.14)
    const wfStab = wfProxy?.stability_score ?? -999;
    const wfProxyOk = wfStab >= 0.15 || !wfProxy; // Pass if no WF data (first model)

    // 3) WF Trading stability gate (BLOCK 29.15)
    let wfTradingOk = true;
    if (wfTrading) {
      const sStab = wfTrading.stability_score ?? -999;
      const sPos = wfTrading.positive_window_frac ?? 0;
      const sMedS = wfTrading.median_sharpe ?? -999;

      wfTradingOk = sStab >= 0.20 && sPos >= 0.55 && sMedS >= 0.50;

      // Must be at least as good as active
      if (activeWFTrading) {
        const aStab = activeWFTrading.stability_score ?? -999;
        const aMedS = activeWFTrading.median_sharpe ?? -999;
        wfTradingOk = wfTradingOk && 
          sStab >= aStab - 0.1 && 
          sMedS >= aMedS - 0.15;
      }
    }

    // 4) Trading backtest comparison
    const shadowSharpe = shadowTrading.sharpe ?? 0;
    const activeSharpe = activeTrading.sharpe ?? 0;
    const shadowDD = shadowTrading.maxDD ?? 0;
    const activeDD = activeTrading.maxDD ?? 0;
    const shadowHR = shadowTrading.hitRate ?? 0;
    const activeHR = activeTrading.hitRate ?? 0;
    const shadowTrades = shadowTrading.totalTrades ?? 0;

    // First model special case
    const isFirstModel = Math.abs(activeSharpe - shadowSharpe) < 0.3 && 
                         Math.abs(activeDD - shadowDD) < 0.02;

    let tradingBetter = false;
    if (isFirstModel && shadowSharpe > 1.0) {
      tradingBetter = true; // First model with decent Sharpe
    } else {
      // Normal criteria
      tradingBetter = 
        shadowSharpe >= activeSharpe + 0.15 &&  // Sharpe improvement
        shadowDD >= activeDD - 0.05 &&          // DD not much worse
        shadowHR >= activeHR - 0.02 &&          // Hit rate not much worse
        shadowTrades >= 80;                     // Enough trades
    }

    const allPassed = cvOk && wfProxyOk && wfTradingOk && tradingBetter;

    return { cvOk, wfProxyOk, wfTradingOk, tradingBetter, allPassed };
  }

  /**
   * Get current state
   */
  async getState(symbol = 'BTC') {
    const state = await FractalAutoLearnStateModel.findOne({ symbol }).lean();
    const activeModel = await this.promo.getActiveModel(symbol);

    return {
      symbol,
      lastRunAt: state?.lastRunAt || null,
      consecutiveBad: state?.consecutiveBad ?? 0,
      activeVersion: activeModel?.version || 'NONE',
      activeMetrics: activeModel?.metrics || null
    };
  }
}
