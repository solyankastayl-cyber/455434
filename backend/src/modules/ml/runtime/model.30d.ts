/**
 * MODEL 30D
 * 
 * Long-term macro-driven model
 */

import type { HorizonModel, ModelPrediction } from "../contracts/model.types.js";

export class Model30D implements HorizonModel {
  horizon: "30D" = "30D";

  async predict(input: { symbol: string; features: Record<string, number>; ts: string }): Promise<ModelPrediction> {
    const macroTrend = input.features.trend_30d ?? 0;
    const macroBias = input.features.macro_bias ?? 0;
    const btcDominance = input.features.btc_dominance ?? 50;
    const fearGreed = input.features.fear_greed ?? 50;

    // Direction from macro trend + sentiment
    const sentimentBias = (fearGreed - 50) / 100 * 0.3;
    const expectedReturn = macroTrend * 1.2 + macroBias * 0.15 + sentimentBias;
    
    // Confidence: lower for long-term (more uncertainty)
    let confidence = 0.3 + Math.abs(macroTrend) * 0.4 + Math.abs(macroBias) * 0.2;
    confidence = Math.max(0.25, Math.min(0.70, confidence));

    // Extreme fear/greed reduces confidence
    if (fearGreed < 20 || fearGreed > 80) {
      confidence = confidence * 0.9;
    }

    return {
      horizon: "30D",
      expectedReturn,
      confidence,
      modelId: "model_30d_v1",
    };
  }
}

console.log('[ML] Model 30D loaded');
