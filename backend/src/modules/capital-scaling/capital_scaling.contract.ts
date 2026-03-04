/**
 * CAPITAL SCALING CONTRACT — v2.3
 * 
 * Type definitions for Risk Budget Targeting Layer
 * Institutional-grade transparency and audit trail
 */

export type CapitalScalingMode = 'off' | 'on' | 'shadow';

export type GuardLevel = 'NORMAL' | 'CRISIS' | 'BLOCK';
export type ScenarioType = 'BASE' | 'RISK' | 'TAIL';

export interface CapitalScalingDrivers {
  volScale: number;       // Vol targeting scale (0.80-1.20)
  tailScale: number;      // Tail risk penalty scale (0.75-1.0)
  regimeScale: number;    // Regime adjustment scale (0.90-1.05)
  guardAdjusted: boolean; // Whether guard cap was applied
  clamp: boolean;         // Whether final clamp was applied
}

export interface AllocationState {
  spx: number;
  btc: number;
  cash: number;
}

export interface CapitalScalingPack {
  mode: CapitalScalingMode;
  
  // Risk budget calculation
  baseRiskBudget: number;
  riskBudgetBefore: number;  // SPX + BTC before scaling
  riskBudgetAfter: number;   // Target risk after scaling
  scaleFactor: number;       // Applied scale factor
  
  // Driver breakdown
  drivers: CapitalScalingDrivers;
  
  // Allocation states
  before: AllocationState;
  after: AllocationState;
  
  // Audit
  hash: string;              // Determinism check
  timestamp: string;
  warnings: string[];
}

export interface CapitalScalingInput {
  allocations: AllocationState;
  scenario: ScenarioType;
  guardLevel: GuardLevel;
  realizedVol: number;       // 30d realized volatility
  tailRisk: number;          // Tail risk score (0-1)
  asOf: string;
}

export interface CapitalScalingResult {
  allocations: AllocationState;
  pack: CapitalScalingPack;
}

// Helper to create deterministic hash for audit
export function createScalingHash(input: CapitalScalingInput): string {
  const str = JSON.stringify({
    alloc: input.allocations,
    scenario: input.scenario,
    guard: input.guardLevel,
    vol: Math.round(input.realizedVol * 10000),
    tail: Math.round(input.tailRisk * 10000),
    asOf: input.asOf
  });
  
  // Simple hash for determinism check
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
