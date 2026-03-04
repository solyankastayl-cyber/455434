/**
 * P12.0 — Scenario Sanity Service
 * 
 * TAIL Eligibility Gate + Scenario Prior Stabilizer
 * 
 * Purpose:
 * - TAIL should be rare (5-25%), not default
 * - Prevents "eternal apocalypse" mode
 * - Maintains deterministic, explainable decisions
 */

import { ScenarioName, ScenarioDiagnostics } from '../contracts/brain_output.contract.js';
import type { GuardLevel } from '../contracts/asset_state.contract.js';

// ═══════════════════════════════════════════════════════════════════
// THRESHOLDS (P12.0 spec)
// ═══════════════════════════════════════════════════════════════════

const THRESHOLDS = {
  // TAIL gate thresholds (softened per P12.0 FIX #1)
  q05_hard_tail: -0.02,           // q05 <= -2% for TAIL eligibility (was -3%)
  spread_norm_tail: 1.10,         // spreadNorm >= 1.10 for TAIL eligibility (was 1.25)
  guard_levels_tail: ['CRISIS', 'BLOCK'] as GuardLevel[],
  cross_asset_risk_off: ['RISK_OFF_SYNC', 'FLIGHT_TO_QUALITY'],
  tail_gate_min_conditions: 2,    // Need ≥2 of 4 conditions for TAIL
  
  // RISK gate thresholds (FIX #2: separate gate for RISK)
  risk_gate_min_conditions: 1,    // Need ≥1 of 4 conditions for RISK
  risk_score_threshold: 0.45,     // OR riskScore >= 0.45
  
  // Anti-collapse (tail rate penalty) - raised triggers per FIX #5
  tail_rate_penalty_45: 0.70,     // Multiply P_tail by this if tailRate > 0.45 (was 0.35)
  tail_rate_penalty_65: 0.55,     // Multiply P_tail by this if tailRate > 0.65 (was 0.50)
  tail_rate_threshold_45: 0.45,
  tail_rate_threshold_65: 0.65,
  
  // Temperature scaling
  concentration_threshold_55: 0.55,
  concentration_threshold_70: 0.70,
  temperature_55: 1.25,
  temperature_70: 1.40,
  
  // Prior weights (adaptive per FIX #4)
  prior_blend_default: 0.35,
  prior_blend_confident: 0.25,    // When concentration > 0.55
  
  // Default priors (expected distribution in "normal world")
  // P12.1 FIX: Adjusted to target distribution BASE 55-80%, RISK 15-40%, TAIL 2-15%
  priors: {
    BASE: 0.65,   // Raised from 0.55
    RISK: 0.27,   // Lowered from 0.32 (RISK is earned, not default)
    TAIL: 0.08,   // Lowered from 0.13 (TAIL should be rare)
  } as Record<ScenarioName, number>,
};

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface SanityInput {
  // Quantile data
  q05: number;
  q50: number;
  q95: number;
  mean: number;              // For spreadNorm calculation
  
  // Volatility (for better spreadNorm - FIX #3)
  realizedVol?: number;      // 20d or 60d realized vol
  
  // Context
  guardLevel: GuardLevel;
  crossAssetRegime?: string;
  
  // Rolling history
  tailRateRolling: number;        // TAIL rate over last N steps (0..1)
  
  // Raw probabilities from quantile rules
  rawProbs: Record<ScenarioName, number>;
  
  // Risk score for RISK gate (FIX #2)
  riskScore?: number;
}

export interface SanityOutput {
  finalProbs: Record<ScenarioName, number>;
  finalScenario: ScenarioName;
  diagnostics: ScenarioDiagnostics;
}

// Diagnostic data for timeline endpoint
export interface GateDiagnostics {
  c1_guard: boolean;
  c2_q05: boolean;
  c3_spread: boolean;
  c4_crossAsset: boolean;
  countTrue: number;
  q05: number;
  spreadNorm: number;
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════

let instance: BrainScenarioSanityService | null = null;

export function getBrainScenarioSanityService(): BrainScenarioSanityService {
  if (!instance) {
    instance = new BrainScenarioSanityService();
  }
  return instance;
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════

class BrainScenarioSanityService {
  
  /**
   * Main entry point: apply sanity layer to raw scenario probabilities
   */
  applySanity(input: SanityInput): SanityOutput {
    const { rawProbs, tailRateRolling } = input;
    
    // Step 1: Normalize inputs
    const { spreadNorm, downNorm } = this.normalizeMetrics(input);
    
    // Step 2: Apply priors blend
    const afterPriors = this.blendWithPriors(rawProbs, input);
    
    // Step 3: TAIL + RISK Eligibility Gates (FIX #2)
    const { probs: afterGate, passed: gatePassed, reasons, gateDiag } = this.applyTailGate(afterPriors, input);
    
    // Step 4: Tail rate penalty (anti-collapse)
    const { probs: afterPenalty, penalty } = this.applyTailRatePenalty(afterGate, tailRateRolling);
    
    // Step 5: Temperature scaling (anti-concentration)
    const { probs: afterTemperature, temperature, concentration } = this.applyTemperature(afterPenalty);
    
    // Step 6: Final normalization and scenario selection
    const finalProbs = this.normalize(afterTemperature);
    const finalScenario = this.selectScenario(finalProbs);
    
    // Build diagnostics with gate info
    const diagnostics: ScenarioDiagnostics = {
      rawProbabilities: rawProbs,
      afterPriors,
      afterGate,
      afterPenalty,
      afterTemperature,
      appliedTemperature: temperature,
      eligibilityGatePassed: gatePassed,
      tailEligibilityReasons: reasons,
      tailRateRolling,
      concentration,
      scenarioPriorPenalty: penalty,
      // Add gate diagnostics for timeline analysis
      gateDiagnostics: gateDiag,
    } as ScenarioDiagnostics & { gateDiagnostics: GateDiagnostics };
    
    return {
      finalProbs,
      finalScenario,
      diagnostics,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────
  // STEP 1: Normalize metrics (FIX #3: better spreadNorm)
  // ─────────────────────────────────────────────────────────────────
  
  private normalizeMetrics(input: SanityInput): { spreadNorm: number; downNorm: number } {
    const { q05, q50, q95, mean, realizedVol } = input;
    
    // Spread (width of uncertainty)
    const spread = q95 - q05;
    
    // FIX #3: Use realizedVol for better spreadNorm
    // Priority: realizedVol > abs(mean) > abs(q50)
    let denominator: number;
    if (realizedVol && realizedVol > 0.01) {
      denominator = realizedVol + 0.02;
    } else if (mean !== undefined) {
      denominator = Math.abs(mean) + 0.03;
    } else {
      denominator = Math.abs(q50) + 0.04;
    }
    
    const spreadNorm = spread / denominator;
    
    // Downside severity
    const down = Math.max(0, -q05);
    const downNorm = down / 0.04;
    
    return { spreadNorm, downNorm };
  }
  
  // ─────────────────────────────────────────────────────────────────
  // STEP 2: Blend with priors (FIX #4: adaptive blend)
  // ─────────────────────────────────────────────────────────────────
  
  private blendWithPriors(raw: Record<ScenarioName, number>, input?: SanityInput): Record<ScenarioName, number> {
    const { priors, prior_blend_default, prior_blend_confident } = THRESHOLDS;
    
    // Calculate concentration to decide blend weight
    const entropy = this.calculateEntropy(raw);
    const maxEntropy = Math.log(3);
    const concentration = 1 - entropy / maxEntropy;
    
    // FIX #4: When model is confident, use less prior weight
    let priorsWeight = concentration > 0.55 ? prior_blend_confident : prior_blend_default;
    
    // P12.1 FIX: Stronger prior blend when spreadNorm is extremely high
    // This prevents over-reaction to extreme uncertainty
    if (input) {
      const { spreadNorm } = this.normalizeMetrics(input);
      if (spreadNorm > 2.5) {
        // Very high spread: use 60% priors (strong stabilization)
        priorsWeight = 0.60;
      } else if (spreadNorm > 2.0) {
        // High spread: use 50% priors
        priorsWeight = 0.50;
      } else if (spreadNorm > 1.5) {
        // Elevated spread: use 40% priors
        priorsWeight = Math.max(priorsWeight, 0.40);
      }
    }
    
    return {
      BASE: (1 - priorsWeight) * raw.BASE + priorsWeight * priors.BASE,
      RISK: (1 - priorsWeight) * raw.RISK + priorsWeight * priors.RISK,
      TAIL: (1 - priorsWeight) * raw.TAIL + priorsWeight * priors.TAIL,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────
  // STEP 3: TAIL Eligibility Gate (2 of 4 conditions)
  //         + RISK Gate (1 of 4 OR riskScore) per FIX #2
  // ─────────────────────────────────────────────────────────────────
  
  private applyTailGate(
    probs: Record<ScenarioName, number>,
    input: SanityInput
  ): { probs: Record<ScenarioName, number>; passed: boolean; reasons: string[]; gateDiag: GateDiagnostics } {
    const { q05, guardLevel, crossAssetRegime, riskScore } = input;
    const { spreadNorm } = this.normalizeMetrics(input);
    
    const reasons: string[] = [];
    
    // Check all 4 conditions
    const c1 = THRESHOLDS.guard_levels_tail.includes(guardLevel);
    const c2 = q05 <= THRESHOLDS.q05_hard_tail;
    const c3 = spreadNorm >= THRESHOLDS.spread_norm_tail;
    const c4 = crossAssetRegime ? THRESHOLDS.cross_asset_risk_off.includes(crossAssetRegime) : false;
    
    const conditionsMet = [c1, c2, c3, c4].filter(Boolean).length;
    
    // Log reasons
    if (c1) reasons.push(`C1: guardLevel=${guardLevel} (CRISIS/BLOCK)`);
    if (c2) reasons.push(`C2: q05=${(q05 * 100).toFixed(2)}% <= -2%`);
    if (c3) reasons.push(`C3: spreadNorm=${spreadNorm.toFixed(2)} >= 1.10`);
    if (c4) reasons.push(`C4: crossAsset=${crossAssetRegime} (risk-off)`);
    
    const gateDiag: GateDiagnostics = {
      c1_guard: c1,
      c2_q05: c2,
      c3_spread: c3,
      c4_crossAsset: c4,
      countTrue: conditionsMet,
      q05,
      spreadNorm,
    };
    
    // TAIL gate: need ≥2 conditions
    const tailPassed = conditionsMet >= THRESHOLDS.tail_gate_min_conditions;
    
    // RISK gate: need ≥1 condition OR riskScore >= 0.45 (FIX #2)
    const riskPassed = conditionsMet >= THRESHOLDS.risk_gate_min_conditions || 
                       (riskScore !== undefined && riskScore >= THRESHOLDS.risk_score_threshold);
    
    // Apply cascading gates: TAIL → RISK → BASE
    if (!tailPassed && probs.TAIL > 0.05) {
      // TAIL not allowed - redistribute
      const tailTransfer = probs.TAIL * 0.9;
      
      if (riskPassed) {
        // Fallback TAIL → RISK
        return {
          probs: this.normalize({
            BASE: probs.BASE,
            RISK: probs.RISK + tailTransfer,
            TAIL: probs.TAIL * 0.1,
          }),
          passed: false,
          reasons: [...reasons, `TAIL GATE FAILED (${conditionsMet}/4 < 2): fallback to RISK`],
          gateDiag,
        };
      } else {
        // Both TAIL and RISK not allowed - all to BASE
        return {
          probs: this.normalize({
            BASE: probs.BASE + tailTransfer * 0.7,
            RISK: probs.RISK + tailTransfer * 0.3,
            TAIL: probs.TAIL * 0.1,
          }),
          passed: false,
          reasons: [...reasons, `BOTH GATES FAILED: fallback to BASE`],
          gateDiag,
        };
      }
    }
    
    // Check RISK gate for RISK probability
    if (!riskPassed && probs.RISK > 0.20) {
      // RISK not strongly justified, dampen slightly
      const riskDampen = probs.RISK * 0.3;
      return {
        probs: this.normalize({
          BASE: probs.BASE + riskDampen,
          RISK: probs.RISK - riskDampen,
          TAIL: probs.TAIL,
        }),
        passed: tailPassed,
        reasons: [...reasons, `RISK dampened (countTrue=${conditionsMet}, riskScore=${riskScore?.toFixed(2) || 'N/A'})`],
        gateDiag,
      };
    }
    
    return { probs, passed: tailPassed, reasons, gateDiag };
  }
  
  // ─────────────────────────────────────────────────────────────────
  // STEP 4: Tail rate penalty (anti-collapse) - FIX #5: raised triggers
  // ─────────────────────────────────────────────────────────────────
  
  private applyTailRatePenalty(
    probs: Record<ScenarioName, number>,
    tailRateRolling: number
  ): { probs: Record<ScenarioName, number>; penalty: number } {
    let penalty = 1.0;
    
    // FIX #5: Raised triggers from 35%/50% to 45%/65%
    if (tailRateRolling > THRESHOLDS.tail_rate_threshold_65) {
      penalty = THRESHOLDS.tail_rate_penalty_65;
    } else if (tailRateRolling > THRESHOLDS.tail_rate_threshold_45) {
      penalty = THRESHOLDS.tail_rate_penalty_45;
    }
    
    if (penalty < 1.0) {
      const newTail = probs.TAIL * penalty;
      const transfer = probs.TAIL - newTail;
      
      return {
        probs: this.normalize({
          BASE: probs.BASE + transfer * 0.5,
          RISK: probs.RISK + transfer * 0.5,
          TAIL: newTail,
        }),
        penalty,
      };
    }
    
    return { probs, penalty };
  }
  
  // ─────────────────────────────────────────────────────────────────
  // STEP 5: Temperature scaling (anti-concentration)
  // ─────────────────────────────────────────────────────────────────
  
  private applyTemperature(
    probs: Record<ScenarioName, number>
  ): { probs: Record<ScenarioName, number>; temperature: number; concentration: number } {
    // Calculate entropy
    const entropy = this.calculateEntropy(probs);
    const maxEntropy = Math.log(3);
    const concentration = 1 - entropy / maxEntropy;
    
    let temperature = 1.0;
    
    if (concentration > THRESHOLDS.concentration_threshold_70) {
      temperature = THRESHOLDS.temperature_70;
    } else if (concentration > THRESHOLDS.concentration_threshold_55) {
      temperature = THRESHOLDS.temperature_55;
    }
    
    if (temperature > 1.0) {
      // Apply temperature scaling: p_i = exp(log(p_i) / temperature)
      const scaled: Record<ScenarioName, number> = {
        BASE: Math.exp(Math.log(Math.max(probs.BASE, 0.001)) / temperature),
        RISK: Math.exp(Math.log(Math.max(probs.RISK, 0.001)) / temperature),
        TAIL: Math.exp(Math.log(Math.max(probs.TAIL, 0.001)) / temperature),
      };
      
      return {
        probs: this.normalize(scaled),
        temperature,
        concentration,
      };
    }
    
    return { probs, temperature, concentration };
  }
  
  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────
  
  private calculateEntropy(probs: Record<ScenarioName, number>): number {
    let entropy = 0;
    for (const p of Object.values(probs)) {
      if (p > 0.001) {
        entropy -= p * Math.log(p);
      }
    }
    return entropy;
  }
  
  private normalize(probs: Record<ScenarioName, number>): Record<ScenarioName, number> {
    const sum = probs.BASE + probs.RISK + probs.TAIL;
    if (sum === 0) {
      return { BASE: 0.6, RISK: 0.3, TAIL: 0.1 };
    }
    return {
      BASE: Math.round((probs.BASE / sum) * 10000) / 10000,
      RISK: Math.round((probs.RISK / sum) * 10000) / 10000,
      TAIL: Math.round((probs.TAIL / sum) * 10000) / 10000,
    };
  }
  
  private selectScenario(probs: Record<ScenarioName, number>): ScenarioName {
    // P12.1 FIX: Probability-weighted scenario selection
    // The scenario with highest probability wins, with minimum thresholds
    // to prevent extreme scenarios from low probabilities
    
    const { BASE, RISK, TAIL } = probs;
    
    // Find max
    const maxProb = Math.max(BASE, RISK, TAIL);
    
    // BASE wins if it's the max (most common case)
    if (BASE === maxProb) {
      return 'BASE';
    }
    
    // TAIL wins if it's max AND above minimum threshold (10%)
    if (TAIL === maxProb && TAIL >= 0.10) {
      return 'TAIL';
    }
    
    // RISK wins if it's max AND above minimum threshold (15%)
    if (RISK === maxProb && RISK >= 0.15) {
      return 'RISK';
    }
    
    // Fallback to BASE
    return 'BASE';
  }
  
  // ─────────────────────────────────────────────────────────────────
  // RAW PROBABILITIES FROM QUANTILES (for orchestrator)
  // ─────────────────────────────────────────────────────────────────
  
  computeRawProbabilities(input: {
    spreadNorm: number;
    downNorm: number;
    guardLevel: GuardLevel;
    crossAssetRegime?: string;
  }): Record<ScenarioName, number> {
    const { spreadNorm, downNorm, guardLevel, crossAssetRegime } = input;
    
    // Risk score from spread
    const riskScore = Math.min(1, Math.max(0, spreadNorm / 2.0));
    
    // Tail score from downside
    const tailScore = Math.min(1, Math.max(0, downNorm / 2.0));
    
    // Guard contribution
    const guardCrisis = THRESHOLDS.guard_levels_tail.includes(guardLevel) ? 1 : 0;
    
    // Cross-asset contribution
    const crossRiskOff = crossAssetRegime && THRESHOLDS.cross_asset_risk_off.includes(crossAssetRegime) ? 1 : 0;
    
    // Build raw probabilities
    let P_tail = 0.15 * tailScore + 0.10 * riskScore + 0.15 * guardCrisis;
    let P_risk = 0.25 * riskScore + 0.10 * crossRiskOff;
    let P_base = Math.max(0, 1 - P_tail - P_risk);
    
    // Clamp
    P_tail = Math.min(0.6, Math.max(0.05, P_tail));
    P_risk = Math.min(0.5, Math.max(0.10, P_risk));
    P_base = Math.max(0.20, P_base);
    
    return this.normalize({ BASE: P_base, RISK: P_risk, TAIL: P_tail });
  }
}

export { BrainScenarioSanityService, THRESHOLDS as SANITY_THRESHOLDS };
