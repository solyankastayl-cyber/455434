/**
 * P10.3 — Engine Global Brain Bridge with MetaRisk
 * 
 * Integrates Brain directives + MetaRisk into Engine allocations.
 * Implements shrink logic for override intensity control.
 * 
 * Pipeline:
 *   1. Base allocations (from policy)
 *   2. Apply Brain directives (caps/haircuts/scales)
 *   3. Enforce overrideCap (shrink if needed)
 *   4. Apply globalScale (metaRisk)
 *   5. Rebalance cash
 *   6. Final clamp + normalization
 */

import { BrainOutputPack, BrainDirectives } from '../../brain/contracts/brain_output.contract.js';
import { MetaRiskPack, Posture } from '../../brain/contracts/meta_risk.contract.js';
import { EngineAllocation } from './engine_global.contract.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface BrainBridgeInput {
  baseAllocations: EngineAllocation;  // From policy service
  brainOutput?: BrainOutputPack;       // From Brain orchestrator
  metaRisk?: MetaRiskPack;             // From MetaRisk service
  minCash?: number;                     // Minimum cash (default 0.05)
}

export interface BrainBridgeOutput {
  allocations: EngineAllocation;
  metaRisk: {
    posture: Posture;
    globalScale: number;
    maxOverrideCap: number;
    intensityBefore: number;
    intensityAfter: number;
    shrinkApplied: boolean;
    shrinkFactor?: number;
    tailRiskClamp: boolean;
  };
  steps: BridgeStep[];
  warnings: string[];
}

export interface BridgeStep {
  step: string;
  spx: number;
  btc: number;
  cash: number;
  description: string;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ═══════════════════════════════════════════════════════════════
// BRAIN BRIDGE WITH METARISK
// ═══════════════════════════════════════════════════════════════

export function applyBrainBridge(input: BrainBridgeInput): BrainBridgeOutput {
  const { baseAllocations, brainOutput, metaRisk, minCash = 0.05 } = input;
  const steps: BridgeStep[] = [];
  const warnings: string[] = [];
  
  // Extract and NORMALIZE base values (Engine may return unnormalized allocations)
  let rawSum = baseAllocations.spxSize + baseAllocations.btcSize + baseAllocations.cashSize;
  if (rawSum <= 0) rawSum = 1; // Safety
  
  let spx = baseAllocations.spxSize / rawSum;
  let btc = baseAllocations.btcSize / rawSum;
  let cash = baseAllocations.cashSize / rawSum;
  
  // Ensure normalized sum
  const normSum = spx + btc + cash;
  if (Math.abs(normSum - 1) > 0.001) {
    const fix = 1 / normSum;
    spx *= fix;
    btc *= fix;
    cash *= fix;
  }
  
  const baseSpx = spx;
  const baseBtc = btc;
  const baseCash = cash;
  
  steps.push({
    step: '0_base',
    spx: round3(spx),
    btc: round3(btc),
    cash: round3(cash),
    description: 'Base allocations from policy',
  });
  
  // ─────────────────────────────────────────────────────────────
  // STEP 1: Apply Brain Directives (caps/haircuts/scales)
  // ─────────────────────────────────────────────────────────────
  
  if (brainOutput?.directives) {
    const d = brainOutput.directives;
    
    // Apply caps
    if (d.caps?.spx?.maxSize !== undefined) {
      spx = Math.min(spx, d.caps.spx.maxSize);
    }
    if (d.caps?.btc?.maxSize !== undefined) {
      btc = Math.min(btc, d.caps.btc.maxSize);
    }
    
    // Apply haircuts
    if (d.haircuts?.spx !== undefined) {
      spx *= d.haircuts.spx;
    }
    if (d.haircuts?.btc !== undefined) {
      btc *= d.haircuts.btc;
    }
    
    // Apply scales
    if (d.scales?.spx?.sizeScale !== undefined) {
      spx *= d.scales.spx.sizeScale;
    }
    if (d.scales?.btc?.sizeScale !== undefined) {
      btc *= d.scales.btc.sizeScale;
    }
    
    // NO_TRADE flags
    if (d.noTrade?.spx) spx = 0;
    if (d.noTrade?.btc) btc = 0;
    
    steps.push({
      step: '1_brain_directives',
      spx: round3(spx),
      btc: round3(btc),
      cash: round3(cash),
      description: `Brain directives applied (scenario: ${brainOutput.scenario?.name || 'N/A'})`,
    });
    
    // Collect warnings from Brain
    if (d.warnings) {
      warnings.push(...d.warnings);
    }
  }
  
  // Allocations after Brain directives (before shrink)
  const afterBrainSpx = spx;
  const afterBrainBtc = btc;
  
  // ─────────────────────────────────────────────────────────────
  // STEP 2: Calculate Override Intensity
  // ─────────────────────────────────────────────────────────────
  
  const intensityBefore = Math.max(
    Math.abs(afterBrainSpx - baseSpx),
    Math.abs(afterBrainBtc - baseBtc),
    Math.abs(cash - baseCash)
  );
  
  // ─────────────────────────────────────────────────────────────
  // STEP 3: Enforce Override Cap (Shrink Logic)
  // ─────────────────────────────────────────────────────────────
  
  const posture: Posture = metaRisk?.posture || 'NEUTRAL';
  const maxOverrideCap = metaRisk?.maxOverrideCap || 0.35;
  const scenario = brainOutput?.scenario?.name || 'BASE';
  
  let shrinkApplied = false;
  let shrinkFactor: number | undefined;
  let intensityAfter = intensityBefore;
  
  if (intensityBefore > maxOverrideCap) {
    // Proportional shrink
    shrinkFactor = maxOverrideCap / intensityBefore;
    
    // Apply shrink to deltas (preserves direction/sign)
    const deltaSpx = afterBrainSpx - baseSpx;
    const deltaBtc = afterBrainBtc - baseBtc;
    const deltaCash = cash - baseCash;
    
    spx = baseSpx + deltaSpx * shrinkFactor;
    btc = baseBtc + deltaBtc * shrinkFactor;
    cash = baseCash + deltaCash * shrinkFactor;
    
    intensityAfter = maxOverrideCap;
    shrinkApplied = true;
    
    steps.push({
      step: '2_shrink',
      spx: round3(spx),
      btc: round3(btc),
      cash: round3(cash),
      description: `Shrink applied: intensity ${round3(intensityBefore)} → ${round3(intensityAfter)} (factor: ${round3(shrinkFactor)})`,
    });
    
    warnings.push(`OVERRIDE_SHRINK: intensity ${round3(intensityBefore)} exceeded cap ${maxOverrideCap}, shrunk by ${round3(shrinkFactor)}`);
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 4: TAIL Risk Clamp (no risk increase allowed)
  // ─────────────────────────────────────────────────────────────
  
  let tailRiskClamp = false;
  
  if (scenario === 'TAIL') {
    const spxBeforeTail = spx;
    const btcBeforeTail = btc;
    
    // TAIL: only risk reduction allowed
    spx = Math.min(spx, baseSpx);
    btc = Math.min(btc, baseBtc);
    
    if (spx !== spxBeforeTail || btc !== btcBeforeTail) {
      tailRiskClamp = true;
      
      steps.push({
        step: '3_tail_clamp',
        spx: round3(spx),
        btc: round3(btc),
        cash: round3(cash),
        description: 'TAIL scenario: risk increase blocked',
      });
      
      warnings.push('TAIL_RISK_CLAMP: prevented risk increase in TAIL scenario');
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 5: Apply Global Scale (MetaRisk)
  // ─────────────────────────────────────────────────────────────
  
  const globalScale = metaRisk?.metaRiskScale || 1.0;
  
  if (globalScale !== 1.0) {
    const spxBeforeScale = spx;
    const btcBeforeScale = btc;
    
    spx *= globalScale;
    btc *= globalScale;
    
    steps.push({
      step: '4_global_scale',
      spx: round3(spx),
      btc: round3(btc),
      cash: round3(cash),
      description: `GlobalScale ${round3(globalScale)} (${posture}) applied`,
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 6: Rebalance Cash
  // ─────────────────────────────────────────────────────────────
  
  const riskSum = spx + btc;
  
  if (riskSum > 1) {
    // Proportionally reduce risk to fit
    const overflowFactor = 1 / riskSum;
    spx *= overflowFactor;
    btc *= overflowFactor;
    cash = 0;
    
    steps.push({
      step: '5_overflow_fix',
      spx: round3(spx),
      btc: round3(btc),
      cash: round3(cash),
      description: `Risk overflow corrected (factor: ${round3(overflowFactor)})`,
    });
    
    warnings.push('RISK_OVERFLOW: total risk exceeded 1, proportionally reduced');
  } else {
    // Cash is residual
    cash = Math.max(minCash, 1 - riskSum);
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 7: Final Safety Clamp
  // ─────────────────────────────────────────────────────────────
  
  spx = clamp(spx, 0, 1);
  btc = clamp(btc, 0, 1);
  cash = clamp(cash, minCash, 1);
  
  // Ensure sum = 1 (normalize if needed)
  const total = spx + btc + cash;
  if (Math.abs(total - 1) > 0.001) {
    const normFactor = 1 / total;
    spx *= normFactor;
    btc *= normFactor;
    cash *= normFactor;
    
    // Re-enforce minCash after normalization
    if (cash < minCash) {
      const deficit = minCash - cash;
      cash = minCash;
      // Take from larger position
      if (spx > btc) {
        spx -= deficit;
      } else {
        btc -= deficit;
      }
    }
  }
  
  // Final round
  spx = round3(spx);
  btc = round3(btc);
  cash = round3(cash);
  
  steps.push({
    step: '6_final',
    spx,
    btc,
    cash,
    description: `Final allocations (sum=${round3(spx + btc + cash)})`,
  });
  
  return {
    allocations: {
      spxSize: spx,
      btcSize: btc,
      dxySize: baseAllocations.dxySize, // DXY unchanged by Brain
      cashSize: cash,
    },
    metaRisk: {
      posture,
      globalScale,
      maxOverrideCap,
      intensityBefore: round3(intensityBefore),
      intensityAfter: round3(intensityAfter),
      shrinkApplied,
      shrinkFactor: shrinkFactor ? round3(shrinkFactor) : undefined,
      tailRiskClamp,
    },
    steps,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export function validateBridgeOutput(output: BrainBridgeOutput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const { allocations, metaRisk } = output;
  
  // Check for NaN
  if (isNaN(allocations.spxSize)) errors.push('NaN in spxSize');
  if (isNaN(allocations.btcSize)) errors.push('NaN in btcSize');
  if (isNaN(allocations.cashSize)) errors.push('NaN in cashSize');
  
  // Check bounds
  if (allocations.spxSize < 0) errors.push(`Negative spxSize: ${allocations.spxSize}`);
  if (allocations.btcSize < 0) errors.push(`Negative btcSize: ${allocations.btcSize}`);
  if (allocations.cashSize < 0) errors.push(`Negative cashSize: ${allocations.cashSize}`);
  
  // Check sum ≈ 1
  const sum = allocations.spxSize + allocations.btcSize + allocations.cashSize;
  if (Math.abs(sum - 1) > 0.01) {
    errors.push(`Allocations sum to ${sum}, expected ~1`);
  }
  
  // Check override intensity respects cap
  if (metaRisk.intensityAfter > metaRisk.maxOverrideCap + 0.001) {
    errors.push(`intensityAfter ${metaRisk.intensityAfter} exceeds cap ${metaRisk.maxOverrideCap}`);
  }
  
  return { valid: errors.length === 0, errors };
}
