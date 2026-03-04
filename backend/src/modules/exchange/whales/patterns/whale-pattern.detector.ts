/**
 * S10.W Step 5 — Whale Pattern Detector
 * 
 * Detects 3 whale patterns:
 * 1. WHALE_TRAP_RISK — large player at risk of liquidation
 * 2. FORCED_SQUEEZE_RISK — market overloaded, cascade imminent
 * 3. BAIT_AND_FLIP — whale flip detected
 * 
 * NO SIGNALS, NO PREDICTIONS — only risk measurements.
 */

import {
  WhalePatternId,
  WhalePatternResult,
  WhalePatternSnapshot,
  WHALE_PATTERN_DEFINITIONS,
} from './whale-pattern.types.js';
import { WhaleIndicators, WhaleMarketState } from '../whale.types.js';
import { getCachedWhaleIndicators, getCachedWhaleState } from '../../indicators/calculators/whale.calculators.js';

// ═══════════════════════════════════════════════════════════════
// STABILITY TRACKING
// ═══════════════════════════════════════════════════════════════

// Track how many consecutive ticks each pattern has been active
const stabilityCounters: Map<string, Map<WhalePatternId, number>> = new Map();

// Minimum ticks for pattern to be considered "stable"
const STABILITY_THRESHOLD = 2;

function getStabilityKey(symbol: string, patternId: WhalePatternId): string {
  return `${symbol}:${patternId}`;
}

function updateStability(symbol: string, patternId: WhalePatternId, active: boolean): number {
  if (!stabilityCounters.has(symbol)) {
    stabilityCounters.set(symbol, new Map());
  }
  
  const symbolCounters = stabilityCounters.get(symbol)!;
  const current = symbolCounters.get(patternId) ?? 0;
  
  if (active) {
    const newCount = current + 1;
    symbolCounters.set(patternId, newCount);
    return newCount;
  } else {
    symbolCounters.set(patternId, 0);
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════
// RISK LEVEL HELPERS
// ═══════════════════════════════════════════════════════════════

function getRiskLevel(riskScore: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (riskScore >= 0.7) return 'HIGH';
  if (riskScore >= 0.4) return 'MEDIUM';
  return 'LOW';
}

function getDominantSide(whaleSideBias: number): 'LONG' | 'SHORT' | 'BALANCED' {
  if (whaleSideBias > 0.2) return 'LONG';
  if (whaleSideBias < -0.2) return 'SHORT';
  return 'BALANCED';
}

// ═══════════════════════════════════════════════════════════════
// PATTERN DETECTORS
// ═══════════════════════════════════════════════════════════════

/**
 * Detect WHALE_TRAP_RISK pattern.
 * 
 * Conditions:
 * - large_position_presence > 0.5
 * - position_crowding_against_whales > 0.3
 * - stop_hunt_probability > 0.3
 * - contrarian_pressure_index > 0.3
 */
function detectWhaleTrapRisk(
  symbol: string,
  indicators: WhaleIndicators
): WhalePatternResult {
  const reasons: string[] = [];
  let riskScore = 0;
  
  const lpp = indicators.large_position_presence;
  const pcaw = Math.abs(indicators.position_crowding_against_whales);
  const shpi = indicators.stop_hunt_probability;
  const cpi = indicators.contrarian_pressure_index;
  
  // Weight factors for risk score
  // CPI is the most important (synthesis indicator)
  riskScore = (
    0.15 * lpp +
    0.25 * pcaw +
    0.25 * shpi +
    0.35 * cpi
  );
  
  // Generate reasons
  if (lpp > 0.5) reasons.push(`Large positions present (${(lpp * 100).toFixed(0)}%)`);
  if (pcaw > 0.3) reasons.push(`Crowd positioning against whales (${(pcaw * 100).toFixed(0)}%)`);
  if (shpi > 0.3) reasons.push(`Stop-hunt probability elevated (${(shpi * 100).toFixed(0)}%)`);
  if (cpi > 0.5) reasons.push(`Contrarian pressure high (${(cpi * 100).toFixed(0)}%)`);
  
  const active = riskScore >= 0.4 && reasons.length >= 2;
  const stabilityTicks = updateStability(symbol, 'WHALE_TRAP_RISK', active);
  
  return {
    patternId: 'WHALE_TRAP_RISK',
    name: WHALE_PATTERN_DEFINITIONS.WHALE_TRAP_RISK.name,
    active: active && stabilityTicks >= STABILITY_THRESHOLD,
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    dominantWhaleSide: getDominantSide(indicators.whale_side_bias),
    reasons,
    indicatorValues: {
      large_position_presence: lpp,
      position_crowding_against_whales: indicators.position_crowding_against_whales,
      stop_hunt_probability: shpi,
      contrarian_pressure_index: cpi,
    },
    stabilityTicks,
    timestamp: Date.now(),
  };
}

/**
 * Detect FORCED_SQUEEZE_RISK pattern.
 * 
 * Conditions:
 * - position_crowding_against_whales high (either direction)
 * - stop_hunt_probability > 0.4
 * - large_position_survival_time < 0 (positions unstable)
 */
function detectForcedSqueezeRisk(
  symbol: string,
  indicators: WhaleIndicators
): WhalePatternResult {
  const reasons: string[] = [];
  let riskScore = 0;
  
  const pcaw = indicators.position_crowding_against_whales;
  const shpi = indicators.stop_hunt_probability;
  const lpst = indicators.large_position_survival_time;
  const whaleBias = indicators.whale_side_bias;
  
  // Survival time inverted (lower = higher risk)
  const survivalRisk = (1 - (lpst + 1) / 2); // Convert -1..1 to 0..1 (inverted)
  
  // Risk score
  riskScore = (
    0.30 * Math.abs(pcaw) +
    0.35 * shpi +
    0.35 * survivalRisk
  );
  
  // Determine squeeze side
  let squeezeSide: 'LONG_SQUEEZE' | 'SHORT_SQUEEZE' | null = null;
  if (riskScore >= 0.4) {
    // Squeeze against the dominant side
    if (whaleBias > 0.2) {
      squeezeSide = 'LONG_SQUEEZE';
    } else if (whaleBias < -0.2) {
      squeezeSide = 'SHORT_SQUEEZE';
    }
  }
  
  // Generate reasons
  if (Math.abs(pcaw) > 0.3) {
    reasons.push(`Position crowding ${pcaw > 0 ? 'against' : 'with'} whales (${(Math.abs(pcaw) * 100).toFixed(0)}%)`);
  }
  if (shpi > 0.4) reasons.push(`Stop-hunt probability high (${(shpi * 100).toFixed(0)}%)`);
  if (lpst < -0.2) reasons.push(`Positions unstable (survival time low)`);
  if (squeezeSide) reasons.push(`${squeezeSide.replace('_', ' ')} conditions forming`);
  
  const active = riskScore >= 0.4 && reasons.length >= 2;
  const stabilityTicks = updateStability(symbol, 'FORCED_SQUEEZE_RISK', active);
  
  return {
    patternId: 'FORCED_SQUEEZE_RISK',
    name: WHALE_PATTERN_DEFINITIONS.FORCED_SQUEEZE_RISK.name,
    active: active && stabilityTicks >= STABILITY_THRESHOLD,
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    dominantWhaleSide: getDominantSide(whaleBias),
    squeezeSide,
    reasons,
    indicatorValues: {
      position_crowding_against_whales: pcaw,
      stop_hunt_probability: shpi,
      large_position_survival_time: lpst,
      survival_risk: survivalRisk,
    },
    stabilityTicks,
    timestamp: Date.now(),
  };
}

/**
 * Detect BAIT_AND_FLIP pattern.
 * 
 * Conditions:
 * - whale_side_bias changed sign (flip)
 * - contrarian_pressure_index was high before flip
 * - survival_time was short
 */
// Track previous whale bias for flip detection
const previousBias: Map<string, number> = new Map();

function detectBaitAndFlip(
  symbol: string,
  indicators: WhaleIndicators
): WhalePatternResult {
  const reasons: string[] = [];
  let riskScore = 0;
  
  const currentBias = indicators.whale_side_bias;
  const cpi = indicators.contrarian_pressure_index;
  const lpst = indicators.large_position_survival_time;
  
  // Check for flip
  const prevBias = previousBias.get(symbol) ?? currentBias;
  const flipOccurred = (prevBias > 0.2 && currentBias < -0.2) || 
                       (prevBias < -0.2 && currentBias > 0.2);
  const flipSetup = Math.abs(currentBias) > 0.5 && cpi > 0.5;
  
  // Update previous bias
  previousBias.set(symbol, currentBias);
  
  // Risk score based on flip conditions
  if (flipOccurred) {
    riskScore = 0.8 + 0.2 * cpi; // High score if flip occurred
    reasons.push('Whale side flip detected');
  } else if (flipSetup) {
    riskScore = 0.3 + 0.4 * cpi + 0.3 * (1 - (lpst + 1) / 2);
    reasons.push('Flip setup conditions present');
  } else {
    riskScore = 0.2 * cpi;
  }
  
  // Additional reasons
  if (cpi > 0.5) reasons.push(`High contrarian pressure (${(cpi * 100).toFixed(0)}%)`);
  if (lpst < -0.3) reasons.push('Short position survival time');
  if (Math.abs(currentBias) > 0.7) {
    reasons.push(`Strong whale bias ${currentBias > 0 ? 'LONG' : 'SHORT'}`);
  }
  
  const active = (flipOccurred || flipSetup) && riskScore >= 0.4;
  const stabilityTicks = updateStability(symbol, 'BAIT_AND_FLIP', active);
  
  return {
    patternId: 'BAIT_AND_FLIP',
    name: WHALE_PATTERN_DEFINITIONS.BAIT_AND_FLIP.name,
    active: active && stabilityTicks >= STABILITY_THRESHOLD,
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    dominantWhaleSide: getDominantSide(currentBias),
    flipDetected: flipOccurred,
    reasons,
    indicatorValues: {
      whale_side_bias: currentBias,
      previous_bias: prevBias,
      contrarian_pressure_index: cpi,
      large_position_survival_time: lpst,
    },
    stabilityTicks,
    timestamp: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN DETECTOR
// ═══════════════════════════════════════════════════════════════

/**
 * Detect all whale patterns for a symbol.
 */
export function detectWhalePatterns(symbol: string): WhalePatternSnapshot {
  const now = Date.now();
  
  // Get cached indicators
  const indicators = getCachedWhaleIndicators(symbol);
  
  // If no indicators, return empty snapshot
  if (!indicators) {
    return {
      symbol,
      timestamp: now,
      patterns: [],
      highestRisk: null,
      overallRiskLevel: 'LOW',
      hasHighRisk: false,
      activeCount: 0,
    };
  }
  
  // Detect all 3 patterns
  const patterns: WhalePatternResult[] = [
    detectWhaleTrapRisk(symbol, indicators),
    detectForcedSqueezeRisk(symbol, indicators),
    detectBaitAndFlip(symbol, indicators),
  ];
  
  // Find highest risk
  const activePatterns = patterns.filter(p => p.active);
  let highestRisk: { patternId: WhalePatternId; riskScore: number } | null = null;
  
  if (activePatterns.length > 0) {
    const highest = activePatterns.reduce((a, b) => 
      a.riskScore > b.riskScore ? a : b
    );
    highestRisk = {
      patternId: highest.patternId,
      riskScore: highest.riskScore,
    };
  }
  
  // Calculate overall risk level
  const maxRiskScore = Math.max(...patterns.map(p => p.riskScore));
  const overallRiskLevel = getRiskLevel(maxRiskScore);
  const hasHighRisk = patterns.some(p => p.riskLevel === 'HIGH' && p.active);
  
  return {
    symbol,
    timestamp: now,
    patterns,
    highestRisk,
    overallRiskLevel,
    hasHighRisk,
    activeCount: activePatterns.length,
  };
}

/**
 * Detect patterns with custom indicators (for testing/replay).
 */
export function detectWhalePatternsWithIndicators(
  symbol: string,
  indicators: WhaleIndicators
): WhalePatternSnapshot {
  const now = Date.now();
  
  const patterns: WhalePatternResult[] = [
    detectWhaleTrapRisk(symbol, indicators),
    detectForcedSqueezeRisk(symbol, indicators),
    detectBaitAndFlip(symbol, indicators),
  ];
  
  const activePatterns = patterns.filter(p => p.active);
  let highestRisk: { patternId: WhalePatternId; riskScore: number } | null = null;
  
  if (activePatterns.length > 0) {
    const highest = activePatterns.reduce((a, b) => 
      a.riskScore > b.riskScore ? a : b
    );
    highestRisk = {
      patternId: highest.patternId,
      riskScore: highest.riskScore,
    };
  }
  
  const maxRiskScore = Math.max(...patterns.map(p => p.riskScore));
  const overallRiskLevel = getRiskLevel(maxRiskScore);
  const hasHighRisk = patterns.some(p => p.riskLevel === 'HIGH' && p.active);
  
  return {
    symbol,
    timestamp: now,
    patterns,
    highestRisk,
    overallRiskLevel,
    hasHighRisk,
    activeCount: activePatterns.length,
  };
}

console.log('[S10.W] Whale Pattern Detector loaded');
