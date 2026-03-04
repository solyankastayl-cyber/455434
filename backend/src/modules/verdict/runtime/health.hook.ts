/**
 * HEALTH HOOK
 * 
 * Port for Shadow Monitor health damping (per horizon)
 * 
 * Block 1: Extended return type to include full health snapshot
 * for Evolution credibility weighting.
 */

import type { Horizon } from "../contracts/verdict.types.js";

export type HealthState = "HEALTHY" | "DEGRADED" | "CRITICAL";

export type HealthResult = {
  modifier: number; // 1.0 / 0.6 / 0.3
  state: HealthState;
  ece?: number;          // Expected Calibration Error
  divergence?: number;   // Model divergence metric
  criticalStreak?: number; // Consecutive critical readings
  notes?: string;
};

export interface HealthPort {
  getHealthModifier(args: { horizon: Horizon; modelId?: string }): Promise<HealthResult>;
}

export class NoopHealth implements HealthPort {
  async getHealthModifier(): Promise<HealthResult> {
    return { modifier: 1.0, state: "HEALTHY" };
  }
}

console.log('[Verdict] Health hook loaded');
