/**
 * ML Modifier Service
 * 
 * Central point for ML confidence modification.
 * 
 * INVARIANTS (LOCKED):
 * - NEVER changes action direction (BUY/SELL/AVOID)
 * - Can only modify confidence (and optionally ranking)
 * - Macro blocks override ML
 * - ACTIVE_SAFE applies only on LIVE
 */

import {
  MlApplyInput,
  MlApplyOutput,
  PromotionPolicy,
  PromotionState,
} from './contracts/mlops.promotion.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function safeNumber(x: unknown, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

// ═══════════════════════════════════════════════════════════════
// ML MODIFIER SERVICE
// ═══════════════════════════════════════════════════════════════

export class MlModifierService {
  
  /**
   * Apply ML calibration to confidence
   * 
   * RULES:
   * - ML works only if mode === ACTIVE_SAFE and dataMode === LIVE
   * - ML NEVER changes BUY/SELL/AVOID
   * - finalConfidence = base * macroModifier * mlModifier
   * - finalConfidence = min(finalConfidence, maxConfidenceByRegime[regimeId])
   */
  apply(input: MlApplyInput, state: PromotionState): MlApplyOutput {
    const reasonCodes: string[] = [];

    const baseConfidence = clamp(safeNumber(input.baseConfidence, 0), 0, 1);
    const macroModifier = clamp(safeNumber(input.macro.macroModifier, 1), 0, 1.5);

    // Defaults: no ML applied
    let mlModifier = 1;
    let applied = false;
    let capApplied: number | undefined;
    let modelId: string | undefined;

    // ─────────────────────────────────────────────────────────────
    // GATE 0: Mode OFF
    // ─────────────────────────────────────────────────────────────
    if (state.mode === 'OFF') {
      reasonCodes.push('ML_MODE_OFF');
      return this.buildOutput(baseConfidence, macroModifier, mlModifier, applied, reasonCodes, capApplied, modelId);
    }

    // ─────────────────────────────────────────────────────────────
    // GATE 1: Only LIVE data
    // ─────────────────────────────────────────────────────────────
    if (state.policy.applyOnlyWhenLive && input.dataMode !== 'LIVE') {
      reasonCodes.push('ML_NOT_LIVE_DATA');
      return this.buildOutput(baseConfidence, macroModifier, mlModifier, applied, reasonCodes, capApplied, modelId);
    }

    // ─────────────────────────────────────────────────────────────
    // GATE 2: Macro blocks override ML
    // ─────────────────────────────────────────────────────────────
    if (state.policy.respectMacroBlocks && input.macro.blocks?.blocked) {
      reasonCodes.push('MACRO_BLOCKS_OVERRIDE_ML');
      return this.buildOutput(baseConfidence, macroModifier, mlModifier, applied, reasonCodes, capApplied, modelId);
    }

    // ─────────────────────────────────────────────────────────────
    // GATE 3: No ML on AVOID (optional)
    // ─────────────────────────────────────────────────────────────
    if (state.policy.noMlOnAvoid && input.baseAction === 'AVOID') {
      reasonCodes.push('ML_DISABLED_ON_AVOID');
      return this.buildOutput(baseConfidence, macroModifier, mlModifier, applied, reasonCodes, capApplied, modelId);
    }

    // ─────────────────────────────────────────────────────────────
    // SHADOW MODE: compute but don't apply
    // ─────────────────────────────────────────────────────────────
    if (state.mode === 'SHADOW') {
      reasonCodes.push('ML_SHADOW_MODE');
      const computed = this.computeMlModifier(input, state.policy);
      // Log for diagnostics but don't apply
      return this.buildOutput(
        baseConfidence, 
        macroModifier, 
        1, // Not applied
        false, 
        [...reasonCodes, `SHADOW_COMPUTED_${computed.mlModifier.toFixed(3)}`], 
        capApplied, 
        computed.modelId
      );
    }

    // ─────────────────────────────────────────────────────────────
    // ACTIVE_SAFE: Apply ML modifier
    // ─────────────────────────────────────────────────────────────
    const computed = this.computeMlModifier(input, state.policy);
    applied = computed.applied;
    mlModifier = computed.mlModifier;
    modelId = computed.modelId;
    reasonCodes.push(...computed.reasonCodes);

    // ─────────────────────────────────────────────────────────────
    // COMBINE: base * macro * ml
    // ─────────────────────────────────────────────────────────────
    let finalConfidence = clamp(baseConfidence * macroModifier * mlModifier, 0, 1);

    // ─────────────────────────────────────────────────────────────
    // REGIME CAP
    // ─────────────────────────────────────────────────────────────
    const cap = safeNumber(state.policy.maxConfidenceByRegime[input.macro.regimeId], 1);
    if (finalConfidence > cap) {
      finalConfidence = cap;
      capApplied = cap;
      reasonCodes.push('REGIME_CAP_APPLIED');
    }

    // ─────────────────────────────────────────────────────────────
    // ONLY LOWER CONFIDENCE (optional policy)
    // ─────────────────────────────────────────────────────────────
    if (state.policy.onlyLowerConfidence) {
      const baseline = clamp(baseConfidence * macroModifier, 0, 1);
      if (finalConfidence > baseline) {
        finalConfidence = baseline;
        reasonCodes.push('ONLY_LOWER_CONFIDENCE');
      }
    }

    return {
      applied,
      mlModifier,
      macroModifier,
      cappedConfidence: clamp(baseConfidence * macroModifier, 0, 1),
      finalConfidence,
      capApplied,
      reasonCodes,
      modelId,
    };
  }

  /**
   * Compute ML modifier from calibration output
   */
  private computeMlModifier(
    input: MlApplyInput,
    policy: PromotionPolicy
  ): { applied: boolean; mlModifier: number; reasonCodes: string[]; modelId?: string } {
    const reasonCodes: string[] = [];

    const bounds = policy.mlModifierBounds || { min: 0.7, max: 1.1 };
    const minB = clamp(safeNumber(bounds.min, 0.7), 0.1, 2);
    const maxB = clamp(safeNumber(bounds.max, 1.1), 0.1, 2);

    const ml = input.ml;
    if (!ml) {
      reasonCodes.push('ML_NO_OUTPUT');
      return { applied: false, mlModifier: 1, reasonCodes };
    }

    const p = clamp(safeNumber(ml.pCalibrated, 0.5), 0, 1);

    // Convert calibrated probability into confidence multiplier:
    // - p=0.5 => ~1.0 (neutral)
    // - p<0.5 => lower confidence
    // - p>0.5 => can increase slightly but bounded
    const centered = (p - 0.5) * 2; // [-1..+1]
    let modifier = 1 + centered * 0.15; // max ±15% before clamp

    modifier = clamp(modifier, minB, maxB);

    // Drift penalties (downside only)
    if (ml.drift?.state === 'DEGRADED') {
      modifier = Math.min(modifier, 0.95);
      reasonCodes.push('ML_DRIFT_DEGRADED');
    }
    if (ml.drift?.state === 'CRITICAL') {
      modifier = Math.min(modifier, 0.85);
      reasonCodes.push('ML_DRIFT_CRITICAL');
    }

    // Final clamp
    modifier = clamp(modifier, minB, maxB);
    reasonCodes.push('ML_APPLIED');

    return { 
      applied: true, 
      mlModifier: modifier, 
      reasonCodes, 
      modelId: ml.modelId 
    };
  }

  /**
   * Build output object
   */
  private buildOutput(
    baseConfidence: number,
    macroModifier: number,
    mlModifier: number,
    applied: boolean,
    reasonCodes: string[],
    capApplied?: number,
    modelId?: string
  ): MlApplyOutput {
    const cappedConfidence = clamp(baseConfidence * macroModifier, 0, 1);
    const finalConfidence = clamp(baseConfidence * macroModifier * mlModifier, 0, 1);
    return {
      applied,
      mlModifier,
      macroModifier,
      cappedConfidence,
      finalConfidence,
      capApplied,
      reasonCodes,
      modelId,
    };
  }
}

// Singleton instance
export const mlModifierService = new MlModifierService();

console.log('[MLOps] Modifier service loaded');
