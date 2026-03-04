/**
 * MODEL REGISTRY
 * 
 * Central registry for all horizon models
 */

import type { HorizonModel, ModelPrediction } from "../contracts/model.types.js";
import { Model1D } from "./model.1d.js";
import { Model7D } from "./model.7d.js";
import { Model30D } from "./model.30d.js";

export class ModelRegistry {
  private models: HorizonModel[];

  constructor() {
    this.models = [
      new Model1D(),
      new Model7D(),
      new Model30D(),
    ];
  }

  async predictAll(input: {
    symbol: string;
    features: Record<string, number>;
    ts: string;
  }): Promise<ModelPrediction[]> {
    const results: ModelPrediction[] = [];

    for (const m of this.models) {
      try {
        const pred = await m.predict(input);
        results.push(pred);
      } catch (err: any) {
        console.warn(`[ModelRegistry] Error in ${m.horizon}:`, err.message);
      }
    }

    return results;
  }

  getModels(): HorizonModel[] {
    return this.models;
  }
}

console.log('[ML] Model registry loaded');
