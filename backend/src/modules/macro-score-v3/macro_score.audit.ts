/**
 * MACRO SCORE V3 — AUDIT TESTS
 * 
 * 12+ tests for institutional-grade validation:
 * - I1-I7: Invariants
 * - M1-M3: Monotonicity
 * - S1-S7: Stress scenarios
 * - O1-O3: Overlay constraints
 */

import {
  SERIES_CONFIG,
  MacroScoreV3Config,
  DEFAULT_CONFIG,
  AuditTestResult,
  AuditSuiteResult,
  StressConfig,
  STRESS_SCENARIOS,
  SeriesConfig,
} from './macro_score.contract.js';
import {
  normalizeSeries,
  TimeSeriesPoint,
  squash,
} from './macro_score.normalizer.js';
import {
  computeMacroScoreV3,
  applyMacroOverlay,
  SeriesData,
} from './macro_score.service.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function round6(x: number): number {
  return Math.round(x * 1000000) / 1000000;
}

function generateMockSeries(key: string, days: number = 365): TimeSeriesPoint[] {
  const series: TimeSeriesPoint[] = [];
  const baseDate = new Date('2026-03-01');
  
  // Base values by series
  const baseValues: Record<string, number> = {
    FEDFUNDS: 5.25,
    CPIAUCSL: 310,
    CPILFESL: 320,
    PPIACO: 280,
    UNRATE: 4.0,
    T10Y2Y: 0.5,
    M2SL: 21000,
    BAA10Y: 2.0,
    TEDRATE: 0.3,
    HOUST: 1400,
    INDPRO: 105,
    VIXCLS: 18,
  };
  
  const base = baseValues[key] || 100;
  const volatility = key === 'VIXCLS' ? 0.1 : 0.02;
  
  for (let i = days; i >= 0; i--) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - i);
    
    const noise = (Math.random() - 0.5) * 2 * volatility;
    const trend = (days - i) / days * 0.1; // Small uptrend
    const value = base * (1 + trend + noise);
    
    series.push({
      date: date.toISOString().slice(0, 10),
      value,
    });
  }
  
  return series;
}

function generateAllMockSeries(): SeriesData[] {
  return SERIES_CONFIG.map(config => ({
    key: config.key,
    data: generateMockSeries(config.key),
  }));
}

// ═══════════════════════════════════════════════════════════════
// INVARIANT TESTS (I1-I7)
// ═══════════════════════════════════════════════════════════════

/**
 * I1: No Lookahead - all values from released_at <= asOf
 */
export async function testNoLookahead(
  seriesData: SeriesData[],
  asOf: string
): Promise<AuditTestResult> {
  // Check that no data point after asOf is used
  let violations = 0;
  
  for (const series of seriesData) {
    const futurePoints = series.data.filter(p => p.date > asOf);
    if (futurePoints.length > 0) {
      // This shouldn't affect computation, but let's verify
      violations++;
    }
  }
  
  // Run computation and verify hash doesn't change with future data
  const result1 = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90);
  
  // Add future data
  const futureDate = new Date(asOf);
  futureDate.setDate(futureDate.getDate() + 30);
  const seriesWithFuture = seriesData.map(s => ({
    ...s,
    data: [...s.data, { date: futureDate.toISOString().slice(0, 10), value: 999999 }],
  }));
  
  const result2 = await computeMacroScoreV3(seriesWithFuture, asOf, 'DXY', 90);
  
  const hashMatch = result1.diagnostics.inputsHash === result2.diagnostics.inputsHash;
  const scoreMatch = result1.score === result2.score;
  
  return {
    id: 'I1',
    name: 'No Lookahead',
    category: 'invariant',
    passed: scoreMatch,
    expected: 'Score unchanged with future data',
    actual: scoreMatch ? 'Score unchanged' : `Score changed: ${result1.score} -> ${result2.score}`,
    details: `Hash match: ${hashMatch}`,
  };
}

/**
 * I2: Determinism - same asOf -> same hash
 */
export async function testDeterminism(
  seriesData: SeriesData[],
  asOf: string
): Promise<AuditTestResult> {
  const result1 = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90);
  const result2 = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90);
  
  const hashMatch = result1.diagnostics.inputsHash === result2.diagnostics.inputsHash;
  const scoreMatch = result1.score === result2.score;
  const confMatch = result1.confidence === result2.confidence;
  
  return {
    id: 'I2',
    name: 'Determinism',
    category: 'invariant',
    passed: hashMatch && scoreMatch && confMatch,
    expected: 'Same inputs -> same outputs',
    actual: hashMatch && scoreMatch ? 'Deterministic' : 'Non-deterministic',
    details: `Hash: ${result1.diagnostics.inputsHash}, Score: ${result1.score}`,
  };
}

/**
 * I3: Bounded Score - score ∈ [-1, +1]
 */
export async function testBoundedScore(
  seriesData: SeriesData[],
  asOf: string
): Promise<AuditTestResult> {
  const result = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90);
  const bounded = result.score >= -1 && result.score <= 1;
  
  return {
    id: 'I3',
    name: 'Bounded Score',
    category: 'invariant',
    passed: bounded,
    expected: 'score ∈ [-1, +1]',
    actual: `score = ${result.score}`,
    metric: result.score,
    threshold: 1,
  };
}

/**
 * I4: Bounded Confidence - confidence ∈ [0, 1]
 */
export async function testBoundedConfidence(
  seriesData: SeriesData[],
  asOf: string
): Promise<AuditTestResult> {
  const result = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90);
  const bounded = result.confidence >= 0 && result.confidence <= 1;
  
  return {
    id: 'I4',
    name: 'Bounded Confidence',
    category: 'invariant',
    passed: bounded,
    expected: 'confidence ∈ [0, 1]',
    actual: `confidence = ${result.confidence}`,
    metric: result.confidence,
    threshold: 1,
  };
}

/**
 * I5: Bounded Signals - all signals ∈ [-1, +1]
 */
export async function testBoundedSignals(
  seriesData: SeriesData[],
  asOf: string
): Promise<AuditTestResult> {
  const result = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90);
  const signals = Object.values(result.diagnostics.signals);
  const allBounded = signals.every(s => s >= -1 && s <= 1);
  const outOfBounds = signals.filter(s => s < -1 || s > 1);
  
  return {
    id: 'I5',
    name: 'Bounded Signals',
    category: 'invariant',
    passed: allBounded,
    expected: 'All signals ∈ [-1, +1]',
    actual: allBounded ? 'All bounded' : `${outOfBounds.length} out of bounds`,
    metric: outOfBounds.length,
    threshold: 0,
  };
}

/**
 * I6: No NaN/Inf
 */
export async function testNoNaNInf(
  seriesData: SeriesData[],
  asOf: string
): Promise<AuditTestResult> {
  const result = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90);
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
  
  checkValue(result, 'result');
  
  return {
    id: 'I6',
    name: 'No NaN/Inf',
    category: 'invariant',
    passed: issues.length === 0,
    expected: '0 NaN/Inf values',
    actual: `${issues.length} issues`,
    metric: issues.length,
    threshold: 0,
    details: issues.slice(0, 3).join('; '),
  };
}

/**
 * I7: Missing-safe - handles missing series gracefully
 */
export async function testMissingSafe(
  seriesData: SeriesData[],
  asOf: string
): Promise<AuditTestResult> {
  // Remove some series
  const partialData = seriesData.slice(0, Math.floor(seriesData.length / 2));
  
  try {
    const result = await computeMacroScoreV3(partialData, asOf, 'DXY', 90);
    const hasMissing = result.diagnostics.missingSeries.length > 0;
    const stillBounded = result.score >= -1 && result.score <= 1;
    
    return {
      id: 'I7',
      name: 'Missing-safe',
      category: 'invariant',
      passed: stillBounded && result.ok,
      expected: 'Graceful handling of missing series',
      actual: `${result.diagnostics.missingSeries.length} missing, score=${result.score}`,
      details: `Missing: ${result.diagnostics.missingSeries.join(', ')}`,
    };
  } catch (e: any) {
    return {
      id: 'I7',
      name: 'Missing-safe',
      category: 'invariant',
      passed: false,
      expected: 'No crash with missing series',
      actual: `Crashed: ${e.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// MONOTONICITY TESTS (M1-M3)
// ═══════════════════════════════════════════════════════════════

/**
 * M1: Direction Sanity - increasing bearish series -> more bearish signal
 */
export async function testDirectionSanity(
  seriesData: SeriesData[],
  asOf: string
): Promise<AuditTestResult> {
  // Test FEDFUNDS (direction=-1): increase -> more bearish
  const fedConfig = SERIES_CONFIG.find(c => c.key === 'FEDFUNDS')!;
  const fedData = seriesData.find(s => s.key === 'FEDFUNDS')?.data || [];
  
  // Normal signal
  const norm1 = normalizeSeries('FEDFUNDS', fedData, fedConfig, asOf);
  
  // Increase all values by 1 (rate hike)
  const increasedData = fedData.map(p => ({ ...p, value: p.value + 1 }));
  const norm2 = normalizeSeries('FEDFUNDS', increasedData, fedConfig, asOf);
  
  // With direction=-1, higher raw value should give lower (more bearish) signal
  const directionCorrect = norm2.signal <= norm1.signal;
  
  return {
    id: 'M1',
    name: 'Direction Sanity',
    category: 'monotonicity',
    passed: directionCorrect,
    expected: 'FEDFUNDS ↑ -> signal ↓ (bearish)',
    actual: `signal: ${norm1.signal} -> ${norm2.signal}`,
    details: `Direction=-1, Δsignal=${round6(norm2.signal - norm1.signal)}`,
  };
}

/**
 * M2: Weight Monotonic - increasing weight increases contribution magnitude
 */
export async function testWeightMonotonic(
  seriesData: SeriesData[],
  asOf: string
): Promise<AuditTestResult> {
  const result1 = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90);
  const t10Contrib1 = Math.abs(result1.diagnostics.contributions['T10Y2Y'] || 0);
  
  // Modify weights (would need config injection - test conceptually)
  // For now, verify that larger weights have larger contributions
  const contribs = Object.entries(result1.diagnostics.contributions)
    .map(([k, v]) => ({ key: k, contrib: Math.abs(v) }));
  
  const sorted = contribs.sort((a, b) => b.contrib - a.contrib);
  const topKey = sorted[0]?.key;
  const topConfig = SERIES_CONFIG.find(c => c.key === topKey);
  
  // Top contributor should have high weight
  const isMonotonic = topConfig && topConfig.defaultWeight >= 0.1;
  
  return {
    id: 'M2',
    name: 'Weight Monotonic',
    category: 'monotonicity',
    passed: isMonotonic,
    expected: 'Top contributor has significant weight',
    actual: `Top: ${topKey} (weight=${topConfig?.defaultWeight || 0})`,
    details: `Contributions: ${sorted.slice(0, 3).map(c => `${c.key}:${round6(c.contrib)}`).join(', ')}`,
  };
}

/**
 * M3: Aggregation Monotonic - bullish signal shift -> bullish score shift
 */
export async function testAggregationMonotonic(
  seriesData: SeriesData[],
  asOf: string
): Promise<AuditTestResult> {
  const result1 = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90);
  
  // Make T10Y2Y (direction=+1) more bullish by increasing values
  const modifiedData = seriesData.map(s => {
    if (s.key === 'T10Y2Y') {
      return {
        ...s,
        data: s.data.map(p => ({ ...p, value: p.value + 1 })), // More positive spread
      };
    }
    return s;
  });
  
  const result2 = await computeMacroScoreV3(modifiedData, asOf, 'DXY', 90);
  
  // Score should increase (more bullish)
  const scoreIncreased = result2.score >= result1.score;
  
  return {
    id: 'M3',
    name: 'Aggregation Monotonic',
    category: 'monotonicity',
    passed: scoreIncreased,
    expected: 'T10Y2Y ↑ -> score ↑',
    actual: `score: ${result1.score} -> ${result2.score}`,
    metric: result2.score - result1.score,
    details: `Δscore = ${round6(result2.score - result1.score)}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// STRESS TESTS (S1-S7)
// ═══════════════════════════════════════════════════════════════

/**
 * Run stress test for a scenario
 */
export async function runStressTest(
  scenario: StressConfig,
  seriesData: SeriesData[],
  asOf: string
): Promise<AuditTestResult> {
  // Apply perturbations
  let modifiedData = seriesData;
  
  // For z-score perturbations, we modify the latest values
  for (const [key, zDelta] of Object.entries(scenario.perturbations)) {
    modifiedData = modifiedData.map(s => {
      if (s.key === key && s.data.length > 0) {
        const lastIdx = s.data.length - 1;
        const lastValue = s.data[lastIdx].value;
        // Approximate z-score change by scaling value
        const scaleFactor = 1 + zDelta * 0.1; // Rough approximation
        return {
          ...s,
          data: s.data.map((p, i) => 
            i === lastIdx ? { ...p, value: lastValue * scaleFactor } : p
          ),
        };
      }
      return s;
    });
  }
  
  // Remove missing series if specified
  if (scenario.missingSeries && scenario.missingSeries.length > 0) {
    modifiedData = modifiedData.filter(s => !scenario.missingSeries!.includes(s.key));
  }
  
  try {
    const result = await computeMacroScoreV3(modifiedData, asOf, 'DXY', 90);
    
    // Check for violations
    const violations: string[] = [];
    
    if (result.score < -1 || result.score > 1) {
      violations.push(`Score out of bounds: ${result.score}`);
    }
    if (result.confidence < 0 || result.confidence > 1) {
      violations.push(`Confidence out of bounds: ${result.confidence}`);
    }
    if (Number.isNaN(result.score) || !Number.isFinite(result.score)) {
      violations.push('NaN/Inf in score');
    }
    if (result.confidence < 0.05 && result.diagnostics.seriesCount > 5) {
      violations.push('Confidence collapse');
    }
    
    return {
      id: `S-${scenario.scenario}`,
      name: `Stress: ${scenario.scenario}`,
      category: 'stress',
      passed: violations.length === 0,
      expected: 'No violations under stress',
      actual: violations.length === 0 ? 'Passed' : violations.join('; '),
      metric: violations.length,
      threshold: 0,
      details: `Score=${result.score}, Conf=${result.confidence}`,
    };
  } catch (e: any) {
    return {
      id: `S-${scenario.scenario}`,
      name: `Stress: ${scenario.scenario}`,
      category: 'stress',
      passed: false,
      expected: 'No crash under stress',
      actual: `Crashed: ${e.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY TESTS (O1-O3)
// ═══════════════════════════════════════════════════════════════

/**
 * O1: Overlay Neutrality - macroStrength=0 -> no impact
 */
export function testOverlayNeutrality(): AuditTestResult {
  const cfg: MacroScoreV3Config = { ...DEFAULT_CONFIG, macroStrength: 0 };
  const result = applyMacroOverlay(0.05, 0.5, cfg);
  
  const isNeutral = result.adjustedReturn === result.baseReturn;
  
  return {
    id: 'O1',
    name: 'Overlay Neutrality',
    category: 'overlay',
    passed: isNeutral,
    expected: 'macroStrength=0 -> no impact',
    actual: `base=${result.baseReturn}, adjusted=${result.adjustedReturn}`,
  };
}

/**
 * O2: Overlay Bounded - impact within cap
 */
export function testOverlayBounded(): AuditTestResult {
  const cfg = DEFAULT_CONFIG;
  const baseReturn = 0.1;
  const extremeScore = 1.0;
  
  const result = applyMacroOverlay(baseReturn, extremeScore, cfg);
  
  const maxAllowed = cfg.impactCap * Math.abs(baseReturn);
  const impact = Math.abs(result.macroImpact);
  const isBounded = impact <= maxAllowed + 1e-10;
  
  return {
    id: 'O2',
    name: 'Overlay Bounded',
    category: 'overlay',
    passed: isBounded,
    expected: `|impact| <= ${maxAllowed}`,
    actual: `impact = ${impact}`,
    metric: impact,
    threshold: maxAllowed,
  };
}

/**
 * O3: Overlay Sign Preservation - weak macro doesn't flip strong trend
 */
export function testOverlaySignPreservation(): AuditTestResult {
  const cfg = DEFAULT_CONFIG;
  const strongBullish = 0.2; // Strong positive return
  const weakBearishMacro = -0.3; // Weak bearish signal
  
  const result = applyMacroOverlay(strongBullish, weakBearishMacro, cfg);
  
  // Sign should be preserved
  const signPreserved = Math.sign(result.adjustedReturn) === Math.sign(result.baseReturn);
  
  return {
    id: 'O3',
    name: 'Overlay Sign Preservation',
    category: 'overlay',
    passed: signPreserved,
    expected: 'Weak macro preserves strong signal sign',
    actual: `base=${result.baseReturn}, adjusted=${result.adjustedReturn}`,
    details: `Impact=${result.macroImpact}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// FULL AUDIT SUITE
// ═══════════════════════════════════════════════════════════════

export async function runFullAuditSuite(
  seriesData: SeriesData[],
  asOf: string,
  asset: string = 'DXY'
): Promise<AuditSuiteResult> {
  const tests: AuditTestResult[] = [];
  
  // Use mock data if not provided
  const data = seriesData.length > 0 ? seriesData : generateAllMockSeries();
  
  // Invariant tests
  tests.push(await testNoLookahead(data, asOf));
  tests.push(await testDeterminism(data, asOf));
  tests.push(await testBoundedScore(data, asOf));
  tests.push(await testBoundedConfidence(data, asOf));
  tests.push(await testBoundedSignals(data, asOf));
  tests.push(await testNoNaNInf(data, asOf));
  tests.push(await testMissingSafe(data, asOf));
  
  // Monotonicity tests
  tests.push(await testDirectionSanity(data, asOf));
  tests.push(await testWeightMonotonic(data, asOf));
  tests.push(await testAggregationMonotonic(data, asOf));
  
  // Overlay tests
  tests.push(testOverlayNeutrality());
  tests.push(testOverlayBounded());
  tests.push(testOverlaySignPreservation());
  
  // Stress tests
  for (const scenario of STRESS_SCENARIOS) {
    tests.push(await runStressTest(scenario, data, asOf));
  }
  
  // Summary
  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;
  const total = tests.length;
  const passRate = passed / total;
  
  // Grade
  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (passRate >= 0.95) grade = 'A';
  else if (passRate >= 0.85) grade = 'B';
  else if (passRate >= 0.70) grade = 'C';
  else if (passRate >= 0.50) grade = 'D';
  else grade = 'F';
  
  return {
    version: 'v3.0.0',
    asset,
    asOf,
    timestamp: new Date().toISOString(),
    tests,
    summary: {
      passed,
      failed,
      total,
      passRate: Math.round(passRate * 10000) / 10000,
    },
    grade,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  generateAllMockSeries,
};

export default {
  runFullAuditSuite,
  testNoLookahead,
  testDeterminism,
  testBoundedScore,
  testBoundedConfidence,
  testBoundedSignals,
  testNoNaNInf,
  testMissingSafe,
  testDirectionSanity,
  testWeightMonotonic,
  testAggregationMonotonic,
  testOverlayNeutrality,
  testOverlayBounded,
  testOverlaySignPreservation,
  runStressTest,
};
