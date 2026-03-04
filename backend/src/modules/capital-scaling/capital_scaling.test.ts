/**
 * CAPITAL SCALING TESTS — v2.3
 * 
 * 10 Required Test Cases:
 * 1. Determinism (same asOf → same result)
 * 2. Sum == 1
 * 3. No NaN
 * 4. Guard BLOCK → risk ≤ 0.1
 * 5. Guard CRISIS → risk ≤ 0.25
 * 6. TAIL never increases risk
 * 7. scaleFactor bounded
 * 8. risk delta ≤ 0.10 in BASE
 * 9. negative vol handled
 * 10. shadow mode does not change allocations
 */

import { applyCapitalScaling, previewCapitalScaling } from './capital_scaling.service.js';
import { CapitalScalingInput, AllocationState } from './capital_scaling.contract.js';

// Test utilities
function assertClose(actual: number, expected: number, tolerance: number = 0.001): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function assertSum1(alloc: AllocationState): boolean {
  const sum = alloc.spx + alloc.btc + alloc.cash;
  return assertClose(sum, 1.0);
}

function hasNaN(alloc: AllocationState): boolean {
  return isNaN(alloc.spx) || isNaN(alloc.btc) || isNaN(alloc.cash);
}

// Test cases
export const capitalScalingTests = {
  
  // 1. Determinism: same inputs → same outputs
  testDeterminism(): { passed: boolean; message: string } {
    const input: CapitalScalingInput = {
      allocations: { spx: 0.35, btc: 0.25, cash: 0.40 },
      scenario: 'BASE',
      guardLevel: 'NORMAL',
      realizedVol: 0.15,
      tailRisk: 0.05,
      asOf: '2024-01-15'
    };
    
    const result1 = applyCapitalScaling(input, 'on');
    const result2 = applyCapitalScaling(input, 'on');
    
    const hashMatch = result1.pack.hash === result2.pack.hash;
    const allocMatch = 
      result1.allocations.spx === result2.allocations.spx &&
      result1.allocations.btc === result2.allocations.btc &&
      result1.allocations.cash === result2.allocations.cash;
    
    return {
      passed: hashMatch && allocMatch,
      message: hashMatch && allocMatch 
        ? 'Determinism: PASS' 
        : `Determinism: FAIL (hash: ${hashMatch}, alloc: ${allocMatch})`
    };
  },
  
  // 2. Sum == 1
  testSumEqualsOne(): { passed: boolean; message: string } {
    const scenarios = [
      { spx: 0.35, btc: 0.25, cash: 0.40 },
      { spx: 0.60, btc: 0.30, cash: 0.10 },
      { spx: 0.10, btc: 0.10, cash: 0.80 },
    ];
    
    for (const alloc of scenarios) {
      const input: CapitalScalingInput = {
        allocations: alloc,
        scenario: 'BASE',
        guardLevel: 'NORMAL',
        realizedVol: 0.15,
        tailRisk: 0.05,
        asOf: '2024-01-15'
      };
      
      const result = applyCapitalScaling(input, 'on');
      if (!assertSum1(result.allocations)) {
        const sum = result.allocations.spx + result.allocations.btc + result.allocations.cash;
        return { passed: false, message: `Sum == 1: FAIL (sum = ${sum.toFixed(6)})` };
      }
    }
    
    return { passed: true, message: 'Sum == 1: PASS' };
  },
  
  // 3. No NaN
  testNoNaN(): { passed: boolean; message: string } {
    const inputs: CapitalScalingInput[] = [
      {
        allocations: { spx: 0.35, btc: 0.25, cash: 0.40 },
        scenario: 'BASE', guardLevel: 'NORMAL', realizedVol: 0.15, tailRisk: 0.05, asOf: '2024-01-15'
      },
      {
        allocations: { spx: 0, btc: 0, cash: 1.0 },
        scenario: 'TAIL', guardLevel: 'BLOCK', realizedVol: 0.01, tailRisk: 0.15, asOf: '2024-01-15'
      },
      {
        allocations: { spx: 0.50, btc: 0.50, cash: 0 },
        scenario: 'RISK', guardLevel: 'CRISIS', realizedVol: 0.30, tailRisk: 0.08, asOf: '2024-01-15'
      },
    ];
    
    for (const input of inputs) {
      const result = applyCapitalScaling(input, 'on');
      if (hasNaN(result.allocations)) {
        return { passed: false, message: 'No NaN: FAIL (found NaN in allocations)' };
      }
    }
    
    return { passed: true, message: 'No NaN: PASS' };
  },
  
  // 4. Guard BLOCK → risk ≤ 0.1
  testGuardBLOCK(): { passed: boolean; message: string } {
    const input: CapitalScalingInput = {
      allocations: { spx: 0.50, btc: 0.40, cash: 0.10 },
      scenario: 'BASE',
      guardLevel: 'BLOCK',
      realizedVol: 0.10,
      tailRisk: 0.02,
      asOf: '2024-01-15'
    };
    
    const result = applyCapitalScaling(input, 'on');
    const riskAfter = result.allocations.spx + result.allocations.btc;
    
    return {
      passed: riskAfter <= 0.101,
      message: riskAfter <= 0.101 
        ? `Guard BLOCK: PASS (risk = ${riskAfter.toFixed(4)} ≤ 0.10)` 
        : `Guard BLOCK: FAIL (risk = ${riskAfter.toFixed(4)} > 0.10)`
    };
  },
  
  // 5. Guard CRISIS → risk ≤ 0.25
  testGuardCRISIS(): { passed: boolean; message: string } {
    const input: CapitalScalingInput = {
      allocations: { spx: 0.50, btc: 0.40, cash: 0.10 },
      scenario: 'BASE',
      guardLevel: 'CRISIS',
      realizedVol: 0.10,
      tailRisk: 0.02,
      asOf: '2024-01-15'
    };
    
    const result = applyCapitalScaling(input, 'on');
    const riskAfter = result.allocations.spx + result.allocations.btc;
    
    return {
      passed: riskAfter <= 0.251,
      message: riskAfter <= 0.251 
        ? `Guard CRISIS: PASS (risk = ${riskAfter.toFixed(4)} ≤ 0.25)` 
        : `Guard CRISIS: FAIL (risk = ${riskAfter.toFixed(4)} > 0.25)`
    };
  },
  
  // 6. TAIL never increases risk
  testTAILNoRiskIncrease(): { passed: boolean; message: string } {
    const input: CapitalScalingInput = {
      allocations: { spx: 0.20, btc: 0.15, cash: 0.65 },
      scenario: 'TAIL',
      guardLevel: 'NORMAL',
      realizedVol: 0.08,  // Low vol would normally suggest increasing risk
      tailRisk: 0.02,
      asOf: '2024-01-15'
    };
    
    const riskBefore = input.allocations.spx + input.allocations.btc;
    const result = applyCapitalScaling(input, 'on');
    const riskAfter = result.allocations.spx + result.allocations.btc;
    
    return {
      passed: riskAfter <= riskBefore + 0.001,
      message: riskAfter <= riskBefore + 0.001
        ? `TAIL no risk increase: PASS (before=${riskBefore.toFixed(4)}, after=${riskAfter.toFixed(4)})`
        : `TAIL no risk increase: FAIL (before=${riskBefore.toFixed(4)}, after=${riskAfter.toFixed(4)})`
    };
  },
  
  // 7. scaleFactor bounded
  testScaleFactorBounded(): { passed: boolean; message: string } {
    const scenarios = [
      { vol: 0.05, tail: 0.01 },  // Very low vol/tail → high scale
      { vol: 0.30, tail: 0.12 },  // High vol/tail → low scale
      { vol: 0.15, tail: 0.05 },  // Normal
    ];
    
    for (const s of scenarios) {
      const input: CapitalScalingInput = {
        allocations: { spx: 0.35, btc: 0.25, cash: 0.40 },
        scenario: 'BASE',
        guardLevel: 'NORMAL',
        realizedVol: s.vol,
        tailRisk: s.tail,
        asOf: '2024-01-15'
      };
      
      const result = applyCapitalScaling(input, 'on');
      const sf = result.pack.scaleFactor;
      
      // scaleFactor can vary widely depending on riskBefore vs riskBudgetFinal
      // but should never be negative or extremely large
      if (sf < 0 || sf > 10) {
        return { passed: false, message: `scaleFactor bounded: FAIL (sf = ${sf})` };
      }
    }
    
    return { passed: true, message: 'scaleFactor bounded: PASS' };
  },
  
  // 8. risk delta ≤ 0.10 in BASE
  testDeltaCapBASE(): { passed: boolean; message: string } {
    const input: CapitalScalingInput = {
      allocations: { spx: 0.50, btc: 0.40, cash: 0.10 },  // 90% risk
      scenario: 'BASE',
      guardLevel: 'NORMAL',
      realizedVol: 0.25,  // High vol → wants to reduce significantly
      tailRisk: 0.09,     // High tail → more reduction
      asOf: '2024-01-15'
    };
    
    const riskBefore = input.allocations.spx + input.allocations.btc;
    const result = applyCapitalScaling(input, 'on');
    const riskAfter = result.allocations.spx + result.allocations.btc;
    const delta = Math.abs(riskAfter - riskBefore);
    
    return {
      passed: delta <= 0.101,
      message: delta <= 0.101
        ? `Delta cap BASE: PASS (delta = ${delta.toFixed(4)} ≤ 0.10)`
        : `Delta cap BASE: FAIL (delta = ${delta.toFixed(4)} > 0.10)`
    };
  },
  
  // 9. negative vol handled
  testNegativeVolHandled(): { passed: boolean; message: string } {
    const input: CapitalScalingInput = {
      allocations: { spx: 0.35, btc: 0.25, cash: 0.40 },
      scenario: 'BASE',
      guardLevel: 'NORMAL',
      realizedVol: -0.05,  // Invalid negative vol
      tailRisk: 0.05,
      asOf: '2024-01-15'
    };
    
    const result = applyCapitalScaling(input, 'on');
    
    // Should not crash, should handle gracefully
    const valid = !hasNaN(result.allocations) && assertSum1(result.allocations);
    
    return {
      passed: valid,
      message: valid
        ? 'Negative vol handled: PASS (graceful handling)'
        : 'Negative vol handled: FAIL (NaN or invalid sum)'
    };
  },
  
  // 10. shadow mode does not change allocations
  testShadowNoChange(): { passed: boolean; message: string } {
    const input: CapitalScalingInput = {
      allocations: { spx: 0.35, btc: 0.25, cash: 0.40 },
      scenario: 'BASE',
      guardLevel: 'NORMAL',
      realizedVol: 0.20,
      tailRisk: 0.07,
      asOf: '2024-01-15'
    };
    
    const result = applyCapitalScaling(input, 'shadow');
    
    const unchanged = 
      result.allocations.spx === input.allocations.spx &&
      result.allocations.btc === input.allocations.btc &&
      result.allocations.cash === input.allocations.cash;
    
    return {
      passed: unchanged,
      message: unchanged
        ? 'Shadow no change: PASS'
        : `Shadow no change: FAIL (allocations were modified)`
    };
  },
};

// Run all tests
export function runAllCapitalScalingTests(): { 
  passed: number; 
  failed: number; 
  results: Array<{ name: string; passed: boolean; message: string }> 
} {
  const results: Array<{ name: string; passed: boolean; message: string }> = [];
  
  const tests = [
    { name: 'determinism', fn: capitalScalingTests.testDeterminism },
    { name: 'sumEqualsOne', fn: capitalScalingTests.testSumEqualsOne },
    { name: 'noNaN', fn: capitalScalingTests.testNoNaN },
    { name: 'guardBLOCK', fn: capitalScalingTests.testGuardBLOCK },
    { name: 'guardCRISIS', fn: capitalScalingTests.testGuardCRISIS },
    { name: 'TAILNoRiskIncrease', fn: capitalScalingTests.testTAILNoRiskIncrease },
    { name: 'scaleFactorBounded', fn: capitalScalingTests.testScaleFactorBounded },
    { name: 'deltaCapBASE', fn: capitalScalingTests.testDeltaCapBASE },
    { name: 'negativeVolHandled', fn: capitalScalingTests.testNegativeVolHandled },
    { name: 'shadowNoChange', fn: capitalScalingTests.testShadowNoChange },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = test.fn();
      results.push({ name: test.name, ...result });
      if (result.passed) passed++;
      else failed++;
    } catch (e) {
      results.push({ 
        name: test.name, 
        passed: false, 
        message: `EXCEPTION: ${(e as Error).message}` 
      });
      failed++;
    }
  }
  
  return { passed, failed, results };
}
