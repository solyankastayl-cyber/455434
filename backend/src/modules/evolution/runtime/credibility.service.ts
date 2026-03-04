/**
 * CREDIBILITY SERVICE
 * ===================
 * 
 * Manages credibility state for symbols, models, and regimes.
 * Used by Evolution to track performance and by Verdict for calibration.
 * 
 * Block 2: Added health-weighted credibility updates.
 * Forecasts made during DEGRADED/CRITICAL health have reduced
 * influence on credibility scores.
 */

import crypto from "node:crypto";
import { CredibilityModel } from "../storage/credibility.model.js";
import { ema, alphaForHorizon } from "./ema.js";
import type { Horizon, HealthState } from "../contracts/evolution.types.js";

function keyHash(parts: Record<string, any>): string {
  return crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

// Block 2: Health state to credibility weight mapping
// HEALTHY: full influence on credibility
// DEGRADED: reduced influence (model was uncertain)
// CRITICAL: minimal influence (model was unreliable)
const HEALTH_CREDIBILITY_WEIGHTS: Record<HealthState, number> = {
  HEALTHY: 1.0,
  DEGRADED: 0.5,
  CRITICAL: 0.2,
};

/**
 * Block 2: Weighted EMA update
 * 
 * When healthWeight < 1.0, the update is "softer" — the new value
 * has less influence on the EMA. This is achieved by reducing alpha.
 * 
 * effectiveAlpha = baseAlpha * healthWeight
 * 
 * Example:
 * - HEALTHY (1.0): alpha = 0.1 (normal learning rate)
 * - DEGRADED (0.5): alpha = 0.05 (slower learning)
 * - CRITICAL (0.2): alpha = 0.02 (very slow learning)
 */
function weightedEma(
  current: number,
  newValue: number,
  baseAlpha: number,
  healthWeight: number
): number {
  const effectiveAlpha = baseAlpha * healthWeight;
  return ema(current, newValue, effectiveAlpha);
}

export class CredibilityService {
  async updateSymbol(
    symbol: string,
    success01: number,
    realizedReturn: number,
    maxDrawdown: number | undefined,
    horizon: Horizon,
    healthState?: HealthState  // Block 2: Optional health state
  ): Promise<void> {
    const alpha = alphaForHorizon(horizon);
    const healthWeight = HEALTH_CREDIBILITY_WEIGHTS[healthState ?? "HEALTHY"];
    const k = { kind: "SYMBOL", symbol };
    const hash = keyHash(k);

    const cur = await CredibilityModel.findOne({ keyHash: hash }).lean();
    const n = (cur?.n ?? 0) + 1;

    // Block 2: Use weighted EMA when health is degraded
    const emaScore = weightedEma(cur?.emaScore ?? 0.5, success01, alpha, healthWeight);
    const emaReturn = weightedEma(cur?.emaReturn ?? 0.0, realizedReturn, alpha, healthWeight);
    const emaDrawdown = weightedEma(cur?.emaDrawdown ?? 0.0, maxDrawdown ?? 0.0, alpha, healthWeight);

    await CredibilityModel.updateOne(
      { keyHash: hash },
      {
        $set: {
          keyHash: hash,
          kind: "SYMBOL",
          symbol,
          n,
          emaScore,
          emaReturn,
          emaDrawdown,
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
    
    const healthNote = healthWeight < 1.0 ? ` (health=${healthState}, weight=${healthWeight})` : "";
    console.log(`[Credibility] Updated SYMBOL ${symbol}: score=${emaScore.toFixed(3)} n=${n}${healthNote}`);
  }

  async updateModel(
    modelId: string,
    horizon: Horizon,
    success01: number,
    realizedReturn: number,
    maxDrawdown: number | undefined,
    healthState?: HealthState  // Block 2: Optional health state
  ): Promise<void> {
    const alpha = alphaForHorizon(horizon);
    const healthWeight = HEALTH_CREDIBILITY_WEIGHTS[healthState ?? "HEALTHY"];
    const k = { kind: "MODEL", modelId, horizon };
    const hash = keyHash(k);

    const cur = await CredibilityModel.findOne({ keyHash: hash }).lean();
    const n = (cur?.n ?? 0) + 1;

    // Block 2: Use weighted EMA when health is degraded
    const emaScore = weightedEma(cur?.emaScore ?? 0.5, success01, alpha, healthWeight);
    const emaReturn = weightedEma(cur?.emaReturn ?? 0.0, realizedReturn, alpha, healthWeight);
    const emaDrawdown = weightedEma(cur?.emaDrawdown ?? 0.0, maxDrawdown ?? 0.0, alpha, healthWeight);

    await CredibilityModel.updateOne(
      { keyHash: hash },
      {
        $set: {
          keyHash: hash,
          kind: "MODEL",
          modelId,
          horizon,
          n,
          emaScore,
          emaReturn,
          emaDrawdown,
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
    
    const healthNote = healthWeight < 1.0 ? ` (health=${healthState}, weight=${healthWeight})` : "";
    console.log(`[Credibility] Updated MODEL ${modelId}:${horizon}: score=${emaScore.toFixed(3)} n=${n}${healthNote}`);
  }

  async updateRegime(
    regime: string,
    success01: number,
    realizedReturn: number,
    maxDrawdown: number | undefined,
    horizon: Horizon,
    healthState?: HealthState  // Block 2: Optional health state
  ): Promise<void> {
    const alpha = alphaForHorizon(horizon);
    const healthWeight = HEALTH_CREDIBILITY_WEIGHTS[healthState ?? "HEALTHY"];
    const k = { kind: "REGIME", regime };
    const hash = keyHash(k);

    const cur = await CredibilityModel.findOne({ keyHash: hash }).lean();
    const n = (cur?.n ?? 0) + 1;

    // Block 2: Use weighted EMA when health is degraded
    const emaScore = weightedEma(cur?.emaScore ?? 0.5, success01, alpha, healthWeight);
    const emaReturn = weightedEma(cur?.emaReturn ?? 0.0, realizedReturn, alpha, healthWeight);
    const emaDrawdown = weightedEma(cur?.emaDrawdown ?? 0.0, maxDrawdown ?? 0.0, alpha, healthWeight);

    await CredibilityModel.updateOne(
      { keyHash: hash },
      {
        $set: {
          keyHash: hash,
          kind: "REGIME",
          regime,
          n,
          emaScore,
          emaReturn,
          emaDrawdown,
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
    
    const healthNote = healthWeight < 1.0 ? ` (health=${healthState}, weight=${healthWeight})` : "";
    console.log(`[Credibility] Updated REGIME ${regime}: score=${emaScore.toFixed(3)} n=${n}${healthNote}`);
  }

  async getConfidenceModifier(args: {
    symbol: string;
    modelId: string;
    horizon: Horizon;
    regime?: string;
  }): Promise<{ modifier: number; notes: string }> {
    const sym = await CredibilityModel.findOne({ kind: "SYMBOL", symbol: args.symbol }).lean();
    const mod = await CredibilityModel.findOne({ 
      kind: "MODEL", 
      modelId: args.modelId, 
      horizon: args.horizon 
    }).lean();
    const reg = args.regime 
      ? await CredibilityModel.findOne({ kind: "REGIME", regime: args.regime }).lean() 
      : null;

    const symCred = sym?.emaScore ?? 0.5;
    const modCred = mod?.emaScore ?? 0.5;
    const regCred = reg?.emaScore ?? 0.5;

    // Weighted combination
    const calib = 0.50 * symCred + 0.30 * modCred + 0.20 * regCred;

    // Map 0..1 -> 0.6..1.1 (conservative)
    const modifier = 0.6 + 0.5 * calib;
    const notes = `cred(sym=${symCred.toFixed(2)}, model=${modCred.toFixed(2)}, reg=${regCred.toFixed(2)})`;

    return { modifier, notes };
  }

  async getAll(): Promise<any[]> {
    return CredibilityModel.find().lean();
  }

  async getBySymbol(symbol: string): Promise<any[]> {
    return CredibilityModel.find({ symbol }).lean();
  }
}

console.log('[Evolution] Credibility service loaded (Block 2: health-weighted)');
