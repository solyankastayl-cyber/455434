/**
 * CALIBRATION HOOK
 * 
 * Port for Evolution credibility-based calibration
 */

import type { VerdictAdjustment, Horizon } from "../contracts/verdict.types.js";
import { clamp, clamp01 } from "./utils.js";

export interface CalibrationPort {
  // returns modifier 0.6..1.1 for confidence
  getConfidenceModifier(args: {
    symbol: string;
    modelId: string;
    horizon: Horizon;
    regime?: string;
  }): Promise<{ modifier: number; notes?: string }>;
}

export class NoopCalibration implements CalibrationPort {
  async getConfidenceModifier(): Promise<{ modifier: number; notes?: string }> {
    return { modifier: 1.0 };
  }
}

export function applyCalibration(confidence: number, modifier: number): number {
  const c0 = clamp01(confidence);
  const m = clamp(modifier, 0.6, 1.1);
  return clamp01(c0 * m);
}

export function calibrationAdjustment(before: number, after: number, notes?: string): VerdictAdjustment | null {
  const delta = after - before;
  if (Math.abs(delta) < 1e-6) return null;
  return {
    stage: "CALIBRATION",
    key: "CREDIBILITY_MODIFIER",
    deltaConfidence: delta,
    notes,
  };
}

console.log('[Verdict] Calibration hook loaded');
