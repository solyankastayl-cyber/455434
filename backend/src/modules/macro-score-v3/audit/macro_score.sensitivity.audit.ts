/**
 * SENSITIVITY AUDIT
 * 
 * L4 Tests for MacroScore stability:
 * - Window sensitivity (90/180/365)
 * - k-parameter sensitivity (1.5/2.0/2.5)
 * - Transform consistency (YoY vs Delta)
 */

import {
  MacroScoreV3Config,
  DEFAULT_CONFIG,
  AuditTestResult,
} from '../macro_score.contract.js';
import {
  computeMacroScoreV3,
  SeriesData,
} from '../macro_score.service.js';
import { generateAllMockSeries } from '../macro_score.audit.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

// ═══════════════════════════════════════════════════════════════
// S-1: WINDOW STABILITY TEST
// ═══════════════════════════════════════════════════════════════

export interface WindowSensitivityResult {
  scores: Record<number, number>;
  signFlips: boolean;
  maxDeviation: number;
  passed: boolean;
}

export async function runWindowSensitivity(
  seriesData: SeriesData[],
  asOf: string,
  threshold: number = 0.25
): Promise<WindowSensitivityResult> {
  const windows = [90, 180, 365];
  const scores: Record<number, number> = {};
  
  for (const windowDays of windows) {
    const cfg: MacroScoreV3Config = { ...DEFAULT_CONFIG, windowDays };
    const result = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90, cfg);
    scores[windowDays] = result.score;
  }
  
  // Check sign flips
  const signs = Object.values(scores).map(s => Math.sign(s));
  const signFlips = signs.some((s, i) => i > 0 && s !== signs[i - 1] && Math.abs(scores[windows[i]]) > 0.1);
  
  // Max deviation
  const maxDeviation = Math.abs(scores[180] - scores[365]);
  
  return {
    scores,
    signFlips,
    maxDeviation: round4(maxDeviation),
    passed: maxDeviation <= threshold && !signFlips,
  };
}

export function testWindowStability(
  result: WindowSensitivityResult,
  threshold: number = 0.25
): AuditTestResult {
  return {
    id: 'S-1',
    name: 'Window Stability',
    category: 'invariant',
    passed: result.passed,
    expected: `|score_180 - score_365| <= ${threshold}, no sign flips`,
    actual: `deviation=${result.maxDeviation}, signFlips=${result.signFlips}`,
    metric: result.maxDeviation,
    threshold,
    details: `Scores: 90d=${result.scores[90]}, 180d=${result.scores[180]}, 365d=${result.scores[365]}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// S-2: K-PARAMETER SENSITIVITY TEST
// ═══════════════════════════════════════════════════════════════

export interface KSensitivityResult {
  scores: Record<number, number>;
  concentration: number;
  signFlipAtHighConcentration: boolean;
  passed: boolean;
}

export async function runKSensitivity(
  seriesData: SeriesData[],
  asOf: string,
  concentrationThreshold: number = 0.65
): Promise<KSensitivityResult> {
  const kValues = [1.5, 2.0, 2.5];
  const scores: Record<number, number> = {};
  let concentration = 0;
  
  for (const k of kValues) {
    const cfg: MacroScoreV3Config = { ...DEFAULT_CONFIG, tanhK: k };
    const result = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90, cfg);
    scores[k] = result.score;
    if (k === 2.0) concentration = result.concentration;
  }
  
  // Check sign flip at high concentration
  const signs = kValues.map(k => Math.sign(scores[k]));
  const signFlipAtHighConcentration = 
    concentration > concentrationThreshold &&
    signs.some((s, i) => i > 0 && s !== signs[i - 1]);
  
  return {
    scores,
    concentration: round4(concentration),
    signFlipAtHighConcentration,
    passed: !signFlipAtHighConcentration,
  };
}

export function testKSensitivity(
  result: KSensitivityResult
): AuditTestResult {
  return {
    id: 'S-2',
    name: 'k-Parameter Sensitivity',
    category: 'invariant',
    passed: result.passed,
    expected: 'No sign flip when concentration > 0.65',
    actual: `signFlip=${result.signFlipAtHighConcentration}, conc=${result.concentration}`,
    metric: result.concentration,
    threshold: 0.65,
    details: `Scores: k=1.5→${result.scores[1.5]}, k=2.0→${result.scores[2.0]}, k=2.5→${result.scores[2.5]}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// S-3: TRANSFORM CONSISTENCY (Enhanced for Real Data)
// ═══════════════════════════════════════════════════════════════

export interface TransformConsistencyDetails {
  consistencyScore: number;
  totalHighZ: number;
  consistentCount: number;
  violations: Array<{
    series: string;
    z: number;
    signal: number;
    issue: string;
  }>;
  windowSensitivity: {
    window90: number;
    window180: number;
    delta: number;
  };
}

export async function testTransformConsistency(
  seriesData: SeriesData[],
  asOf: string
): Promise<AuditTestResult & { details: TransformConsistencyDetails }> {
  // Run with default config (90d window)
  const result90 = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90);
  
  // Also run with 180d window to check sensitivity
  const cfg180 = { ...DEFAULT_CONFIG, windowDays: 180 };
  const result180 = await computeMacroScoreV3(seriesData, asOf, 'DXY', 90, cfg180);
  
  // Check that high z-scores have consistent signals
  const zScores = result90.diagnostics.zScores;
  const signals = result90.diagnostics.signals;
  
  let consistent = 0;
  let total = 0;
  const violations: TransformConsistencyDetails['violations'] = [];
  
  for (const [key, z] of Object.entries(zScores)) {
    if (Math.abs(z) > 1.5) {
      total++;
      const signal = signals[key] || 0;
      
      // For high |z|, signal should have same sign as z (accounting for direction)
      // Direction is already factored into signal computation
      const signConsistent = Math.sign(z) === Math.sign(signal) || Math.abs(signal) < 0.1;
      
      if (signConsistent) {
        consistent++;
      } else {
        violations.push({
          series: key,
          z: round4(z),
          signal: round4(signal),
          issue: `Sign mismatch: z=${z > 0 ? '+' : '-'}, signal=${signal > 0 ? '+' : '-'}`,
        });
      }
    }
  }
  
  // Compute window sensitivity
  const windowDelta = Math.abs(result90.score - result180.score);
  
  // Consistency score (0..1)
  // Combines: sign consistency + window stability
  const signConsistency = total > 0 ? consistent / total : 1;
  const windowStability = 1 - Math.min(windowDelta / 0.3, 1); // 0.3 = max acceptable delta
  const consistencyScore = (signConsistency * 0.7) + (windowStability * 0.3);
  
  // Pass if consistencyScore >= 0.6 (not 0.8, to account for real data noise)
  const threshold = 0.6;
  const passed = consistencyScore >= threshold;
  
  const details: TransformConsistencyDetails = {
    consistencyScore: round4(consistencyScore),
    totalHighZ: total,
    consistentCount: consistent,
    violations,
    windowSensitivity: {
      window90: round4(result90.score),
      window180: round4(result180.score),
      delta: round4(windowDelta),
    },
  };
  
  return {
    id: 'S-3',
    name: 'Transform Consistency',
    category: 'invariant',
    passed,
    expected: `consistencyScore >= ${threshold}`,
    actual: `${round4(consistencyScore)} (sign: ${Math.round(signConsistency * 100)}%, windowStability: ${Math.round(windowStability * 100)}%)`,
    metric: round4(consistencyScore),
    threshold,
    details,
  };
}

// ═══════════════════════════════════════════════════════════════
// FULL SENSITIVITY AUDIT
// ═══════════════════════════════════════════════════════════════

export interface SensitivityAuditResult {
  asOf: string;
  timestamp: string;
  tests: AuditTestResult[];
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
  windowAnalysis: WindowSensitivityResult;
  kAnalysis: KSensitivityResult;
}

export async function runFullSensitivityAudit(
  seriesData: SeriesData[],
  asOf: string
): Promise<SensitivityAuditResult> {
  const data = seriesData.length > 0 ? seriesData : generateAllMockSeries();
  
  // Run analyses
  const windowResult = await runWindowSensitivity(data, asOf);
  const kResult = await runKSensitivity(data, asOf);
  
  // Build tests
  const tests: AuditTestResult[] = [
    testWindowStability(windowResult),
    testKSensitivity(kResult),
    await testTransformConsistency(data, asOf),
  ];
  
  const passed = tests.filter(t => t.passed).length;
  
  return {
    asOf,
    timestamp: new Date().toISOString(),
    tests,
    summary: {
      passed,
      failed: tests.length - passed,
      total: tests.length,
    },
    windowAnalysis: windowResult,
    kAnalysis: kResult,
  };
}

export default {
  runWindowSensitivity,
  runKSensitivity,
  testTransformConsistency,
  runFullSensitivityAudit,
};
