/**
 * CAPITAL SCALING SERVICE — v2.3
 * 
 * Risk Budget Targeting with Vol Targeting + Tail Risk Penalty
 * 
 * Math:
 *   rawRiskBudget = baseRiskBudget × volScale × tailScale × regimeScale
 *   riskBudgetFinal = clamp(rawRiskBudget, min, max)
 *   scaleFactor = riskBudgetFinal / riskBefore
 *   spx' = spx × scaleFactor
 *   btc' = btc × scaleFactor  
 *   cash' = 1 - (spx' + btc')
 */

import { getCapitalConfig } from './capital_scaling.config.js';
import {
  CapitalScalingMode,
  CapitalScalingInput,
  CapitalScalingResult,
  CapitalScalingPack,
  AllocationState,
  GuardLevel,
  ScenarioType,
  createScalingHash
} from './capital_scaling.contract.js';

// Utility functions
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Compute vol targeting scale
 * Higher realized vol → lower scale (reduce risk)
 * Lower realized vol → higher scale (can take more risk)
 */
function computeVolScale(realizedVol: number): number {
  const config = getCapitalConfig();
  
  if (realizedVol <= 0) {
    return 1.0; // Defensive: no vol data
  }
  
  const rawScale = config.targetVol / realizedVol;
  return clamp(rawScale, config.volClampMin, config.volClampMax);
}

/**
 * Compute tail risk penalty
 * Higher tail risk → lower scale (reduce exposure)
 * 
 * Formula:
 *   tailScore = clamp01((tailRisk - 0.03) / 0.07)
 *   tailScale = 1 - tailPenaltyMax × tailScore
 */
function computeTailScale(tailRisk: number): number {
  const config = getCapitalConfig();
  
  // Tail risk threshold: starts penalizing at 3%, maxes at 10%
  const tailScore = clamp01((tailRisk - 0.03) / 0.07);
  return 1 - config.tailPenaltyMax * tailScore;
}

/**
 * Compute regime adjustment
 * TAIL scenario → reduce risk
 * BASE scenario → neutral
 * RISK scenario → slightly more aggressive (with caution)
 */
function computeRegimeScale(scenario: ScenarioType): number {
  switch (scenario) {
    case 'TAIL':
      return 0.90;
    case 'RISK':
      return 1.02; // Slight increase, not aggressive
    case 'BASE':
    default:
      return 1.0;
  }
}

/**
 * Apply guard level caps
 * BLOCK → max 10% risk
 * CRISIS → max 25% risk
 */
function applyGuardCap(
  riskBudget: number, 
  guardLevel: GuardLevel
): { budget: number; adjusted: boolean } {
  const config = getCapitalConfig();
  
  let cap = Infinity;
  if (guardLevel === 'BLOCK') {
    cap = config.guardCaps.BLOCK;
  } else if (guardLevel === 'CRISIS') {
    cap = config.guardCaps.CRISIS;
  }
  
  if (riskBudget > cap) {
    return { budget: cap, adjusted: true };
  }
  return { budget: riskBudget, adjusted: false };
}

/**
 * SAFETY GATE: No risk increase in TAIL scenario
 */
function applyTailSafetyGate(
  riskBudgetFinal: number,
  riskBefore: number,
  scenario: ScenarioType
): number {
  if (scenario === 'TAIL' && riskBudgetFinal > riskBefore) {
    return riskBefore; // Never increase risk in TAIL
  }
  return riskBudgetFinal;
}

/**
 * SAFETY GATE: Delta cap in normal conditions
 * Note: Guard caps have priority over delta cap
 */
function applyDeltaCap(
  riskBudgetFinal: number,
  riskBefore: number,
  scenario: ScenarioType,
  guardLevel: GuardLevel
): number {
  const config = getCapitalConfig();
  
  // Guard caps have absolute priority - no delta cap applies
  if (guardLevel === 'BLOCK' || guardLevel === 'CRISIS') {
    return riskBudgetFinal; // Already capped by guard, don't apply delta limit
  }
  
  const maxDelta = scenario === 'TAIL' || scenario === 'RISK' 
    ? config.maxDeltaCrisis 
    : config.maxDeltaNormal;
  
  const delta = riskBudgetFinal - riskBefore;
  
  if (Math.abs(delta) > maxDelta) {
    return riskBefore + Math.sign(delta) * maxDelta;
  }
  return riskBudgetFinal;
}

/**
 * Main Capital Scaling Function
 */
export function applyCapitalScaling(
  input: CapitalScalingInput,
  mode: CapitalScalingMode = 'on'
): CapitalScalingResult {
  const config = getCapitalConfig();
  const warnings: string[] = [];
  
  // Step 1: Calculate base values
  const riskBefore = input.allocations.spx + input.allocations.btc;
  
  // Step 2: Compute drivers
  const volScale = computeVolScale(input.realizedVol);
  const tailScale = computeTailScale(input.tailRisk);
  const regimeScale = computeRegimeScale(input.scenario);
  
  // Step 3: Calculate raw risk budget
  let rawRiskBudget = config.baseRiskBudget * volScale * tailScale * regimeScale;
  
  // Step 4: Apply guard caps
  const guardResult = applyGuardCap(rawRiskBudget, input.guardLevel);
  rawRiskBudget = guardResult.budget;
  
  // Step 5: Apply final clamp
  let riskBudgetFinal = clamp(rawRiskBudget, config.minRiskBudget, config.maxRiskBudget);
  const clampApplied = riskBudgetFinal !== rawRiskBudget;
  
  // Step 6: Safety gates
  const beforeTailGate = riskBudgetFinal;
  riskBudgetFinal = applyTailSafetyGate(riskBudgetFinal, riskBefore, input.scenario);
  if (riskBudgetFinal !== beforeTailGate) {
    warnings.push('TAIL_SAFETY_GATE: Risk increase blocked in TAIL scenario');
  }
  
  const beforeDeltaCap = riskBudgetFinal;
  riskBudgetFinal = applyDeltaCap(riskBudgetFinal, riskBefore, input.scenario, input.guardLevel);
  if (riskBudgetFinal !== beforeDeltaCap) {
    warnings.push(`DELTA_CAP: Risk change limited to ${config.maxDeltaNormal * 100}%`);
  }
  
  // Step 7: Calculate scale factor
  const scaleFactor = riskBefore === 0 ? 0 : riskBudgetFinal / riskBefore;
  
  // Step 8: Apply scaling to allocations
  let finalAllocations: AllocationState;
  
  if (mode === 'shadow') {
    // Shadow mode: return original allocations
    finalAllocations = { ...input.allocations };
  } else {
    // On mode: apply scaling
    const spx = round4(input.allocations.spx * scaleFactor);
    const btc = round4(input.allocations.btc * scaleFactor);
    const cash = round4(1 - (spx + btc));
    
    finalAllocations = { spx, btc, cash };
    
    // Validate sum
    const sum = spx + btc + cash;
    if (Math.abs(sum - 1.0) > 0.001) {
      warnings.push(`SUM_DRIFT: Allocations sum to ${sum.toFixed(4)}, normalizing`);
      const adj = 1 / sum;
      finalAllocations.spx = round4(spx * adj);
      finalAllocations.btc = round4(btc * adj);
      finalAllocations.cash = round4(1 - finalAllocations.spx - finalAllocations.btc);
    }
  }
  
  // Step 9: Build pack
  const pack: CapitalScalingPack = {
    mode,
    baseRiskBudget: config.baseRiskBudget,
    riskBudgetBefore: round4(riskBefore),
    riskBudgetAfter: round4(riskBudgetFinal),
    scaleFactor: round4(scaleFactor),
    drivers: {
      volScale: round4(volScale),
      tailScale: round4(tailScale),
      regimeScale: round4(regimeScale),
      guardAdjusted: guardResult.adjusted,
      clamp: clampApplied
    },
    before: {
      spx: round4(input.allocations.spx),
      btc: round4(input.allocations.btc),
      cash: round4(input.allocations.cash)
    },
    after: finalAllocations,
    hash: createScalingHash(input),
    timestamp: new Date().toISOString(),
    warnings
  };
  
  return {
    allocations: finalAllocations,
    pack
  };
}

/**
 * Convenience function for shadow mode preview
 */
export function previewCapitalScaling(input: CapitalScalingInput): CapitalScalingResult {
  return applyCapitalScaling(input, 'shadow');
}

/**
 * Get current vol estimate (placeholder - should use actual price service)
 * In production, this would calculate 30d realized vol from price data
 */
export async function getRealized30dVol(asset: 'SPX' | 'BTC' | 'PORTFOLIO'): Promise<number> {
  // Default estimates based on typical market conditions
  const defaults: Record<string, number> = {
    'SPX': 0.15,      // ~15% annualized vol
    'BTC': 0.55,      // ~55% annualized vol
    'PORTFOLIO': 0.20 // Blended estimate
  };
  
  return defaults[asset] || 0.15;
}

// Singleton service
let _instance: CapitalScalingService | null = null;

export class CapitalScalingService {
  static getInstance(): CapitalScalingService {
    if (!_instance) {
      _instance = new CapitalScalingService();
    }
    return _instance;
  }
  
  apply(input: CapitalScalingInput, mode: CapitalScalingMode = 'on'): CapitalScalingResult {
    return applyCapitalScaling(input, mode);
  }
  
  preview(input: CapitalScalingInput): CapitalScalingResult {
    return previewCapitalScaling(input);
  }
  
  async getRealized30dVol(asset: 'SPX' | 'BTC' | 'PORTFOLIO' = 'PORTFOLIO'): Promise<number> {
    return getRealized30dVol(asset);
  }
}

export function getCapitalScalingService(): CapitalScalingService {
  return CapitalScalingService.getInstance();
}
