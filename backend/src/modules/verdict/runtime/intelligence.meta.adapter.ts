/**
 * INTELLIGENCE META-BRAIN ADAPTER
 * 
 * Connects Verdict Engine to existing /modules/intelligence/
 */

import type { MetaBrainPort, MetaBrainInput, MetaBrainOutput } from "./meta_brain.hook.js";
import { applyMetaBrainToForecast } from "../../intelligence/index.js";
import type { ForecastDirection, ForecastHorizon } from "../../exchange/forecast/forecast.types.js";

export class IntelligenceMetaBrainAdapter implements MetaBrainPort {
  async adjust(input: MetaBrainInput): Promise<MetaBrainOutput> {
    try {
      // Map action to direction
      let direction: ForecastDirection = "FLAT";
      if (input.action === "BUY") direction = "UP";
      else if (input.action === "SELL") direction = "DOWN";

      const result = await applyMetaBrainToForecast({
        asset: input.snapshot.symbol?.replace("USDT", "") || "BTC",
        horizon: "1D" as ForecastHorizon, // Will be updated per-horizon
        direction,
        confidence: input.confidence,
        expectedMovePct: input.expectedReturn * 100, // Convert to percentage
        basePrice: input.snapshot.price || 0,
        asOfTs: Date.now(),
      });

      // Map back to verdict format
      let action = input.action;
      if (result.action === "BUY") action = "BUY";
      else if (result.action === "SELL") action = "SELL";
      else if (result.action === "AVOID") action = "HOLD";

      return {
        action,
        expectedReturn: result.expectedMovePct / 100, // Convert back to decimal
        confidence: result.confidence,
        risk: result.riskLevel,
        adjustments: result.appliedOverlays.map(o => ({
          stage: "META_BRAIN" as const,
          key: o.id,
          deltaConfidence: o.effect === "CAP_CONFIDENCE" && o.value ? -(1 - o.value) * input.confidence : undefined,
          notes: o.reason,
        })),
      };
    } catch (err: any) {
      console.warn('[IntelligenceAdapter] Error:', err.message);
      return { ...input, adjustments: [] };
    }
  }
}

console.log('[Verdict] Intelligence adapter loaded');
