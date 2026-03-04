/**
 * BLOCK 58 — Resolver Types (Hierarchical Decision)
 * 
 * Types for:
 * - Bias (global market regime from 180d/365d)
 * - Timing (entry/exit from 7d/14d/30d)
 * - Final (combined decision with size multiplier)
 */

import type { HorizonKey } from '../../config/horizon.config.js';

// ═══════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════

export type ResolvedDir = "BULL" | "BEAR" | "NEUTRAL";
export type TimingAction = "ENTER" | "WAIT" | "EXIT";
export type FinalMode = "TREND_FOLLOW" | "COUNTER_TREND" | "HOLD";
export type FinalAction = "BUY" | "SELL" | "HOLD";
export type SignalDir = "LONG" | "SHORT" | "HOLD" | "NEUTRAL";

// ═══════════════════════════════════════════════════════════════
// COMPONENT TYPES
// ═══════════════════════════════════════════════════════════════

export interface HorizonResolvedComponent {
  horizon: HorizonKey;
  weight: number;              // normalized within the group
  signedEdge: number;          // [-1..1] where sign is direction
  confidence: number;          // [0..1]
  reliability: number;         // [0..1]
  phaseRisk: number;           // [0..1]
  contribution: number;        // weight * signedEdge * conf * rel * (1-phaseRisk)
}

// ═══════════════════════════════════════════════════════════════
// BIAS (GLOBAL REGIME)
// ═══════════════════════════════════════════════════════════════

export interface BiasResolved {
  dir: ResolvedDir;
  score: number;               // signed [-1..1]
  strength: number;            // abs(score) clamped [0..1]
  dominantHorizon: HorizonKey;
  components: HorizonResolvedComponent[];
}

// ═══════════════════════════════════════════════════════════════
// TIMING (ENTRY/EXIT)
// ═══════════════════════════════════════════════════════════════

export interface TimingResolved {
  action: TimingAction;
  score: number;               // signed
  strength: number;            // abs(score) clamped [0..1]
  dominantHorizon: HorizonKey;
  blockers: string[];
  components: HorizonResolvedComponent[];
}

// ═══════════════════════════════════════════════════════════════
// RISK ADJUSTMENT
// ═══════════════════════════════════════════════════════════════

export interface RiskAdjustment {
  entropyPenalty: number;      // [0..1]
  tailPenalty: number;         // [0..1]
}

// ═══════════════════════════════════════════════════════════════
// FINAL DECISION
// ═══════════════════════════════════════════════════════════════

export interface FinalResolved {
  mode: FinalMode;
  action: FinalAction;
  sizeMultiplier: number;      // [0..1]
  reason: string;
  riskAdjustment: RiskAdjustment;
}

// ═══════════════════════════════════════════════════════════════
// COMBINED RESOLVED DECISION
// ═══════════════════════════════════════════════════════════════

export interface ResolvedDecision {
  bias: BiasResolved;
  timing: TimingResolved;
  final: FinalResolved;
}

// ═══════════════════════════════════════════════════════════════
// INPUT TYPES
// ═══════════════════════════════════════════════════════════════

export interface HorizonInput {
  horizon: HorizonKey;
  signedEdge?: number;         // [-1..1] if pre-computed
  dir?: SignalDir;
  expectedReturn?: number;     // fraction e.g. 0.107 = +10.7%
  confidence?: number;         // [0..1]
  reliability?: number;        // [0..1]
  phaseRisk?: number;          // [0..1]
  blockers?: string[];
}

export interface HierarchicalResolveInput {
  horizons: Record<HorizonKey, HorizonInput>;
  globalEntropy?: number;      // [0..1]
  mcP95_DD?: number;           // fraction e.g. 0.497
  maxDD_WF?: number;           // fraction
}

// ═══════════════════════════════════════════════════════════════
// REGIME PANEL TYPES
// ═══════════════════════════════════════════════════════════════

export interface RegimeHorizonData {
  key: HorizonKey;
  label: string;
  action: ResolvedDir;
  expectedReturn: number;
  confidence: number;
  reliability: number;
  phase: string;
  entropy: number;
  tailP95DD: number;
}

export interface ResolvedBias {
  bias: ResolvedDir;
  strength: number;
  rule: string;
  explain: string[];
}

export interface RegimeResponse {
  symbol: string;
  tf: string;
  asof: string;
  horizons: RegimeHorizonData[];
  resolvedBias: ResolvedBias;
}
