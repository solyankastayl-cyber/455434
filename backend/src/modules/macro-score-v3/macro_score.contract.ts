/**
 * MACRO SCORE V3 — CONTRACTS
 * 
 * Type definitions for MacroScore v3 computation
 */

// ═══════════════════════════════════════════════════════════════
// DIRECTION MAP
// ═══════════════════════════════════════════════════════════════

export type SeriesDirection = -1 | 1;

export interface SeriesConfig {
  key: string;
  name: string;
  direction: SeriesDirection;
  transform: 'delta' | 'yoy' | 'level' | 'spread';
  lookbackMonths?: number;
  defaultWeight: number;
}

export const SERIES_CONFIG: SeriesConfig[] = [
  { key: 'FEDFUNDS', name: 'Fed Funds Rate', direction: -1, transform: 'delta', lookbackMonths: 3, defaultWeight: 0.133 },
  { key: 'CPIAUCSL', name: 'CPI Inflation', direction: -1, transform: 'yoy', defaultWeight: 0.070 },
  { key: 'CPILFESL', name: 'Core CPI', direction: -1, transform: 'yoy', defaultWeight: 0.035 },
  { key: 'PPIACO', name: 'PPI', direction: -1, transform: 'yoy', defaultWeight: 0.043 },
  { key: 'UNRATE', name: 'Unemployment', direction: -1, transform: 'delta', lookbackMonths: 3, defaultWeight: 0.124 },
  { key: 'T10Y2Y', name: 'Yield Curve Spread', direction: 1, transform: 'spread', defaultWeight: 0.250 },
  { key: 'M2SL', name: 'Money Supply M2', direction: 1, transform: 'yoy', defaultWeight: 0.091 },
  { key: 'BAA10Y', name: 'Credit Spread', direction: -1, transform: 'spread', defaultWeight: 0.080 },
  { key: 'TEDRATE', name: 'TED Spread', direction: -1, transform: 'spread', defaultWeight: 0.030 },
  { key: 'HOUST', name: 'Housing Starts', direction: 1, transform: 'yoy', defaultWeight: 0.060 },
  { key: 'INDPRO', name: 'Industrial Production', direction: 1, transform: 'yoy', defaultWeight: 0.050 },
  { key: 'VIXCLS', name: 'VIX', direction: -1, transform: 'level', defaultWeight: 0.034 },
];

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface MacroScoreV3Config {
  // Normalization
  zMax: number;
  tanhK: number;
  windowDays: number;
  madScaleFactor: number;
  epsilon: number;
  
  // Aggregation
  topKDrivers: number;
  
  // Overlay
  macroStrength: number;
  impactCap: number;
  
  // Feature flags
  enabled: boolean;
  useHorizonWeights: boolean;
  useFrequencyNormalization: boolean;  // Frequency normalization toggle
}

export const DEFAULT_CONFIG: MacroScoreV3Config = {
  zMax: 3.0,
  tanhK: 2.0,
  windowDays: 252,
  madScaleFactor: 1.4826,
  epsilon: 1e-10,
  topKDrivers: 3,
  macroStrength: 0.2,
  impactCap: 0.05,
  enabled: true,
  useHorizonWeights: true,
  useFrequencyNormalization: true,  // Enable by default
};

// ═══════════════════════════════════════════════════════════════
// OUTPUTS
// ═══════════════════════════════════════════════════════════════

export interface Driver {
  name: string;
  direction: SeriesDirection;
  contribution: number;
  z: number;
  signal: number;
  weight: number;
}

export interface WindowMeta {
  start: string;
  end: string;
  days: number;
}

export interface Diagnostics {
  inputsHash: string;
  seriesCount: number;
  missingSeries: string[];
  freshCount: number;
  zScores: Record<string, number>;
  signals: Record<string, number>;
  contributions: Record<string, number>;
  windowMeta: WindowMeta;
}

export interface MacroScoreV3Result {
  ok: boolean;
  version: string;
  asOf: string;
  asset: string;
  horizon: number;
  
  score: number;
  confidence: number;
  concentration: number;
  entropy: number;
  
  drivers: Driver[];
  diagnostics: Diagnostics;
  computedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// STRESS SCENARIOS
// ═══════════════════════════════════════════════════════════════

export type StressScenario = 
  | 'RATE_SHOCK'
  | 'INFLATION_SHOCK'
  | 'CURVE_INVERSION'
  | 'UNEMPLOYMENT_JUMP'
  | 'LIQUIDITY_FREEZE'
  | 'FLIGHT_TO_QUALITY'
  | 'DATA_CORRUPTION';

export interface StressConfig {
  scenario: StressScenario;
  perturbations: Record<string, number>; // series -> z delta
  missingSeries?: string[];
}

export const STRESS_SCENARIOS: StressConfig[] = [
  { scenario: 'RATE_SHOCK', perturbations: { FEDFUNDS: 2.0 } },
  { scenario: 'INFLATION_SHOCK', perturbations: { CPIAUCSL: 2.0, PPIACO: 1.5 } },
  { scenario: 'CURVE_INVERSION', perturbations: { T10Y2Y: -2.0 } },
  { scenario: 'UNEMPLOYMENT_JUMP', perturbations: { UNRATE: 2.0 } },
  { scenario: 'LIQUIDITY_FREEZE', perturbations: { M2SL: -2.0, BAA10Y: 2.0, TEDRATE: 2.0 } },
  { scenario: 'FLIGHT_TO_QUALITY', perturbations: { VIXCLS: 2.0, BAA10Y: 1.5 } },
  { scenario: 'DATA_CORRUPTION', perturbations: {}, missingSeries: ['FEDFUNDS', 'T10Y2Y'] },
];

// ═══════════════════════════════════════════════════════════════
// AUDIT TEST RESULTS
// ═══════════════════════════════════════════════════════════════

export interface AuditTestResult {
  id: string;
  name: string;
  category: 'invariant' | 'monotonicity' | 'stress' | 'overlay';
  passed: boolean;
  expected: string;
  actual: string;
  metric?: number;
  threshold?: number;
  details?: string;
}

export interface AuditSuiteResult {
  version: string;
  asset: string;
  asOf: string;
  timestamp: string;
  tests: AuditTestResult[];
  summary: {
    passed: number;
    failed: number;
    total: number;
    passRate: number;
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}
