/**
 * MODEL SELECTOR
 * 
 * Gets predictions from all models for Verdict Engine
 */

import type { ModelRegistry } from "./model.registry.js";
import type { ModelPrediction } from "../contracts/model.types.js";

export class ModelSelector {
  constructor(private registry: ModelRegistry) {}

  async getPredictions(args: {
    symbol: string;
    ts: string;
    features: Record<string, number>;
  }): Promise<ModelPrediction[]> {
    return this.registry.predictAll(args);
  }
}

console.log('[ML] Model selector loaded');
