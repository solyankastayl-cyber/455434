/**
 * LIGHT OVERLAY SERVICE
 * =====================
 * 
 * P3: Smart Caching Layer - Block 2
 * Fast real-time adjustments on top of cached heavy verdict.
 * 
 * This service is designed to be:
 * - Fast (no ML, no heavy computations)
 * - Deterministic (same inputs = same outputs)
 * - Independent of cache state
 * 
 * Applies adjustments for:
 * - Macro risk regime
 * - Volatility uncertainty
 * - Funding crowdedness
 */

import type { OverlayInputs, OverlayResult, OverlayAdjustment } from './light-overlay.types.js';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Risk level confidence caps
const RISK_CAPS: Record<string, number> = {
  LOW: 0.85,
  MEDIUM: 0.70,
  HIGH: 0.55,
  EXTREME: 0.45,
};

export class LightOverlayService {
  /**
   * Apply light overlay adjustments to raw confidence
   */
  apply(rawConfidence: number, inputs: OverlayInputs): OverlayResult {
    let mult = 1.0;
    const adj: OverlayAdjustment[] = [];
    const raw = clamp01(rawConfidence);

    // 1) Macro confidence multiplier (most important)
    if (inputs.macro?.confidenceMult != null) {
      const m = inputs.macro.confidenceMult;
      mult *= m;
      adj.push({
        key: 'MACRO_MULT',
        deltaPct: (m - 1) * 100,
        note: inputs.macro.regime
          ? `Macro regime: ${inputs.macro.regime}`
          : 'Macro multiplier',
      });
    } else if (inputs.macro?.riskLevel) {
      // Fallback: apply risk level caps
      const cap = RISK_CAPS[inputs.macro.riskLevel] ?? 1.0;
      const capped = Math.min(raw * mult, cap);
      const capMult = raw > 0 ? capped / raw : 1.0;
      
      if (Math.abs(capMult - mult) > 0.001) {
        adj.push({
          key: 'RISK_CAP',
          deltaPct: (capMult / mult - 1) * 100,
          note: `Risk cap: ${inputs.macro.riskLevel} (max ${Math.round(cap * 100)}%)`,
        });
        mult = capMult;
      }
    }

    // 2) Volatility / uncertainty
    if (inputs.volatility?.uncertaintyMult != null) {
      const v = inputs.volatility.uncertaintyMult;
      mult *= v;
      adj.push({
        key: 'VOL_MULT',
        deltaPct: (v - 1) * 100,
        note: inputs.volatility.volRegime
          ? `Vol regime: ${inputs.volatility.volRegime}`
          : 'Vol multiplier',
      });
    } else if (inputs.volatility?.volRegime) {
      // Apply volatility regime multipliers
      const volMults: Record<string, number> = {
        LOW: 1.0,
        NORMAL: 0.95,
        HIGH: 0.85,
      };
      const volMult = volMults[inputs.volatility.volRegime] ?? 1.0;
      if (volMult !== 1.0) {
        mult *= volMult;
        adj.push({
          key: 'VOL_REGIME',
          deltaPct: (volMult - 1) * 100,
          note: `Vol regime: ${inputs.volatility.volRegime}`,
        });
      }
    }

    // 3) Funding / crowding
    if (inputs.funding?.fundingMult != null) {
      const f = inputs.funding.fundingMult;
      mult *= f;
      adj.push({
        key: 'FUNDING_MULT',
        deltaPct: (f - 1) * 100,
        note: 'Funding / crowding adjustment',
      });
    } else if (inputs.funding?.crowdedness != null && inputs.funding.crowdedness > 0.5) {
      // High crowdedness = reduce confidence
      const crowdMult = 1 - (inputs.funding.crowdedness - 0.5) * 0.3; // Max -15%
      mult *= crowdMult;
      adj.push({
        key: 'FUNDING_CROWD',
        deltaPct: (crowdMult - 1) * 100,
        note: `Funding crowded: ${Math.round(inputs.funding.crowdedness * 100)}%`,
      });
    }

    const adjusted = clamp01(raw * mult);
    const positionSizeMult = clamp01(mult);

    return {
      rawConfidence: raw,
      adjustedConfidence: adjusted,
      confidenceMultTotal: mult,
      adjustments: adj,
      positionSizeMult,
    };
  }
}

// Singleton instance
export const lightOverlayService = new LightOverlayService();

console.log('[LightOverlayService] Module loaded');
