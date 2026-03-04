/**
 * BLOCK 13 — Alt Context (Integration into Meta-Brain)
 * ======================================================
 * 
 * Alt logic as a secondary layer in Meta-Brain.
 * Market decides WHERE, alts show what's moving.
 */

import type { MarketContext } from '../ml/ml.types.js';
import type { AltSetEntry } from '../alt-sets/alt-sets.types.js';
import { portfolioSimulationService } from '../portfolio/portfolio-simulation.service.js';

// ═══════════════════════════════════════════════════════════════
// ALT CONTEXT TYPES
// ═══════════════════════════════════════════════════════════════

export interface AltContext {
  active: boolean;
  regimeCompatible: boolean;
  strength: number;              // 0..1
  dispersion: number;            // How localized the movement is
  topPatterns: string[];         // Currently active patterns
  candidateCount: number;        // Alts in opportunity phase
  
  // Performance validation
  outperformsControl: boolean;
  controlDelta: number;          // Our returns - baseline
  
  timestamp: number;
}

export interface AltContextSnapshot {
  timestamp: number;
  date: string;
  
  altContext: AltContext;
  marketContext: MarketContext;
  
  // Final decision influence
  influence: {
    applied: boolean;
    confidenceBoost: number;
    reason: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// ALT CONTEXT INVARIANTS
// ═══════════════════════════════════════════════════════════════

export const ALT_CONTEXT_INVARIANTS = {
  // Alt context CANNOT:
  cannotOverrideMarket: true,
  cannotActivateInCrisis: true,
  maxWeightInfluence: 0.20,     // Max 20% influence on final decision
  
  // Activation conditions
  minStrength: 0.3,
  minCandidates: 5,
  requiresOutperformance: true,
} as const;

// ═══════════════════════════════════════════════════════════════
// ALT CONTEXT SERVICE
// ═══════════════════════════════════════════════════════════════

export class AltContextService {
  private snapshots: AltContextSnapshot[] = [];

  /**
   * Build alt context from current state
   */
  buildContext(
    entries: AltSetEntry[],
    marketContext: MarketContext
  ): AltContext {
    // Check regime compatibility
    const regimeCompatible = this.isRegimeCompatible(marketContext);

    // Calculate strength from entries
    const strength = this.calculateStrength(entries);

    // Calculate dispersion (how concentrated the movement is)
    const dispersion = this.calculateDispersion(entries);

    // Get top patterns
    const topPatterns = this.getTopPatterns(entries);

    // Check outperformance
    const metrics = portfolioSimulationService.getMetrics(7);
    const outperformsControl = metrics.avgOutperformance > 0;
    const controlDelta = metrics.avgOutperformance;

    // Determine if active
    const active = 
      regimeCompatible &&
      strength >= ALT_CONTEXT_INVARIANTS.minStrength &&
      entries.length >= ALT_CONTEXT_INVARIANTS.minCandidates &&
      (!ALT_CONTEXT_INVARIANTS.requiresOutperformance || outperformsControl);

    return {
      active,
      regimeCompatible,
      strength,
      dispersion,
      topPatterns,
      candidateCount: entries.length,
      outperformsControl,
      controlDelta,
      timestamp: Date.now(),
    };
  }

  /**
   * Calculate influence on final decision
   */
  calculateInfluence(
    altContext: AltContext,
    baseConfidence: number
  ): { 
    finalConfidence: number; 
    boost: number; 
    applied: boolean; 
    reason: string 
  } {
    if (!altContext.active) {
      return {
        finalConfidence: baseConfidence,
        boost: 0,
        applied: false,
        reason: 'Alt context not active',
      };
    }

    // Calculate boost
    // finalConfidence = baseConfidence × (1 + 0.15 × AltContext.strength)
    const maxBoost = ALT_CONTEXT_INVARIANTS.maxWeightInfluence;
    const boost = Math.min(maxBoost, 0.15 * altContext.strength);
    
    const finalConfidence = Math.min(1, baseConfidence * (1 + boost));

    return {
      finalConfidence,
      boost,
      applied: true,
      reason: `Alt context active: ${altContext.candidateCount} candidates, strength ${(altContext.strength * 100).toFixed(0)}%`,
    };
  }

  /**
   * Save snapshot for logging
   */
  saveSnapshot(
    altContext: AltContext,
    marketContext: MarketContext,
    influence: AltContextSnapshot['influence']
  ): void {
    const snapshot: AltContextSnapshot = {
      timestamp: Date.now(),
      date: new Date().toISOString().split('T')[0],
      altContext,
      marketContext,
      influence,
    };

    this.snapshots.push(snapshot);

    // Keep manageable
    if (this.snapshots.length > 500) {
      this.snapshots = this.snapshots.slice(-300);
    }
  }

  /**
   * Get snapshots history
   */
  getSnapshots(limit: number = 50): AltContextSnapshot[] {
    return this.snapshots.slice(-limit);
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════

  private isRegimeCompatible(context: MarketContext): boolean {
    // Never active in RISK_OFF
    if (context.marketRegime === 'RISK_OFF') return false;
    
    // Reduced in extreme volatility
    if (context.btcVolatility > 0.9) return false;

    return true;
  }

  private calculateStrength(entries: AltSetEntry[]): number {
    if (entries.length === 0) return 0;

    // Average score of entries, normalized
    const avgScore = entries.reduce((sum, e) => sum + e.altScore, 0) / entries.length;
    
    // Scale to 0-1 (assuming scores 0-100)
    return Math.min(1, avgScore / 100);
  }

  private calculateDispersion(entries: AltSetEntry[]): number {
    if (entries.length === 0) return 0;

    // Count unique patterns
    const patterns = new Set(entries.flatMap(e => e.activePatterns));
    
    // More patterns = higher dispersion (less concentrated)
    // Normalize: 1 pattern = low dispersion, 10+ = high
    return Math.min(1, patterns.size / 10);
  }

  private getTopPatterns(entries: AltSetEntry[], limit: number = 3): string[] {
    // Count pattern occurrences
    const counts = new Map<string, number>();
    for (const entry of entries) {
      const pattern = entry.patternLabel;
      counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
    }

    // Sort by count and return top
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([pattern]) => pattern);
  }
}

export const altContextService = new AltContextService();

console.log('[Block13] Alt Context Service loaded');
