/**
 * MODEL 1D
 * 
 * Short-term momentum-based model
 */

import type { HorizonModel, ModelPrediction } from "../contracts/model.types.js";

export class Model1D implements HorizonModel {
  horizon: "1D" = "1D";

  async predict(input: { symbol: string; features: Record<string, number>; ts: string }): Promise<ModelPrediction> {
    const momentum = input.features.momentum_1d ?? 0;
    const volatility = input.features.volatility_1d ?? 0.02;
    const rsi = input.features.rsi ?? 50;
    const volume = input.features.volume_change ?? 0;

    // Direction from momentum
    const expectedReturn = momentum * 0.6 + (rsi > 70 ? -0.02 : rsi < 30 ? 0.02 : 0);
    
    // Confidence: higher with strong momentum, lower with high volatility
    let confidence = 0.5 + Math.abs(momentum) * 0.4 - volatility * 0.3;
    confidence = Math.max(0.35, Math.min(0.85, confidence));

    // Boost confidence if volume confirms direction
    if (Math.sign(volume) === Math.sign(momentum)) {
      confidence = Math.min(0.90, confidence + 0.05);
    }

    return {
      horizon: "1D",
      expectedReturn,
      confidence,
      modelId: "model_1d_v1",
    };
  }
}

console.log('[ML] Model 1D loaded');
