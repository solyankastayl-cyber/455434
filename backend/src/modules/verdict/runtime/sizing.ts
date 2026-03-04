/**
 * VERDICT SIZING
 * 
 * Action decision + position sizing logic
 */

import type { Action, RiskLevel } from "../contracts/verdict.types.js";
import { clamp } from "./utils.js";

export function decideAction(expectedReturn: number, confidence: number, allowShort: boolean): Action {
  // v3: Lower thresholds for production signal generation
  // After macro/credibility adjustments, confidence often drops to 0.25-0.35 range
  // Threshold set to 0.20 to ensure meaningful signal distribution
  const r = expectedReturn;
  if (confidence < 0.20) return "HOLD";  // Only HOLD if confidence < 20%
  if (r > 0.003) return "BUY";           // 0.3% expected move = BUY signal
  if (r < -0.003) return "SELL";         // -0.3% expected move = SELL signal
  return "HOLD";
}

export function decideRisk(confidence: number): RiskLevel {
  // v2: Adjusted thresholds to match new confidence ranges
  if (confidence >= 0.65) return "LOW";    // High confidence = low risk
  if (confidence >= 0.50) return "MEDIUM"; // Moderate confidence
  return "HIGH";                           // Low confidence = high risk
}

export function decideSizePct(confidence: number, risk: RiskLevel, maxPct: number): number {
  // v1: small, conservative. (confidence 0.52..0.9) maps into 0..maxPct
  const base = clamp((confidence - 0.52) / 0.38, 0, 1); // 0..1
  const riskMul = risk === "LOW" ? 1.0 : risk === "MEDIUM" ? 0.7 : 0.4;
  return clamp(base * riskMul * maxPct, 0, maxPct);
}

console.log('[Verdict] Sizing loaded');
