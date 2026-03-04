/**
 * OUTCOME SERVICE
 * ===============
 * 
 * Closes due forecasts and computes outcomes.
 * Updates credibility for Evolution loop.
 * 
 * Block 2: Added health-weighted credibility updates.
 * Forecasts made during DEGRADED/CRITICAL health have reduced
 * influence on credibility scores.
 */

import { VerdictForecastModel } from "../../verdict/storage/forecast.model.js";
import { VerdictModel } from "../../verdict/storage/verdict.model.js";
import { OutcomeModel } from "../storage/outcome.model.js";
import type { PricePort } from "./price.port.js";
import type { CredibilityService } from "./credibility.service.js";
import type { Horizon, HealthState } from "../contracts/evolution.types.js";

export class OutcomeService {
  constructor(
    private price: PricePort,
    private credibility: CredibilityService
  ) {}

  private signedReturn(entry: number, exit: number, action: "BUY" | "SELL"): number {
    const r = (exit - entry) / entry;
    return action === "SELL" ? -r : r;
  }

  async closeDueForecasts(nowIso = new Date().toISOString()): Promise<{ closed: number; errors: number }> {
    const due = await VerdictForecastModel.find({
      status: "OPEN",
      resolveAtTs: { $lte: nowIso },
    }).limit(200).lean();

    let closed = 0;
    let errors = 0;

    for (const f of due) {
      try {
        const exitPrice = await this.price.getPriceAt(f.symbol, f.resolveAtTs);
        const action = f.action as "BUY" | "SELL";

        const realized = this.signedReturn(f.entryPrice, exitPrice, action);
        const success = Math.sign(realized) === Math.sign(f.expectedReturn) && Math.abs(realized) > 0.001;

        const maxDrawdown = this.price.getMaxDrawdown
          ? await this.price.getMaxDrawdown(f.symbol, f.entryTs, f.resolveAtTs, action)
          : undefined;

        // Block 1: Extract health state from forecast
        const healthState = (f as any).healthState as HealthState | undefined;

        // Create outcome (Block 1: include health state)
        await OutcomeModel.create({
          forecastId: f.forecastId,
          verdictId: f.verdictId,
          symbol: f.symbol,
          horizon: f.horizon,

          entryTs: f.entryTs,
          resolveAtTs: f.resolveAtTs,

          entryPrice: f.entryPrice,
          exitPrice,

          action,
          realizedReturn: realized,
          success,
          maxDrawdown,

          // Block 1: Preserve health state in outcome
          healthState,
          healthSnapshot: (f as any).healthSnapshot,

          computedAt: new Date().toISOString(),
        });

        // Update forecast
        await VerdictForecastModel.updateOne(
          { forecastId: f.forecastId },
          { $set: { status: "CLOSED", exitPrice, realizedReturn: realized, success, maxDrawdown } }
        );

        // Update verdict
        await VerdictModel.updateOne(
          { verdictId: f.verdictId },
          { $set: { status: "CLOSED" } }
        );

        // Update credibility (symbol + model + regime)
        // Block 2: Pass healthState to weight the credibility update
        const v = await VerdictModel.findOne({ verdictId: f.verdictId }).lean() as any;
        const success01 = success ? 1 : 0;
        const horizon = f.horizon as Horizon;

        // Block 2: Health-weighted credibility updates
        await this.credibility.updateSymbol(f.symbol, success01, realized, maxDrawdown, horizon, healthState);
        
        if (v?.modelId) {
          await this.credibility.updateModel(v.modelId, horizon, success01, realized, maxDrawdown, healthState);
        }
        
        if (v?.regime) {
          await this.credibility.updateRegime(v.regime, success01, realized, maxDrawdown, horizon, healthState);
        }

        const healthNote = healthState && healthState !== "HEALTHY" ? ` [health=${healthState}]` : "";
        console.log(
          `[Outcome] Closed ${f.forecastId}: ${f.symbol} ${f.horizon} ` +
          `${success ? "✓" : "✗"} return=${(realized * 100).toFixed(2)}%${healthNote}`
        );

        closed += 1;
      } catch (err: any) {
        console.error(`[Outcome] Error closing ${f.forecastId}:`, err.message);
        errors += 1;
      }
    }

    return { closed, errors };
  }

  async getOpenForecasts(): Promise<any[]> {
    return VerdictForecastModel.find({ status: "OPEN" }).lean();
  }

  async getRecentOutcomes(limit = 50): Promise<any[]> {
    return OutcomeModel.find().sort({ computedAt: -1 }).limit(limit).lean();
  }
}

console.log('[Evolution] Outcome service loaded (Block 2: health-weighted)');
