/**
 * ENSEMBLE SELECTOR
 * 
 * Cross-horizon voting: evaluate all horizons and pick best by utility
 */

import type { Horizon, Action, RiskLevel } from "../contracts/verdict.types.js";
import { clamp01 } from "./utils.js";

export type HorizonCandidate = {
  horizon: Horizon;
  modelId: string;

  expectedReturn: number;
  confidence: number;

  action: Action;
  risk: RiskLevel;
  positionSizePct: number;

  // internal score to pick winner
  utility: number;

  notes?: string[];
};

export function computeUtility(c: HorizonCandidate): number {
  // 70% версия: понятная, не "наука ради науки"
  // Цель: reward signal strength, penalize risk, ignore HOLD mostly
  if (c.action === "HOLD") return -1;

  const signal = Math.abs(c.expectedReturn) * c.confidence; // strength
  const riskPenalty = c.risk === "LOW" ? 1.0 : c.risk === "MEDIUM" ? 0.85 : 0.70;

  // size already includes confidence/risk impact, use lightly
  const sizeBoost = 0.8 + 0.2 * clamp01(c.positionSizePct / 1.0);

  return signal * riskPenalty * sizeBoost;
}

console.log('[Verdict] Ensemble selector loaded');
