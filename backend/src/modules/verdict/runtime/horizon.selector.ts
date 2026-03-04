/**
 * HORIZON SELECTOR
 * 
 * v1: Pick horizon with max signal = confidenceRaw * abs(expectedReturn)
 */

import type { Horizon, ModelOutput, VerdictContext } from "../contracts/verdict.types.js";
import { clamp01 } from "./utils.js";

export function selectHorizon(ctx: VerdictContext): Horizon {
  let best: { h: Horizon; score: number } | null = null;

  for (const o of ctx.outputs) {
    const s = clamp01(o.confidenceRaw) * Math.abs(o.expectedReturn || 0);
    if (!best || s > best.score) best = { h: o.horizon, score: s };
  }
  return best?.h ?? "7D";
}

export function pickOutput(outputs: ModelOutput[], horizon: Horizon): ModelOutput {
  const found = outputs.find(o => o.horizon === horizon);
  if (!found) throw new Error(`ModelOutput not found for horizon=${horizon}`);
  return found;
}

console.log('[Verdict] Horizon selector loaded');
