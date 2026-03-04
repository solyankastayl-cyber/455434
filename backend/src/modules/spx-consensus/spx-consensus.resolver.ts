/**
 * SPX CONSENSUS ENGINE — Decision Resolver
 * 
 * BLOCK B5.5 — Final action/mode/size determination
 * 
 * Rules:
 * - Structural lock: STRUCTURE direction controls
 * - HIGH/CRITICAL conflict: HOLD + size cut
 * - Mode: TREND_FOLLOW if timing agrees with structure
 */

import type { 
  HorizonVote, 
  Direction, 
  ConflictResult, 
  ResolvedDecision,
  Action,
  Mode
} from './spx-consensus.types.js';

// ═══════════════════════════════════════════════════════════════
// RESOLVER INPUT
// ═══════════════════════════════════════════════════════════════

export interface ResolverInput {
  direction: Direction;
  votes: HorizonVote[];
  conflict: ConflictResult;
  consensusIndex: number;
  preset?: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  phaseNow?: {
    phase: string;
    flags: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN RESOLVER
// ═══════════════════════════════════════════════════════════════

export function resolveDecision(input: ResolverInput): ResolvedDecision {
  const { direction, votes, conflict, consensusIndex, preset = 'BALANCED', phaseNow } = input;
  
  const reasons: string[] = [];
  const penalties: string[] = [];
  
  let action: Action = 'HOLD';
  let mode: Mode = 'NO_TRADE';
  let sizeMultiplier = 1.0;
  
  const structDir = conflict.tierDirections.STRUCTURE;
  const timingDir = conflict.tierDirections.TIMING;
  
  // ═══════════════════════════════════════════════════════════════
  // ACTION DETERMINATION
  // ═══════════════════════════════════════════════════════════════
  
  // Rule: If structural lock, STRUCTURE direction controls
  if (conflict.structuralLock) {
    reasons.push('Structural lock active');
    
    if (structDir === 'BULL' || structDir === 'NEUTRAL') {
      // Cannot SELL when structure is bullish
      if (direction === 'BULL') {
        action = 'BUY';
        reasons.push('BUY: Structure bullish, consensus bullish');
      } else if (direction === 'BEAR') {
        action = 'HOLD';
        reasons.push('HOLD: Structure bullish, consensus bearish (lock prevents SELL)');
        penalties.push('Direction mismatch with structure');
      } else {
        action = 'HOLD';
        reasons.push('HOLD: Neutral consensus');
      }
    } else if (structDir === 'BEAR') {
      // Cannot BUY when structure is bearish
      if (direction === 'BEAR') {
        action = 'SELL';
        reasons.push('SELL: Structure bearish, consensus bearish');
      } else if (direction === 'BULL') {
        action = 'HOLD';
        reasons.push('HOLD: Structure bearish, consensus bullish (lock prevents BUY)');
        penalties.push('Direction mismatch with structure');
      } else {
        action = 'HOLD';
        reasons.push('HOLD: Neutral consensus');
      }
    } else {
      // Structure is SPLIT
      action = 'HOLD';
      reasons.push('HOLD: Structure tier split');
      penalties.push('Structure tier internal conflict');
    }
  } else {
    // No structural lock — follow consensus
    if (direction === 'BULL' && consensusIndex > 40) {
      action = 'BUY';
      reasons.push('BUY: Bullish consensus without lock');
    } else if (direction === 'BEAR' && consensusIndex > 40) {
      action = 'SELL';
      reasons.push('SELL: Bearish consensus without lock');
    } else {
      action = 'HOLD';
      reasons.push('HOLD: Weak or neutral consensus');
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CONFLICT PENALTY
  // ═══════════════════════════════════════════════════════════════
  
  if (conflict.level === 'CRITICAL') {
    action = 'HOLD';
    sizeMultiplier *= 0.3;
    penalties.push('CRITICAL conflict: 70% size cut');
    reasons.push('HOLD forced: Critical tier conflict');
  } else if (conflict.level === 'HIGH') {
    sizeMultiplier *= 0.5;
    penalties.push('HIGH conflict: 50% size cut');
  } else if (conflict.level === 'MODERATE') {
    sizeMultiplier *= 0.75;
    penalties.push('MODERATE conflict: 25% size cut');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MODE DETERMINATION
  // ═══════════════════════════════════════════════════════════════
  
  if (action === 'HOLD' || action === 'NO_TRADE') {
    mode = 'NO_TRADE';
  } else if (timingDir === structDir || timingDir === 'NEUTRAL') {
    mode = 'TREND_FOLLOW';
    reasons.push('TREND_FOLLOW: Timing aligned with structure');
  } else {
    mode = 'COUNTER_TREND';
    reasons.push('COUNTER_TREND: Timing against structure');
    sizeMultiplier *= 0.85;
    penalties.push('Counter-trend: 15% size penalty');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CONSENSUS STRENGTH MODIFIER
  // ═══════════════════════════════════════════════════════════════
  
  const consensusStrength = consensusIndex / 100;
  sizeMultiplier *= 0.5 + consensusStrength * 0.5; // Range: 0.5-1.0 based on consensus
  
  // ═══════════════════════════════════════════════════════════════
  // PHASE MODIFIER
  // ═══════════════════════════════════════════════════════════════
  
  if (phaseNow) {
    // VOL_SHOCK flag: reduce size
    if (phaseNow.flags?.includes('VOL_SHOCK')) {
      sizeMultiplier *= 0.7;
      penalties.push('VOL_SHOCK: 30% size cut');
    }
    
    // BEAR_DRAWDOWN phase: be cautious with longs
    if (phaseNow.phase === 'BEAR_DRAWDOWN' && action === 'BUY') {
      sizeMultiplier *= 0.8;
      penalties.push('BEAR_DRAWDOWN phase: 20% size cut on longs');
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PRESET MODIFIER
  // ═══════════════════════════════════════════════════════════════
  
  switch (preset) {
    case 'CONSERVATIVE':
      sizeMultiplier *= 0.7;
      break;
    case 'AGGRESSIVE':
      sizeMultiplier *= 1.25;
      break;
    // BALANCED: no change
  }
  
  // Clamp size
  sizeMultiplier = Math.max(0, Math.min(1.25, sizeMultiplier));
  sizeMultiplier = Math.round(sizeMultiplier * 100) / 100;
  
  return {
    action,
    mode,
    sizeMultiplier,
    reasons,
    penalties,
  };
}

export default resolveDecision;
