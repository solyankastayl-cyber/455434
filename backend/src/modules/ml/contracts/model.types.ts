/**
 * ML MODEL TYPES
 */

export type Horizon = "1D" | "7D" | "30D";

export type ModelPrediction = {
  horizon: Horizon;
  expectedReturn: number;   // signed
  confidence: number;       // 0..1
  modelId: string;
};

export interface HorizonModel {
  horizon: Horizon;

  predict(input: {
    symbol: string;
    features: Record<string, number>;
    ts: string;
  }): Promise<ModelPrediction>;
}

console.log('[ML] Model types loaded');
