/**
 * U1.1 - Signal Driver Types
 * 
 * Product-level signal definitions for user-facing UI
 * NO ML terminology - pure business logic
 */

// Signal strength levels
export type SignalStrength = 'LOW' | 'MEDIUM' | 'HIGH';

// Signal states per driver type
export type SignalState =
  // Exchange Pressure (A)
  | 'ACCUMULATION'
  | 'DISTRIBUTION'
  // Zones (B)
  | 'BREAKDOWN'
  // Corridors (C)
  | 'PERSISTENT'
  | 'WEAK'
  // Liquidity (D)
  | 'ADDITION'
  | 'REMOVAL'
  | 'STABLE'
  // Actors (E)
  | 'CONSOLIDATION'
  | 'ACTIVITY'
  // Events (F)
  | 'ALERT'
  | 'QUIET'
  // Generic
  | 'NEUTRAL';

// Decision types
export type SignalDecision = 'BUY' | 'SELL' | 'NEUTRAL';
export type SignalQuality = 'LOW' | 'MEDIUM' | 'HIGH';
export type SignalConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

// Driver codes
export type DriverCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

// Single driver output
export interface SignalDriver {
  key: string;
  state: SignalState;
  strength: SignalStrength;
  summary: string;
}

// Driver metadata (for tooltips/explain)
export interface DriverMeta {
  code: DriverCode;
  key: string;
  title: string;
  description: string;
  tooltip: string;
}

// Full API response
export interface SignalDriversResponse {
  asset: string;
  network: string;
  decision: SignalDecision;
  quality: SignalQuality;
  confidence: SignalConfidence;
  drivers: Record<DriverCode, SignalDriver>;
  timestamp: number;
  version: string;
  /** A2 - Guardrails info (optional, for admin) */
  guardrails?: {
    blocked: boolean;
    blockedBy: string[];
    originalDecision?: SignalDecision;
  };
}

// Driver definitions (constant)
export const DRIVER_META: Record<DriverCode, DriverMeta> = {
  A: {
    code: 'A',
    key: 'exchangePressure',
    title: 'Exchange Pressure',
    description: 'Net asset movement between exchanges and wallets',
    tooltip: 'Measures flow direction to/from centralized exchanges',
  },
  B: {
    code: 'B',
    key: 'zones',
    title: 'Demand & Supply Zones',
    description: 'Price interaction with historically important zones',
    tooltip: 'Tracks repeated buying/selling at key price levels',
  },
  C: {
    code: 'C',
    key: 'corridors',
    title: 'Transaction Corridors',
    description: 'Recurring flow paths between actors',
    tooltip: 'Identifies repeated transaction routes over time',
  },
  D: {
    code: 'D',
    key: 'liquidity',
    title: 'Liquidity Movement',
    description: 'Pool deposits and withdrawals',
    tooltip: 'Monitors liquidity additions and removals',
  },
  E: {
    code: 'E',
    key: 'actors',
    title: 'Wallet Behavior',
    description: 'Behavior of significant wallet clusters',
    tooltip: 'Analyzes activity patterns of key market participants',
  },
  F: {
    code: 'F',
    key: 'events',
    title: 'On-chain Events',
    description: 'Unusual contracts, transfers, or structural changes',
    tooltip: 'Detects abnormal on-chain activity',
  },
};

// State to bullish/bearish mapping
export const STATE_SENTIMENT: Record<SignalState, 'bullish' | 'bearish' | 'neutral'> = {
  ACCUMULATION: 'bullish',
  DISTRIBUTION: 'bearish',
  BREAKDOWN: 'bearish',
  PERSISTENT: 'bullish',
  WEAK: 'neutral',
  ADDITION: 'bullish',
  REMOVAL: 'bearish',
  STABLE: 'neutral',
  CONSOLIDATION: 'bullish',
  ACTIVITY: 'neutral',
  ALERT: 'neutral',
  QUIET: 'neutral',
  NEUTRAL: 'neutral',
};
