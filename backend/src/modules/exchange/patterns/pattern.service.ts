/**
 * S10.5 — Pattern Service
 * 
 * Orchestrates pattern detection by aggregating inputs from:
 * - S10.2 Order Flow
 * - S10.3 Regimes
 * - S10.4 Liquidations
 * - Raw market data
 * 
 * Maintains pattern state and history per symbol.
 */

import {
  PatternState,
  PatternDetectionInput,
  ExchangePattern,
  PatternDiagnostics,
  PatternHistoryEntry,
} from './pattern.types.js';
import { detectPatterns, detectPatternsWithDiagnostics } from './pattern.detector.js';
import { PATTERN_LIBRARY } from './pattern.library.js';

// ═══════════════════════════════════════════════════════════════
// STATE STORES
// ═══════════════════════════════════════════════════════════════

// Current pattern state per symbol
const patternStateStore: Map<string, PatternState> = new Map();

// Pattern history (last N entries per symbol)
const patternHistoryStore: Map<string, PatternHistoryEntry[]> = new Map();
const MAX_HISTORY_PER_SYMBOL = 50;

// Last diagnostics (for admin)
const lastDiagnosticsStore: Map<string, PatternDiagnostics> = new Map();

// Track active patterns for history
const activePatternStartTime: Map<string, Map<string, number>> = new Map(); // symbol -> patternId -> startTime

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Update patterns for a symbol using aggregated market state
 */
export function updatePatterns(input: PatternDetectionInput): PatternState {
  const startTime = Date.now();
  const symbol = input.symbol.toUpperCase();
  
  // Detect patterns
  const patterns = detectPatterns(input);
  
  // Count directions
  const bullishCount = patterns.filter(p => p.direction === 'BULLISH').length;
  const bearishCount = patterns.filter(p => p.direction === 'BEARISH').length;
  const neutralCount = patterns.filter(p => p.direction === 'NEUTRAL').length;
  
  // Build state
  const state: PatternState = {
    symbol,
    patterns,
    hasConflict: bullishCount > 0 && bearishCount > 0,
    bullishCount,
    bearishCount,
    neutralCount,
    lastUpdated: startTime,
    detectionDurationMs: Date.now() - startTime,
  };
  
  // Update history
  updatePatternHistory(symbol, patterns);
  
  // Store state
  patternStateStore.set(symbol, state);
  
  return state;
}

/**
 * Update patterns with full diagnostics (for admin)
 */
export function updatePatternsWithDiagnostics(input: PatternDetectionInput): PatternDiagnostics {
  const symbol = input.symbol.toUpperCase();
  const diagnostics = detectPatternsWithDiagnostics(input);
  
  // Also update regular state
  const patterns = diagnostics.detectedPatterns;
  const bullishCount = patterns.filter(p => p.direction === 'BULLISH').length;
  const bearishCount = patterns.filter(p => p.direction === 'BEARISH').length;
  const neutralCount = patterns.filter(p => p.direction === 'NEUTRAL').length;
  
  const state: PatternState = {
    symbol,
    patterns,
    hasConflict: bullishCount > 0 && bearishCount > 0,
    bullishCount,
    bearishCount,
    neutralCount,
    lastUpdated: diagnostics.evaluatedAt,
    detectionDurationMs: diagnostics.durationMs,
  };
  
  patternStateStore.set(symbol, state);
  lastDiagnosticsStore.set(symbol, diagnostics);
  updatePatternHistory(symbol, patterns);
  
  return diagnostics;
}

/**
 * Get current pattern state for symbol
 */
export function getPatternState(symbol: string): PatternState {
  const upperSymbol = symbol.toUpperCase();
  return patternStateStore.get(upperSymbol) || {
    symbol: upperSymbol,
    patterns: [],
    hasConflict: false,
    bullishCount: 0,
    bearishCount: 0,
    neutralCount: 0,
    lastUpdated: Date.now(),
    detectionDurationMs: 0,
  };
}

/**
 * Get all symbols with active patterns
 */
export function getAllPatternStates(): PatternState[] {
  return Array.from(patternStateStore.values());
}

/**
 * Get active patterns across all symbols
 */
export function getActivePatterns(): ExchangePattern[] {
  const all: ExchangePattern[] = [];
  for (const state of patternStateStore.values()) {
    all.push(...state.patterns);
  }
  return all;
}

/**
 * Get pattern history for symbol
 */
export function getPatternHistory(symbol: string, limit: number = 20): PatternHistoryEntry[] {
  const history = patternHistoryStore.get(symbol.toUpperCase()) || [];
  return history.slice(-limit);
}

/**
 * Get last diagnostics for symbol
 */
export function getPatternDiagnostics(symbol: string): PatternDiagnostics | null {
  return lastDiagnosticsStore.get(symbol.toUpperCase()) || null;
}

/**
 * Get library stats
 */
export function getLibraryStats() {
  const byCategory: Record<string, number> = {};
  for (const pattern of PATTERN_LIBRARY) {
    byCategory[pattern.category] = (byCategory[pattern.category] || 0) + 1;
  }
  
  return {
    totalPatterns: PATTERN_LIBRARY.length,
    byCategory,
    patterns: PATTERN_LIBRARY.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
    })),
  };
}

/**
 * Clear all pattern state
 */
export function clearPatternState(): void {
  patternStateStore.clear();
  patternHistoryStore.clear();
  lastDiagnosticsStore.clear();
  activePatternStartTime.clear();
  console.log('[S10.5] Pattern state cleared');
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL: History Management
// ═══════════════════════════════════════════════════════════════

function updatePatternHistory(symbol: string, currentPatterns: ExchangePattern[]): void {
  const now = Date.now();
  
  // Get or initialize stores
  if (!activePatternStartTime.has(symbol)) {
    activePatternStartTime.set(symbol, new Map());
  }
  const activeStarts = activePatternStartTime.get(symbol)!;
  
  if (!patternHistoryStore.has(symbol)) {
    patternHistoryStore.set(symbol, []);
  }
  const history = patternHistoryStore.get(symbol)!;
  
  // Current pattern IDs
  const currentPatternIds = new Set(currentPatterns.map(p => p.patternId));
  
  // Check for patterns that ended
  for (const [patternId, startTime] of activeStarts.entries()) {
    if (!currentPatternIds.has(patternId)) {
      // Pattern ended
      const def = PATTERN_LIBRARY.find(p => p.id === patternId);
      if (def) {
        history.push({
          symbol,
          patternId,
          name: def.name,
          category: def.category,
          direction: currentPatterns.find(p => p.patternId === patternId)?.direction || 'NEUTRAL',
          startedAt: startTime,
          endedAt: now,
          durationSec: Math.round((now - startTime) / 1000),
          peakConfidence: 0, // Could track this
        });
      }
      activeStarts.delete(patternId);
    }
  }
  
  // Check for new patterns
  for (const pattern of currentPatterns) {
    if (!activeStarts.has(pattern.patternId)) {
      activeStarts.set(pattern.patternId, now);
    }
  }
  
  // Trim history
  while (history.length > MAX_HISTORY_PER_SYMBOL) {
    history.shift();
  }
}

// ═══════════════════════════════════════════════════════════════
// MOCK DATA GENERATOR (for demo/testing)
// ═══════════════════════════════════════════════════════════════

export function generateMockPatternInput(symbol: string): PatternDetectionInput {
  const rand = () => Math.random();
  const randChoice = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  
  return {
    symbol,
    
    orderFlow: {
      aggressor: randChoice(['BUYER', 'SELLER', 'BALANCED']),
      dominance: 0.4 + rand() * 0.4,
      intensity: randChoice(['LOW', 'MEDIUM', 'HIGH', 'EXTREME']),
      buyVolume: 100000 + rand() * 500000,
      sellVolume: 100000 + rand() * 500000,
    },
    
    absorption: {
      detected: rand() > 0.5,
      side: randChoice(['BID', 'ASK', null]),
      strength: rand() * 0.8,
      priceHolding: rand() > 0.4,
    },
    
    pressure: {
      imbalance: (rand() - 0.5) * 2,
      bidPressure: rand(),
      askPressure: rand(),
    },
    
    regime: {
      type: randChoice(['ACCUMULATION', 'DISTRIBUTION', 'EXPANSION', 'EXHAUSTION', 'NEUTRAL', 'LONG_SQUEEZE', 'SHORT_SQUEEZE']),
      confidence: 0.4 + rand() * 0.5,
      volumeDelta: (rand() - 0.3) * 30,
      oiDelta: (rand() - 0.3) * 15,
      priceDelta: (rand() - 0.5) * 5,
    },
    
    liquidation: {
      active: rand() > 0.7,
      direction: rand() > 0.5 ? 'LONG' : 'SHORT',
      phase: randChoice(['START', 'ACTIVE', 'PEAK', 'DECAY', 'END', null]),
      intensity: randChoice(['LOW', 'MEDIUM', 'HIGH', 'EXTREME']),
      volumeUsd: rand() * 500000,
    },
    
    volume: {
      current: 1000000 + rand() * 5000000,
      average: 2000000,
      ratio: 0.3 + rand() * 2.5,
    },
    
    oi: {
      current: 50000000 + rand() * 100000000,
      delta: (rand() - 0.4) * 10000000,
      deltaPct: (rand() - 0.4) * 15,
    },
    
    price: {
      current: 90000 + rand() * 20000,
      delta: (rand() - 0.5) * 2000,
      deltaPct: (rand() - 0.5) * 3,
    },
  };
}

console.log('[S10.5] Pattern Service initialized');
