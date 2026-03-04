/**
 * MODEL 7D
 * 
 * Medium-term trend-following model
 */

import type { HorizonModel, ModelPrediction } from "../contracts/model.types.js";

export class Model7D implements HorizonModel {
  horizon: "7D" = "7D";

  async predict(input: { symbol: string; features: Record<string, number>; ts: string }): Promise<ModelPrediction> {
    const trend = input.features.trend_7d ?? 0;
    const volumeGrowth = input.features.volume_growth_7d ?? 0;
    const macd = input.features.macd ?? 0;
    const regime = input.features.regime_score ?? 0;

    // Direction from trend + MACD
    const expectedReturn = trend * 0.7 + macd * 0.1;
    
    // Confidence: trend strength + volume confirmation
    let confidence = 0.4 + Math.abs(trend) * 0.5 + volumeGrowth * 0.1;
    confidence = Math.max(0.30, Math.min(0.80, confidence));

    // Regime adjustment
    if (regime > 0.5 && Math.sign(trend) > 0) {
      confidence = Math.min(0.85, confidence + 0.05);
    }

    return {
      horizon: "7D",
      expectedReturn,
      confidence,
      modelId: "model_7d_v1",
    };
  }
}

console.log('[ML] Model 7D loaded');
