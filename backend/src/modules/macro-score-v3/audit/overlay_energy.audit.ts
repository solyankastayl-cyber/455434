/**
 * OVERLAY ENERGY AUDIT
 * 
 * L4 Tests for Cross-Asset overlay effectiveness:
 * - U-1: Overlay energy ratio (is overlay actually doing anything?)
 * - U-2: Beta plausibility (is beta stable and meaningful?)
 */

import { AuditTestResult } from '../macro_score.contract.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// ═══════════════════════════════════════════════════════════════
// U-1: OVERLAY ENERGY RATIO
// ═══════════════════════════════════════════════════════════════

export interface OverlayEnergyResult {
  baseEnergy: number;
  overlayEnergy: number;
  energyRatio: number;
  overlayTooWeak: boolean;
  overlayToStrong: boolean;
  passed: boolean;
}

/**
 * Calculate overlay energy ratio
 * 
 * Formula:
 *   R_adj = R_base + g * w * beta * R_ref
 *   E_base = mean(|R_base|)
 *   E_overlay = mean(|g * w * beta * R_ref|)
 *   ratio = E_overlay / E_base
 * 
 * Healthy range: 0.05 - 0.40 (5% - 40% influence)
 */
export function calculateOverlayEnergy(
  baseReturns: number[],
  overlayComponents: number[], // g * w * beta * R_ref for each point
  minRatio: number = 0.05,
  maxRatio: number = 0.40
): OverlayEnergyResult {
  const baseEnergy = mean(baseReturns.map(Math.abs));
  const overlayEnergy = mean(overlayComponents.map(Math.abs));
  
  const energyRatio = baseEnergy > 0 ? overlayEnergy / baseEnergy : 0;
  
  const overlayTooWeak = energyRatio < minRatio;
  const overlayToStrong = energyRatio > maxRatio;
  
  return {
    baseEnergy: round4(baseEnergy),
    overlayEnergy: round4(overlayEnergy),
    energyRatio: round4(energyRatio),
    overlayTooWeak,
    overlayToStrong,
    passed: !overlayTooWeak && !overlayToStrong,
  };
}

export function testOverlayEnergy(
  result: OverlayEnergyResult
): AuditTestResult {
  let status = 'OK';
  if (result.overlayTooWeak) status = 'TOO_WEAK';
  if (result.overlayToStrong) status = 'TOO_STRONG';
  
  return {
    id: 'U-1',
    name: 'Overlay Energy Ratio',
    category: 'overlay',
    passed: result.passed,
    expected: 'Energy ratio in [0.05, 0.40]',
    actual: `ratio=${result.energyRatio} (${status})`,
    metric: result.energyRatio,
    threshold: 0.05,
    details: `baseE=${result.baseEnergy}, overlayE=${result.overlayEnergy}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// U-2: BETA PLAUSIBILITY
// ═══════════════════════════════════════════════════════════════

export interface BetaPlausibilityResult {
  meanBeta: number;
  stdBeta: number;
  betaRange: [number, number];
  unstableBeta: boolean;
  betaExplodes: boolean;
  passed: boolean;
}

/**
 * Check beta stability over rolling windows
 * 
 * Beta should be:
 * - Bounded (not exploding to ±infinity)
 * - Reasonably stable (std not too high)
 */
export function checkBetaPlausibility(
  rollingBetas: number[],
  maxStd: number = 0.5,
  maxAbsBeta: number = 2.0
): BetaPlausibilityResult {
  const meanBeta = mean(rollingBetas);
  const stdBeta = std(rollingBetas);
  const betaRange: [number, number] = [
    Math.min(...rollingBetas),
    Math.max(...rollingBetas),
  ];
  
  const unstableBeta = stdBeta > maxStd;
  const betaExplodes = betaRange[1] > maxAbsBeta || betaRange[0] < -maxAbsBeta;
  
  return {
    meanBeta: round4(meanBeta),
    stdBeta: round4(stdBeta),
    betaRange: [round4(betaRange[0]), round4(betaRange[1])],
    unstableBeta,
    betaExplodes,
    passed: !unstableBeta && !betaExplodes,
  };
}

export function testBetaPlausibility(
  result: BetaPlausibilityResult
): AuditTestResult {
  let issues: string[] = [];
  if (result.unstableBeta) issues.push('unstable');
  if (result.betaExplodes) issues.push('explodes');
  
  return {
    id: 'U-2',
    name: 'Beta Plausibility',
    category: 'overlay',
    passed: result.passed,
    expected: 'std(beta) <= 0.5, |beta| <= 2.0',
    actual: `mean=${result.meanBeta}, std=${result.stdBeta}, range=[${result.betaRange}]`,
    metric: result.stdBeta,
    threshold: 0.5,
    details: issues.length > 0 ? `Issues: ${issues.join(', ')}` : 'Beta stable',
  };
}

// ═══════════════════════════════════════════════════════════════
// FULL OVERLAY AUDIT
// ═══════════════════════════════════════════════════════════════

export interface OverlayAuditResult {
  timestamp: string;
  tests: AuditTestResult[];
  energyAnalysis: OverlayEnergyResult;
  betaAnalysis: BetaPlausibilityResult;
  summary: {
    passed: number;
    failed: number;
  };
}

export function runOverlayAudit(
  baseReturns: number[],
  overlayComponents: number[],
  rollingBetas: number[]
): OverlayAuditResult {
  const energyResult = calculateOverlayEnergy(baseReturns, overlayComponents);
  const betaResult = checkBetaPlausibility(rollingBetas);
  
  const tests = [
    testOverlayEnergy(energyResult),
    testBetaPlausibility(betaResult),
  ];
  
  return {
    timestamp: new Date().toISOString(),
    tests,
    energyAnalysis: energyResult,
    betaAnalysis: betaResult,
    summary: {
      passed: tests.filter(t => t.passed).length,
      failed: tests.filter(t => !t.passed).length,
    },
  };
}

export default {
  calculateOverlayEnergy,
  checkBetaPlausibility,
  runOverlayAudit,
};
