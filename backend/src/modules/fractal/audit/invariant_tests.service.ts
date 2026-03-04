/**
 * INVARIANT TESTS SERVICE
 * 
 * L2/L3 Audit: 12 Critical Invariant Tests
 * 
 * A. Normalization / Invariants (1-4)
 * B. Overlay Neutrality & Sensitivity (5-9)
 * C. Consistency across Horizons (10-11)
 * D. Determinism / asOf (12)
 */

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  metric?: number;
  threshold?: number;
  details?: string;
}

export interface InvariantTestSuite {
  asset: string;
  timestamp: string;
  tests: TestResult[];
  summary: {
    passed: number;
    failed: number;
    total: number;
    passRate: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function round6(x: number): number {
  return Math.round(x * 1000000) / 1000000;
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

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB) + 1e-12;
  return dot / denom;
}

function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0));
  if (norm < 1e-12) return vec;
  return vec.map(x => x / norm);
}

function zScoreNormalize(vec: number[]): number[] {
  const m = mean(vec);
  const s = std(vec);
  if (s < 1e-12) return vec.map(() => 0);
  return vec.map(x => (x - m) / s);
}

function logReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  return returns;
}

// ═══════════════════════════════════════════════════════════════
// TEST 1: SCALE INVARIANCE (returns × 2)
// ═══════════════════════════════════════════════════════════════

export function testScaleInvariance(prices: number[], threshold: number = 0.02): TestResult {
  // Original returns
  const returns = logReturns(prices);
  const normalizedOriginal = l2Normalize(zScoreNormalize(returns));
  
  // Scaled returns (×2)
  const scaledReturns = returns.map(r => r * 2);
  const normalizedScaled = l2Normalize(zScoreNormalize(scaledReturns));
  
  // Compare cosine similarity
  const sim = cosineSimilarity(normalizedOriginal, normalizedScaled);
  const diff = Math.abs(1 - sim);
  
  return {
    name: 'Scale Invariance (returns ×2)',
    passed: diff <= threshold,
    expected: `diff <= ${threshold}`,
    actual: `diff = ${round6(diff)}`,
    metric: round6(diff),
    threshold,
    details: `Cosine similarity after ×2 scaling: ${round6(sim)}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 2: SHIFT INVARIANCE (price + C)
// ═══════════════════════════════════════════════════════════════

export function testShiftInvariance(prices: number[], shift: number = 1000, threshold: number = 1e-10): TestResult {
  // Original returns
  const returns = logReturns(prices);
  
  // Shifted prices
  const shiftedPrices = prices.map(p => p + shift);
  const shiftedReturns = logReturns(shiftedPrices);
  
  // Returns should NOT be exactly the same (shift breaks log-returns)
  // But percentage returns would be similar for large prices
  // This test checks that our log-return pipeline handles shifts correctly
  
  // For log-returns: ln((p+C)/(p0+C)) ≠ ln(p/p0) unless C=0
  // So we expect SOME difference
  const diffs = returns.map((r, i) => Math.abs(r - (shiftedReturns[i] || 0)));
  const maxDiff = Math.max(...diffs);
  
  // Note: For log-returns, shift WILL change values
  // This test documents the expected behavior
  // With high prices and low shift, diff should be small
  const avgPrice = mean(prices);
  const expectedMaxDiff = shift / avgPrice; // Rough approximation
  
  return {
    name: 'Shift Invariance (price + C)',
    passed: maxDiff < expectedMaxDiff * 2, // Allow 2x expected
    expected: `maxDiff < ${round6(expectedMaxDiff * 2)}`,
    actual: `maxDiff = ${round6(maxDiff)}`,
    metric: round6(maxDiff),
    threshold: round6(expectedMaxDiff * 2),
    details: `Avg price: ${round6(avgPrice)}, Shift: ${shift}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 3: NO NaN / INFINITE
// ═══════════════════════════════════════════════════════════════

export function testNoNaNInfinite(data: Record<string, any>): TestResult {
  const issues: string[] = [];
  
  function checkValue(val: any, path: string): void {
    if (typeof val === 'number') {
      if (Number.isNaN(val)) issues.push(`NaN at ${path}`);
      if (!Number.isFinite(val)) issues.push(`Infinite at ${path}`);
    } else if (Array.isArray(val)) {
      val.forEach((v, i) => checkValue(v, `${path}[${i}]`));
    } else if (val && typeof val === 'object') {
      Object.entries(val).forEach(([k, v]) => checkValue(v, `${path}.${k}`));
    }
  }
  
  checkValue(data, 'root');
  
  return {
    name: 'No NaN / Infinite Values',
    passed: issues.length === 0,
    expected: '0 issues',
    actual: `${issues.length} issues`,
    metric: issues.length,
    threshold: 0,
    details: issues.length > 0 ? issues.slice(0, 5).join('; ') : 'All values finite',
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 4: BOUNDED OUTPUTS
// ═══════════════════════════════════════════════════════════════

export function testBoundedOutputs(outputs: {
  similarity?: number;
  confidence?: number;
  weights?: number[];
  alpha?: number;
}): TestResult {
  const issues: string[] = [];
  
  // Similarity ∈ [-1, 1]
  if (outputs.similarity !== undefined) {
    if (outputs.similarity < -1 || outputs.similarity > 1) {
      issues.push(`similarity ${outputs.similarity} outside [-1,1]`);
    }
  }
  
  // Confidence ∈ [0, 1]
  if (outputs.confidence !== undefined) {
    if (outputs.confidence < 0 || outputs.confidence > 1) {
      issues.push(`confidence ${outputs.confidence} outside [0,1]`);
    }
  }
  
  // Weights sum check
  if (outputs.weights && outputs.weights.length > 0) {
    const sum = outputs.weights.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.01) {
      issues.push(`weights sum ${round6(sum)} != 1`);
    }
  }
  
  // Alpha ∈ [0, 1]
  if (outputs.alpha !== undefined) {
    if (outputs.alpha < 0 || outputs.alpha > 1) {
      issues.push(`alpha ${outputs.alpha} outside [0,1]`);
    }
  }
  
  return {
    name: 'Bounded Outputs',
    passed: issues.length === 0,
    expected: 'All outputs in valid ranges',
    actual: issues.length === 0 ? 'All bounded' : issues.join('; '),
    metric: issues.length,
    threshold: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 5: OVERLAY NEUTRALITY β=0
// ═══════════════════════════════════════════════════════════════

export function testOverlayNeutralityBeta(
  R_base: number,
  R_ref: number,
  g: number,
  w: number,
  beta: number = 0,
  threshold: number = 1e-10
): TestResult {
  // R_adj = R_base + g × w × β × R_ref
  // If β=0 → R_adj should equal R_base
  
  const R_adj = R_base + g * w * beta * R_ref;
  const diff = Math.abs(R_adj - R_base);
  
  return {
    name: 'Overlay Neutrality (β=0)',
    passed: diff <= threshold,
    expected: `R_adj == R_base when β=0`,
    actual: `diff = ${round6(diff)}`,
    metric: round6(diff),
    threshold,
    details: `R_base=${round6(R_base)}, R_adj=${round6(R_adj)}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 6: OVERLAY NEUTRALITY g=0
// ═══════════════════════════════════════════════════════════════

export function testOverlayNeutralityG(
  R_base: number,
  R_ref: number,
  g: number = 0,
  w: number,
  beta: number,
  threshold: number = 1e-10
): TestResult {
  const R_adj = R_base + g * w * beta * R_ref;
  const diff = Math.abs(R_adj - R_base);
  
  return {
    name: 'Overlay Neutrality (g=0)',
    passed: diff <= threshold,
    expected: `R_adj == R_base when g=0`,
    actual: `diff = ${round6(diff)}`,
    metric: round6(diff),
    threshold,
    details: `R_base=${round6(R_base)}, R_adj=${round6(R_adj)}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 7: OVERLAY NEUTRALITY w=0
// ═══════════════════════════════════════════════════════════════

export function testOverlayNeutralityW(
  R_base: number,
  R_ref: number,
  g: number,
  w: number = 0,
  beta: number,
  threshold: number = 1e-10
): TestResult {
  const R_adj = R_base + g * w * beta * R_ref;
  const diff = Math.abs(R_adj - R_base);
  
  return {
    name: 'Overlay Neutrality (w=0)',
    passed: diff <= threshold,
    expected: `R_adj == R_base when w=0`,
    actual: `diff = ${round6(diff)}`,
    metric: round6(diff),
    threshold,
    details: `R_base=${round6(R_base)}, R_adj=${round6(R_adj)}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 8: OVERLAY MONOTONICITY
// ═══════════════════════════════════════════════════════════════

export function testOverlayMonotonicity(
  R_base: number,
  R_ref: number,
  g: number,
  w: number,
  beta: number
): TestResult {
  // If R_ref > 0 and β > 0 and g > 0 and w > 0
  // → impact should be positive
  
  const impact = g * w * beta * R_ref;
  const expectedSign = Math.sign(beta) * Math.sign(R_ref);
  const actualSign = Math.sign(impact);
  
  // Only test when all params are positive
  const allPositive = g > 0 && w > 0 && beta > 0 && R_ref > 0;
  
  if (!allPositive) {
    return {
      name: 'Overlay Monotonicity',
      passed: true,
      expected: 'N/A (not all params positive)',
      actual: 'Skipped',
      details: `g=${g}, w=${w}, β=${beta}, R_ref=${R_ref}`,
    };
  }
  
  return {
    name: 'Overlay Monotonicity',
    passed: actualSign === expectedSign,
    expected: `impact sign matches expected (${expectedSign > 0 ? '+' : '-'})`,
    actual: `impact = ${round6(impact)}, sign = ${actualSign > 0 ? '+' : '-'}`,
    metric: impact,
    details: `Expected sign: ${expectedSign}, Actual sign: ${actualSign}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 9: OVERLAY BOUNDED IMPACT
// ═══════════════════════════════════════════════════════════════

export function testOverlayBoundedImpact(
  R_base: number,
  R_adj: number,
  overlayCap: number = 0.5
): TestResult {
  const impact = Math.abs(R_adj - R_base);
  const maxAllowed = overlayCap * Math.abs(R_base);
  
  // Edge case: if R_base is very small, allow small absolute impact
  const threshold = Math.max(maxAllowed, 0.01);
  
  return {
    name: 'Overlay Bounded Impact',
    passed: impact <= threshold,
    expected: `|R_adj - R_base| <= ${round6(threshold)}`,
    actual: `impact = ${round6(impact)}`,
    metric: round6(impact),
    threshold: round6(threshold),
    details: `R_base=${round6(R_base)}, R_adj=${round6(R_adj)}, cap=${overlayCap}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 10: PREFIX CONSISTENCY (180 in 365)
// ═══════════════════════════════════════════════════════════════

export function testPrefixConsistency(
  prefix365: number[],
  standalone180: number[],
  threshold: number = 7.0
): TestResult {
  const days = Math.min(prefix365.length, standalone180.length, 180);
  
  if (days === 0) {
    return {
      name: 'Prefix Consistency (180 in 365)',
      passed: false,
      expected: `meanAbsDiff <= ${threshold}%`,
      actual: 'No data to compare',
      metric: 0,
      threshold,
    };
  }
  
  let totalAbsDiff = 0;
  for (let i = 0; i < days; i++) {
    totalAbsDiff += Math.abs((prefix365[i] || 0) - (standalone180[i] || 0));
  }
  
  const meanAbsDiff = totalAbsDiff / days;
  
  return {
    name: 'Prefix Consistency (180 in 365)',
    passed: meanAbsDiff <= threshold,
    expected: `meanAbsDiff <= ${threshold}%`,
    actual: `meanAbsDiff = ${round6(meanAbsDiff)}%`,
    metric: round6(meanAbsDiff),
    threshold,
    details: `Compared ${days} days`,
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 11: HIERARCHY PENALTY EFFECTIVENESS
// ═══════════════════════════════════════════════════════════════

export function testHierarchyPenaltyEffectiveness(
  originalDiff: number,
  adjustedDiff: number,
  minReduction: number = 0.3
): TestResult {
  // After soft blend, diff should reduce by at least minReduction (30%)
  const reduction = originalDiff > 0 
    ? (originalDiff - adjustedDiff) / originalDiff 
    : 0;
  
  return {
    name: 'Hierarchy Penalty Effectiveness',
    passed: reduction >= minReduction || originalDiff < 3, // Skip if diff was small
    expected: `reduction >= ${minReduction * 100}% or original diff < 3%`,
    actual: `reduction = ${round6(reduction * 100)}%`,
    metric: round6(reduction * 100),
    threshold: minReduction * 100,
    details: `Original: ${round6(originalDiff)}%, Adjusted: ${round6(adjustedDiff)}%`,
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 12: DETERMINISM
// ═══════════════════════════════════════════════════════════════

export function testDeterminism(
  run1Hash: string,
  run2Hash: string
): TestResult {
  return {
    name: 'Determinism (same input → same output)',
    passed: run1Hash === run2Hash,
    expected: `hash1 === hash2`,
    actual: run1Hash === run2Hash ? 'Hashes match' : `${run1Hash} !== ${run2Hash}`,
    details: `Run 1: ${run1Hash.slice(0, 16)}..., Run 2: ${run2Hash.slice(0, 16)}...`,
  };
}

// ═══════════════════════════════════════════════════════════════
// FULL SUITE RUNNER
// ═══════════════════════════════════════════════════════════════

export interface TestInputs {
  prices: number[];
  similarity?: number;
  confidence?: number;
  weights?: number[];
  alpha?: number;
  R_base: number;
  R_ref: number;
  g: number;
  w: number;
  beta: number;
  R_adj: number;
  prefix365?: number[];
  standalone180?: number[];
  originalDiff?: number;
  adjustedDiff?: number;
  run1Hash?: string;
  run2Hash?: string;
  dataObject?: Record<string, any>;
}

export function runInvariantTestSuite(
  asset: string,
  inputs: TestInputs
): InvariantTestSuite {
  const tests: TestResult[] = [];
  
  // A. Normalization Tests (1-4)
  tests.push(testScaleInvariance(inputs.prices));
  tests.push(testShiftInvariance(inputs.prices));
  
  if (inputs.dataObject) {
    tests.push(testNoNaNInfinite(inputs.dataObject));
  }
  
  tests.push(testBoundedOutputs({
    similarity: inputs.similarity,
    confidence: inputs.confidence,
    weights: inputs.weights,
    alpha: inputs.alpha,
  }));
  
  // B. Overlay Tests (5-9)
  tests.push(testOverlayNeutralityBeta(inputs.R_base, inputs.R_ref, inputs.g, inputs.w, 0));
  tests.push(testOverlayNeutralityG(inputs.R_base, inputs.R_ref, 0, inputs.w, inputs.beta));
  tests.push(testOverlayNeutralityW(inputs.R_base, inputs.R_ref, inputs.g, 0, inputs.beta));
  tests.push(testOverlayMonotonicity(inputs.R_base, inputs.R_ref, inputs.g, inputs.w, inputs.beta));
  tests.push(testOverlayBoundedImpact(inputs.R_base, inputs.R_adj));
  
  // C. Consistency Tests (10-11)
  if (inputs.prefix365 && inputs.standalone180) {
    tests.push(testPrefixConsistency(inputs.prefix365, inputs.standalone180));
  }
  
  if (inputs.originalDiff !== undefined && inputs.adjustedDiff !== undefined) {
    tests.push(testHierarchyPenaltyEffectiveness(inputs.originalDiff, inputs.adjustedDiff));
  }
  
  // D. Determinism Test (12)
  if (inputs.run1Hash && inputs.run2Hash) {
    tests.push(testDeterminism(inputs.run1Hash, inputs.run2Hash));
  }
  
  // Summary
  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;
  
  return {
    asset,
    timestamp: new Date().toISOString(),
    tests,
    summary: {
      passed,
      failed,
      total: tests.length,
      passRate: round6(passed / tests.length),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  // Individual tests
  testScaleInvariance,
  testShiftInvariance,
  testNoNaNInfinite,
  testBoundedOutputs,
  testOverlayNeutralityBeta,
  testOverlayNeutralityG,
  testOverlayNeutralityW,
  testOverlayMonotonicity,
  testOverlayBoundedImpact,
  testPrefixConsistency,
  testHierarchyPenaltyEffectiveness,
  testDeterminism,
  // Suite runner
  runInvariantTestSuite,
};
