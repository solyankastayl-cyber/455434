/**
 * SHADOW HEALTH ADAPTER
 * =====================
 * 
 * Connects Verdict Engine to ML Shadow Monitor Service.
 * Provides health-based confidence damping per horizon.
 * 
 * HEALTHY (ECE ≤ 0.20) → modifier 1.0
 * DEGRADED (ECE ≤ 0.30) → modifier 0.6
 * CRITICAL (ECE > 0.30) → modifier 0.3
 * 
 * Block 1: Extended to return full health snapshot for Evolution.
 */

import type { HealthPort, HealthState, HealthResult } from "../runtime/health.hook.js";
import type { Horizon } from "../contracts/verdict.types.js";
import { mlShadowMonitorService } from "../../exchange-ml/ml.shadow.monitor.service.js";

// Health state to modifier mapping
const HEALTH_MODIFIERS: Record<HealthState, number> = {
  HEALTHY: 1.0,
  DEGRADED: 0.6,
  CRITICAL: 0.3,
};

export class ShadowHealthAdapter implements HealthPort {
  async getHealthModifier(args: {
    horizon: Horizon;
    modelId?: string;
  }): Promise<HealthResult> {
    try {
      // Get current monitor state
      const state = mlShadowMonitorService.getState();
      
      const modifier = HEALTH_MODIFIERS[state.health] ?? 1.0;
      
      // Build notes for audit trail
      let notes: string | undefined;
      if (state.health !== "HEALTHY") {
        notes = `ECE=${state.metrics?.ece?.toFixed(3) || "N/A"}, streak=${state.criticalStreak}`;
      }
      if (state.metrics?.divergence && state.metrics.divergence > 0.3) {
        notes = (notes ? notes + ", " : "") + `divergence=${state.metrics.divergence.toFixed(2)}`;
      }
      
      // Log if degraded/critical
      if (state.health !== "HEALTHY") {
        console.log(
          `[ShadowHealthAdapter] ${args.horizon} health=${state.health}, ` +
          `modifier=${modifier}, ${notes || ""}`
        );
      }
      
      // Block 1: Return full snapshot for Evolution
      return {
        modifier,
        state: state.health,
        ece: state.metrics?.ece,
        divergence: state.metrics?.divergence,
        criticalStreak: state.criticalStreak,
        notes,
      };
    } catch (err: any) {
      console.warn("[ShadowHealthAdapter] Error getting health:", err.message);
      // Fallback to healthy if service unavailable
      return {
        modifier: 1.0,
        state: "HEALTHY",
        notes: "Service unavailable, using default",
      };
    }
  }
}

console.log("[Verdict] Shadow health adapter loaded");
