/**
 * ALLOCATION POLICY SERVICE — P5.2
 * 
 * Applies hard allocation rules to cascade sizes.
 * Deterministic, monotonic, asOf-supported.
 */

import type {
  EngineAllocation,
  EngineInputsSnapshot,
  EngineGlobalState,
  GuardLevel,
  LiquidityRegime,
  Confidence,
} from './engine_global.contract.js';

import {
  GUARD_CAPS,
  LIQUIDITY_MULTIPLIERS,
  CONFIDENCE_MULTIPLIERS,
  CONFIDENCE_THRESHOLDS,
  CONFLICT_HAIRCUTS,
  ABSOLUTE_CONSTRAINTS,
  POLICY_VERSION,
} from './allocation_policy.rules.js';

// ═══════════════════════════════════════════════════════════════
// POLICY BREAKDOWN (for evidence)
// ═══════════════════════════════════════════════════════════════

export interface PolicyStep {
  step: string;
  spxBefore: number;
  spxAfter: number;
  btcBefore: number;
  btcAfter: number;
  dxyBefore: number;
  dxyAfter: number;
  reason: string;
}

export interface PolicyBreakdown {
  version: string;
  steps: PolicyStep[];
  finalAllocations: EngineAllocation;
  appliedRules: string[];
  riskHierarchyApplied: boolean;
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function detectConflict(
  inputs: EngineInputsSnapshot,
  globalState: EngineGlobalState
): 'SEVERE' | 'MACRO_BEARISH' | 'LIQUIDITY_DRAIN' | 'NONE' {
  const hasFractalLong = (inputs.dxy?.signalSigned ?? 0) > 0.1 ||
                         (inputs.spxCascade?.sizeMultiplier ?? 0) > 0.7;
  const macroRiskOff = (inputs.macro?.scoreSigned ?? 0) < -0.15;
  const liquidityContraction = globalState.liquidityRegime === 'CONTRACTION';
  
  // Severe: all three conditions
  if (hasFractalLong && macroRiskOff && liquidityContraction) {
    return 'SEVERE';
  }
  
  // Macro bearish alone
  if (macroRiskOff && !liquidityContraction) {
    return 'MACRO_BEARISH';
  }
  
  // Liquidity drain alone
  if (liquidityContraction && !macroRiskOff) {
    return 'LIQUIDITY_DRAIN';
  }
  
  return 'NONE';
}

// ═══════════════════════════════════════════════════════════════
// MAIN POLICY FUNCTION
// ═══════════════════════════════════════════════════════════════

export function applyAllocationPolicy(
  inputs: EngineInputsSnapshot,
  globalState: EngineGlobalState
): PolicyBreakdown {
  const steps: PolicyStep[] = [];
  const appliedRules: string[] = [];
  
  // ─────────────────────────────────────────────────────────────
  // STEP 0: Start with cascade sizes
  // ─────────────────────────────────────────────────────────────
  
  let spx = inputs.spxCascade?.sizeMultiplier ?? 0.5;
  let btc = inputs.btcCascade?.sizeMultiplier ?? 0.5;
  let dxy = Math.abs(inputs.dxy?.signalSigned ?? 0) * 0.6; // DXY from signal strength
  
  const initial = { spx, btc, dxy };
  
  steps.push({
    step: '0_initial',
    spxBefore: spx, spxAfter: spx,
    btcBefore: btc, btcAfter: btc,
    dxyBefore: dxy, dxyAfter: dxy,
    reason: `Initial cascade sizes: SPX=${round3(spx)}, BTC=${round3(btc)}, DXY=${round3(dxy)}`,
  });
  
  // ─────────────────────────────────────────────────────────────
  // STEP 1: Apply Guard Caps (PRIORITY #1)
  // ─────────────────────────────────────────────────────────────
  
  const guardCaps = GUARD_CAPS[globalState.guardLevel];
  const spxPreGuard = spx, btcPreGuard = btc, dxyPreGuard = dxy;
  
  spx = Math.min(spx, guardCaps.spx);
  btc = Math.min(btc, guardCaps.btc);
  dxy = Math.min(dxy, guardCaps.dxy);
  
  if (spx !== spxPreGuard || btc !== btcPreGuard || dxy !== dxyPreGuard) {
    appliedRules.push(`GUARD_CAP_${globalState.guardLevel}`);
    steps.push({
      step: '1_guard_cap',
      spxBefore: spxPreGuard, spxAfter: spx,
      btcBefore: btcPreGuard, btcAfter: btc,
      dxyBefore: dxyPreGuard, dxyAfter: dxy,
      reason: `Guard ${globalState.guardLevel}: caps SPX≤${guardCaps.spx}, BTC≤${guardCaps.btc}, DXY≤${guardCaps.dxy}`,
    });
  }
  
  // If BLOCK, skip remaining adjustments
  if (globalState.guardLevel === 'BLOCK') {
    appliedRules.push('BLOCK_MODE_SKIP_ADJUSTMENTS');
    return buildFinalBreakdown(steps, appliedRules, spx, btc, dxy, false);
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 2: Apply Liquidity Adjustments
  // ─────────────────────────────────────────────────────────────
  
  const liqMults = LIQUIDITY_MULTIPLIERS[globalState.liquidityRegime];
  const spxPreLiq = spx, btcPreLiq = btc, dxyPreLiq = dxy;
  
  spx *= liqMults.spx;
  btc *= liqMults.btc;
  dxy *= liqMults.dxy;
  
  if (globalState.liquidityRegime !== 'NEUTRAL') {
    appliedRules.push(`LIQUIDITY_${globalState.liquidityRegime}`);
    steps.push({
      step: '2_liquidity_adj',
      spxBefore: spxPreLiq, spxAfter: spx,
      btcBefore: btcPreLiq, btcAfter: btc,
      dxyBefore: dxyPreLiq, dxyAfter: dxy,
      reason: `Liquidity ${globalState.liquidityRegime}: SPX×${liqMults.spx}, BTC×${liqMults.btc}, DXY×${liqMults.dxy}`,
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 3: Apply Confidence Scaling
  // ─────────────────────────────────────────────────────────────
  
  const confMult = CONFIDENCE_MULTIPLIERS[globalState.confidence];
  const spxPreConf = spx, btcPreConf = btc;
  
  // Confidence affects risk assets only (not DXY)
  spx *= confMult;
  btc *= confMult;
  
  if (confMult !== 1.0) {
    appliedRules.push(`CONFIDENCE_${globalState.confidence}`);
    steps.push({
      step: '3_confidence_scale',
      spxBefore: spxPreConf, spxAfter: spx,
      btcBefore: btcPreConf, btcAfter: btc,
      dxyBefore: dxy, dxyAfter: dxy,
      reason: `Confidence ${globalState.confidence}: risk assets ×${confMult}`,
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 4: Apply Conflict Resolution (Risk Hierarchy)
  // ─────────────────────────────────────────────────────────────
  
  const conflict = detectConflict(inputs, globalState);
  let riskHierarchyApplied = false;
  
  if (conflict !== 'NONE') {
    const haircuts = conflict === 'SEVERE' ? CONFLICT_HAIRCUTS.SEVERE_CONFLICT :
                     conflict === 'MACRO_BEARISH' ? CONFLICT_HAIRCUTS.MACRO_BEARISH :
                     CONFLICT_HAIRCUTS.LIQUIDITY_DRAIN;
    
    const spxPreConflict = spx, btcPreConflict = btc, dxyPreConflict = dxy;
    
    spx *= haircuts.spx;
    btc *= haircuts.btc;
    dxy *= haircuts.dxy;
    
    riskHierarchyApplied = true;
    appliedRules.push(`CONFLICT_${conflict}`);
    
    steps.push({
      step: '4_conflict_resolution',
      spxBefore: spxPreConflict, spxAfter: spx,
      btcBefore: btcPreConflict, btcAfter: btc,
      dxyBefore: dxyPreConflict, dxyAfter: dxy,
      reason: `Conflict ${conflict}: BTC cut more than SPX (risk hierarchy)`,
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 5: Final Clamp to [0, 1]
  // ─────────────────────────────────────────────────────────────
  
  const spxPreClamp = spx, btcPreClamp = btc, dxyPreClamp = dxy;
  
  spx = clamp(spx, ABSOLUTE_CONSTRAINTS.MIN_SIZE, ABSOLUTE_CONSTRAINTS.MAX_SIZE);
  btc = clamp(btc, ABSOLUTE_CONSTRAINTS.MIN_SIZE, ABSOLUTE_CONSTRAINTS.MAX_SIZE);
  dxy = clamp(dxy, ABSOLUTE_CONSTRAINTS.MIN_SIZE, ABSOLUTE_CONSTRAINTS.MAX_SIZE);
  
  // Re-apply guard caps after all adjustments (ensures monotonicity)
  spx = Math.min(spx, guardCaps.spx);
  btc = Math.min(btc, guardCaps.btc);
  dxy = Math.min(dxy, guardCaps.dxy);
  
  if (spx !== spxPreClamp || btc !== btcPreClamp || dxy !== dxyPreClamp) {
    steps.push({
      step: '5_final_clamp',
      spxBefore: spxPreClamp, spxAfter: spx,
      btcBefore: btcPreClamp, btcAfter: btc,
      dxyBefore: dxyPreClamp, dxyAfter: dxy,
      reason: `Final clamp: [0, ${ABSOLUTE_CONSTRAINTS.MAX_SIZE}] + guard caps`,
    });
  }
  
  return buildFinalBreakdown(steps, appliedRules, spx, btc, dxy, riskHierarchyApplied);
}

function buildFinalBreakdown(
  steps: PolicyStep[],
  appliedRules: string[],
  spx: number,
  btc: number,
  dxy: number,
  riskHierarchyApplied: boolean
): PolicyBreakdown {
  // Calculate cash (residual)
  const totalRisk = (spx + btc + dxy) / 3;
  let cash = Math.max(ABSOLUTE_CONSTRAINTS.MIN_CASH, 1 - totalRisk);
  
  const finalAllocations: EngineAllocation = {
    spxSize: round3(spx),
    btcSize: round3(btc),
    dxySize: round3(dxy),
    cashSize: round3(cash),
  };
  
  return {
    version: POLICY_VERSION,
    steps,
    finalAllocations,
    appliedRules,
    riskHierarchyApplied,
  };
}

// ═══════════════════════════════════════════════════════════════
// POLICY EXPLANATION (for evidence)
// ═══════════════════════════════════════════════════════════════

export function explainPolicy(breakdown: PolicyBreakdown): string {
  const { appliedRules, finalAllocations, riskHierarchyApplied } = breakdown;
  
  const parts: string[] = [];
  
  if (appliedRules.includes('BLOCK_MODE_SKIP_ADJUSTMENTS')) {
    return 'BLOCK mode: all risk positions closed. Capital preservation.';
  }
  
  // Guard
  const guardRule = appliedRules.find(r => r.startsWith('GUARD_CAP_'));
  if (guardRule) {
    const level = guardRule.replace('GUARD_CAP_', '');
    if (level !== 'NONE') {
      parts.push(`Guard ${level} limiting max exposure.`);
    }
  }
  
  // Liquidity
  if (appliedRules.includes('LIQUIDITY_EXPANSION')) {
    parts.push('Fed liquidity expansion boosting BTC.');
  } else if (appliedRules.includes('LIQUIDITY_CONTRACTION')) {
    parts.push('Fed liquidity contraction reducing BTC more than SPX.');
  }
  
  // Confidence
  if (appliedRules.includes('CONFIDENCE_LOW')) {
    parts.push('Low confidence reducing all risk positions.');
  } else if (appliedRules.includes('CONFIDENCE_HIGH')) {
    parts.push('High confidence allowing full sizing.');
  }
  
  // Conflict
  if (riskHierarchyApplied) {
    parts.push('Signal conflict detected: risk hierarchy applied (BTC cut > SPX cut).');
  }
  
  if (parts.length === 0) {
    parts.push('No policy adjustments needed. Cascade sizes passed through.');
  }
  
  parts.push(`Final: SPX ${Math.round(finalAllocations.spxSize * 100)}%, BTC ${Math.round(finalAllocations.btcSize * 100)}%, Cash ${Math.round(finalAllocations.cashSize * 100)}%.`);
  
  return parts.join(' ');
}

// ═══════════════════════════════════════════════════════════════
// MONOTONICITY CHECKS (for testing)
// ═══════════════════════════════════════════════════════════════

export function checkMonotonicity(
  stressLow: PolicyBreakdown,
  stressHigh: PolicyBreakdown
): { passed: boolean; violations: string[] } {
  const violations: string[] = [];
  
  // stress↑ → risk↓
  if (stressHigh.finalAllocations.spxSize > stressLow.finalAllocations.spxSize + 0.001) {
    violations.push(`SPX not monotonic: stress↑ but SPX ${stressLow.finalAllocations.spxSize} → ${stressHigh.finalAllocations.spxSize}`);
  }
  
  if (stressHigh.finalAllocations.btcSize > stressLow.finalAllocations.btcSize + 0.001) {
    violations.push(`BTC not monotonic: stress↑ but BTC ${stressLow.finalAllocations.btcSize} → ${stressHigh.finalAllocations.btcSize}`);
  }
  
  return {
    passed: violations.length === 0,
    violations,
  };
}

export { POLICY_VERSION };
