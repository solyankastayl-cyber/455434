/**
 * CASCADE ARCHITECTURE AUDIT
 * 
 * Verify the cascade is unidirectional:
 *   Macro → DXY → SPX → BTC
 * 
 * Tests:
 * - F8-F10: Fractal independence
 * - M1-M4: Macro → DXY cascade
 * - S1-S5: DXY → SPX cascade
 * - B1-B5: SPX → BTC cascade
 * - G1-G3: No cycles
 */

import { AuditTestResult } from '../macro-score-v3/macro_score.contract.js';

// ═══════════════════════════════════════════════════════════════
// CONTRACTS
// ═══════════════════════════════════════════════════════════════

export interface CascadeTestInputs {
  // Macro
  macroScore: number;
  macroEnabled: boolean;
  
  // DXY
  dxyHybrid: number;
  dxyAdj: number;
  
  // SPX  
  spxHybrid: number;
  spxAdj: number;
  spxBeta: number;
  
  // BTC
  btcHybrid: number;
  btcAdj: number;
  btcGamma: number;
}

export interface CascadeAuditResult {
  timestamp: string;
  tests: AuditTestResult[];
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
  cascadeIntegrity: boolean;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function round6(x: number): number {
  return Math.round(x * 1000000) / 1000000;
}

const EPSILON = 1e-10;

// ═══════════════════════════════════════════════════════════════
// MACRO → DXY TESTS (M1-M4)
// ═══════════════════════════════════════════════════════════════

/**
 * M2: If MacroScore = 0 → DXY_adj = DXY_hybrid
 */
export function testMacroDxyNeutrality(
  dxyHybrid: number,
  dxyAdj: number,
  macroScore: number
): AuditTestResult {
  // Only test when macro is zero
  if (Math.abs(macroScore) > EPSILON) {
    return {
      id: 'M2',
      name: 'Macro→DXY Neutrality (MacroScore=0)',
      category: 'invariant',
      passed: true,
      expected: 'N/A (MacroScore != 0)',
      actual: 'Skipped',
    };
  }
  
  const diff = Math.abs(dxyAdj - dxyHybrid);
  const passed = diff <= EPSILON;
  
  return {
    id: 'M2',
    name: 'Macro→DXY Neutrality (MacroScore=0)',
    category: 'invariant',
    passed,
    expected: 'DXY_adj == DXY_hybrid when MacroScore=0',
    actual: `diff = ${round6(diff)}`,
    metric: round6(diff),
    threshold: EPSILON,
  };
}

/**
 * M3: Overlay bounded (Macro can't change DXY more than X%)
 */
export function testMacroDxyBounded(
  dxyHybrid: number,
  dxyAdj: number,
  maxImpact: number = 0.10
): AuditTestResult {
  const impact = Math.abs(dxyAdj - dxyHybrid);
  const maxAllowed = maxImpact * Math.abs(dxyHybrid);
  const threshold = Math.max(maxAllowed, 0.01);
  
  const passed = impact <= threshold;
  
  return {
    id: 'M3',
    name: 'Macro→DXY Bounded',
    category: 'invariant',
    passed,
    expected: `|impact| <= ${round6(threshold)}`,
    actual: `impact = ${round6(impact)}`,
    metric: round6(impact),
    threshold: round6(threshold),
  };
}

// ═══════════════════════════════════════════════════════════════
// DXY → SPX TESTS (S1-S5)
// ═══════════════════════════════════════════════════════════════

/**
 * S2: If DXY_adj = 0 → SPX_adj = SPX_hybrid
 */
export function testDxySpxNeutrality(
  spxHybrid: number,
  spxAdj: number,
  dxyAdj: number
): AuditTestResult {
  if (Math.abs(dxyAdj) > EPSILON) {
    return {
      id: 'S2',
      name: 'DXY→SPX Neutrality (DXY_adj=0)',
      category: 'invariant',
      passed: true,
      expected: 'N/A (DXY_adj != 0)',
      actual: 'Skipped',
    };
  }
  
  const diff = Math.abs(spxAdj - spxHybrid);
  const passed = diff <= EPSILON;
  
  return {
    id: 'S2',
    name: 'DXY→SPX Neutrality (DXY_adj=0)',
    category: 'invariant',
    passed,
    expected: 'SPX_adj == SPX_hybrid when DXY_adj=0',
    actual: `diff = ${round6(diff)}`,
    metric: round6(diff),
    threshold: EPSILON,
  };
}

/**
 * S3: If beta = 0 → SPX_adj = SPX_hybrid
 */
export function testSpxBetaNeutrality(
  spxHybrid: number,
  spxAdj: number,
  beta: number
): AuditTestResult {
  if (Math.abs(beta) > EPSILON) {
    return {
      id: 'S3',
      name: 'SPX Beta Neutrality (β=0)',
      category: 'invariant',
      passed: true,
      expected: 'N/A (β != 0)',
      actual: 'Skipped',
    };
  }
  
  const diff = Math.abs(spxAdj - spxHybrid);
  const passed = diff <= EPSILON;
  
  return {
    id: 'S3',
    name: 'SPX Beta Neutrality (β=0)',
    category: 'invariant',
    passed,
    expected: 'SPX_adj == SPX_hybrid when β=0',
    actual: `diff = ${round6(diff)}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// SPX → BTC TESTS (B1-B5)
// ═══════════════════════════════════════════════════════════════

/**
 * B2: If CrossAsset = 0 → BTC_adj = BTC_hybrid
 */
export function testBtcCrossAssetNeutrality(
  btcHybrid: number,
  btcAdj: number,
  crossAsset: number
): AuditTestResult {
  if (Math.abs(crossAsset) > EPSILON) {
    return {
      id: 'B2',
      name: 'BTC CrossAsset Neutrality',
      category: 'invariant',
      passed: true,
      expected: 'N/A (CrossAsset != 0)',
      actual: 'Skipped',
    };
  }
  
  const diff = Math.abs(btcAdj - btcHybrid);
  const passed = diff <= EPSILON;
  
  return {
    id: 'B2',
    name: 'BTC CrossAsset Neutrality',
    category: 'invariant',
    passed,
    expected: 'BTC_adj == BTC_hybrid when CrossAsset=0',
    actual: `diff = ${round6(diff)}`,
  };
}

/**
 * B4: BTC Overlay Bounded
 */
export function testBtcOverlayBounded(
  btcHybrid: number,
  btcAdj: number,
  maxImpact: number = 0.15
): AuditTestResult {
  const impact = Math.abs(btcAdj - btcHybrid);
  const maxAllowed = maxImpact * Math.abs(btcHybrid);
  const threshold = Math.max(maxAllowed, 0.01);
  
  const passed = impact <= threshold;
  
  return {
    id: 'B4',
    name: 'BTC Overlay Bounded',
    category: 'invariant',
    passed,
    expected: `|impact| <= ${round6(threshold)}`,
    actual: `impact = ${round6(impact)}`,
    metric: round6(impact),
    threshold: round6(threshold),
  };
}

// ═══════════════════════════════════════════════════════════════
// FULL CASCADE AUDIT
// ═══════════════════════════════════════════════════════════════

export function runCascadeAudit(
  inputs: CascadeTestInputs
): CascadeAuditResult {
  const tests: AuditTestResult[] = [];
  
  // Macro → DXY
  tests.push(testMacroDxyNeutrality(
    inputs.dxyHybrid,
    inputs.dxyAdj,
    inputs.macroEnabled ? inputs.macroScore : 0
  ));
  tests.push(testMacroDxyBounded(inputs.dxyHybrid, inputs.dxyAdj));
  
  // DXY → SPX
  tests.push(testDxySpxNeutrality(
    inputs.spxHybrid,
    inputs.spxAdj,
    inputs.dxyAdj
  ));
  tests.push(testSpxBetaNeutrality(
    inputs.spxHybrid,
    inputs.spxAdj,
    inputs.spxBeta
  ));
  
  // SPX → BTC
  tests.push(testBtcCrossAssetNeutrality(
    inputs.btcHybrid,
    inputs.btcAdj,
    inputs.spxAdj // CrossAsset derived from SPX
  ));
  tests.push(testBtcOverlayBounded(inputs.btcHybrid, inputs.btcAdj));
  
  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;
  
  return {
    timestamp: new Date().toISOString(),
    tests,
    summary: {
      passed,
      failed,
      total: tests.length,
    },
    cascadeIntegrity: failed === 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC RUNS
// ═══════════════════════════════════════════════════════════════

/**
 * Prognon A: Macro disabled
 * Expected: DXY_adj = DXY_hybrid, SPX depends only on DXY_hybrid
 */
export function runDiagnosticMacroOff(
  dxyHybrid: number,
  dxyAdj: number,
  spxHybrid: number,
  spxAdj: number,
  btcHybrid: number,
  btcAdj: number
): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  
  if (Math.abs(dxyAdj - dxyHybrid) > EPSILON) {
    issues.push('DXY_adj != DXY_hybrid when Macro off');
  }
  
  return {
    passed: issues.length === 0,
    issues,
  };
}

/**
 * Prognon B: DXY = 0
 * Expected: SPX_adj = SPX_hybrid, BTC_adj = BTC_hybrid
 */
export function runDiagnosticDxyZero(
  spxHybrid: number,
  spxAdj: number,
  btcHybrid: number,
  btcAdj: number
): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  
  if (Math.abs(spxAdj - spxHybrid) > EPSILON) {
    issues.push('SPX_adj != SPX_hybrid when DXY=0');
  }
  if (Math.abs(btcAdj - btcHybrid) > EPSILON) {
    issues.push('BTC_adj != BTC_hybrid when DXY=0');
  }
  
  return {
    passed: issues.length === 0,
    issues,
  };
}

export default {
  runCascadeAudit,
  runDiagnosticMacroOff,
  runDiagnosticDxyZero,
};
