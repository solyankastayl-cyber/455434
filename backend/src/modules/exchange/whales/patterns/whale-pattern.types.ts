/**
 * S10.W Step 5 — Whale Pattern Types
 * 
 * Patterns = structures of traps and forced liquidations.
 * NOT signals, NOT direction predictions.
 * 
 * LOCKED — Do not modify without explicit approval
 */

// ═══════════════════════════════════════════════════════════════
// PATTERN IDs (CANONICAL)
// ═══════════════════════════════════════════════════════════════

export const WHALE_PATTERN_IDS = {
  WHALE_TRAP_RISK: 'WHALE_TRAP_RISK',
  FORCED_SQUEEZE_RISK: 'FORCED_SQUEEZE_RISK',
  BAIT_AND_FLIP: 'BAIT_AND_FLIP',
} as const;

export type WhalePatternId = keyof typeof WHALE_PATTERN_IDS;

// ═══════════════════════════════════════════════════════════════
// PATTERN DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export interface WhalePatternDefinition {
  id: WhalePatternId;
  name: string;
  description: string;
  
  /** Required indicators for this pattern */
  requiredIndicators: string[];
  
  /** Risk interpretation */
  riskInterpretation: {
    low: string;
    medium: string;
    high: string;
  };
}

export const WHALE_PATTERN_DEFINITIONS: Record<WhalePatternId, WhalePatternDefinition> = {
  WHALE_TRAP_RISK: {
    id: 'WHALE_TRAP_RISK',
    name: 'Whale Trap Risk',
    description: 'Large player is open, market shows signs of going against them',
    requiredIndicators: [
      'large_position_presence',
      'position_crowding_against_whales',
      'stop_hunt_probability',
      'contrarian_pressure_index',
    ],
    riskInterpretation: {
      low: 'Whales are relatively safe',
      medium: 'Some pressure on whale positions',
      high: 'High risk of whale liquidation',
    },
  },
  
  FORCED_SQUEEZE_RISK: {
    id: 'FORCED_SQUEEZE_RISK',
    name: 'Forced Squeeze Risk',
    description: 'Market is overloaded with positions, any move triggers cascade',
    requiredIndicators: [
      'position_crowding_against_whales',
      'stop_hunt_probability',
      'large_position_survival_time',
    ],
    riskInterpretation: {
      low: 'Low squeeze pressure',
      medium: 'Building squeeze conditions',
      high: 'Squeeze conditions critical',
    },
  },
  
  BAIT_AND_FLIP: {
    id: 'BAIT_AND_FLIP',
    name: 'Bait and Flip',
    description: 'Whale opened → market went against → whale flipped/closed → move accelerated',
    requiredIndicators: [
      'whale_side_bias',
      'contrarian_pressure_index',
      'large_position_survival_time',
    ],
    riskInterpretation: {
      low: 'No flip detected',
      medium: 'Potential flip setup',
      high: 'Flip detected or imminent',
    },
  },
};

// ═══════════════════════════════════════════════════════════════
// PATTERN RESULT
// ═══════════════════════════════════════════════════════════════

export interface WhalePatternResult {
  /** Pattern ID */
  patternId: WhalePatternId;
  
  /** Pattern name */
  name: string;
  
  /** Is pattern currently active? */
  active: boolean;
  
  /** Risk score 0..1 */
  riskScore: number;
  
  /** Risk level */
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  
  /** Dominant whale side (for context) */
  dominantWhaleSide: 'LONG' | 'SHORT' | 'BALANCED';
  
  /** Squeeze side (for FORCED_SQUEEZE_RISK) */
  squeezeSide?: 'LONG_SQUEEZE' | 'SHORT_SQUEEZE' | null;
  
  /** Flip detected (for BAIT_AND_FLIP) */
  flipDetected?: boolean;
  
  /** Reasons why pattern is active/high-risk */
  reasons: string[];
  
  /** Indicator values used */
  indicatorValues: Record<string, number>;
  
  /** Stability (consecutive ticks pattern was active) */
  stabilityTicks: number;
  
  /** Timestamp */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// PATTERN SNAPSHOT (all 3 patterns for a symbol)
// ═══════════════════════════════════════════════════════════════

export interface WhalePatternSnapshot {
  symbol: string;
  timestamp: number;
  
  /** All 3 pattern results */
  patterns: WhalePatternResult[];
  
  /** Highest risk pattern */
  highestRisk: {
    patternId: WhalePatternId;
    riskScore: number;
  } | null;
  
  /** Overall whale risk level */
  overallRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  
  /** Is any pattern in HIGH state? */
  hasHighRisk: boolean;
  
  /** Active patterns count */
  activeCount: number;
}

// ═══════════════════════════════════════════════════════════════
// PATTERN HISTORY (for LABS)
// ═══════════════════════════════════════════════════════════════

export interface WhalePatternHistoryEntry {
  id: string;
  symbol: string;
  timestamp: number;
  patternId: WhalePatternId;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  active: boolean;
  dominantWhaleSide: 'LONG' | 'SHORT' | 'BALANCED';
  stabilityTicks: number;
}

export interface WhalePatternHistoryQuery {
  symbol?: string;
  patternId?: WhalePatternId;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  startTime?: number;
  endTime?: number;
  limit?: number;
}

console.log('[S10.W] Whale Pattern Types loaded');
