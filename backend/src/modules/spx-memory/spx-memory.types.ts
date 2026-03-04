/**
 * SPX MEMORY LAYER — Types
 * 
 * BLOCK B6.1 — Snapshot & Outcome Types
 * 
 * Isolated SPX memory (does not touch BTC memory).
 */

// ═══════════════════════════════════════════════════════════════
// CORE ENUMS
// ═══════════════════════════════════════════════════════════════

export type SpxSource = 'LIVE' | 'V1950' | 'V1990' | 'V2008' | 'V2020';
export type SpxPreset = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type SpxHorizon = '7d' | '14d' | '30d' | '90d' | '180d' | '365d';
export type Tier = 'TIMING' | 'TACTICAL' | 'STRUCTURE';

export type Direction = 'BULL' | 'BEAR' | 'NEUTRAL';
export type Action = 'BUY' | 'SELL' | 'HOLD' | 'NO_TRADE';
export type DivergenceGrade = 'A' | 'B' | 'C' | 'D' | 'F' | 'NA';

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT WRITE INPUT
// ═══════════════════════════════════════════════════════════════

export interface SpxSnapshotWriteInput {
  asOfDate: string;             // YYYY-MM-DD
  source: SpxSource;
  preset: SpxPreset;
  horizons: SpxHorizon[];
  policyHash: string;
  engineVersion: string;
  dryRun?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT DOCUMENT
// ═══════════════════════════════════════════════════════════════

export interface SpxSnapshotDoc {
  symbol: 'SPX';
  asOfDate: string;
  source: SpxSource;
  preset: SpxPreset;

  horizon: SpxHorizon;
  tier: Tier;

  direction: Direction;
  action: Action;

  consensusIndex: number;
  conflictLevel: string;
  structuralLock: boolean;

  sizeMultiplier: number;
  confidence: number;

  phaseType?: string;
  phaseGrade?: string;
  divergenceScore?: number;
  divergenceGrade?: DivergenceGrade;

  primaryMatchId?: string;
  matchesCount?: number;

  policyHash: string;
  engineVersion: string;

  createdAt?: Date;
  updatedAt?: Date;
}

// ═══════════════════════════════════════════════════════════════
// OUTCOME DOCUMENT
// ═══════════════════════════════════════════════════════════════

export interface SpxOutcomeDoc {
  snapshotId: string;
  symbol: 'SPX';
  source: SpxSource;
  preset: SpxPreset;

  asOfDate: string;
  horizon: SpxHorizon;

  resolvedDate: string;
  entryClose: number;
  exitClose: number;

  actualReturnPct: number;
  expectedDirection: Direction;
  hit: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

// ═══════════════════════════════════════════════════════════════
// HORIZON DAYS MAPPING
// ═══════════════════════════════════════════════════════════════

export const HORIZON_DAYS: Record<SpxHorizon, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
};

export const HORIZON_TO_TIER: Record<SpxHorizon, Tier> = {
  '7d': 'TIMING',
  '14d': 'TIMING',
  '30d': 'TACTICAL',
  '90d': 'TACTICAL',
  '180d': 'STRUCTURE',
  '365d': 'STRUCTURE',
};
