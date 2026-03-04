/**
 * BLOCK 24 — Cross-Asset Pattern Propagation Service
 * ====================================================
 * 
 * Finds lagging assets in successful pattern groups.
 */

import type { AltOpportunity, PatternCluster, Venue } from '../types.js';
import type { MarketContext } from '../ml/ml.types.js';
import type {
  PatternPropagation,
  PropagationSignal,
  CAPPResponse,
} from './propagation.types.js';
import {
  CAPP_CONFIG,
  calculateSignalStrength,
  determineUrgency,
} from './propagation.types.js';
import { patternMemoryService } from '../pattern-memory/pattern-memory.service.js';

// ═══════════════════════════════════════════════════════════════
// CROSS-ASSET PATTERN PROPAGATION SERVICE
// ═══════════════════════════════════════════════════════════════

export class PatternPropagationService {
  private recentMoves: Map<string, Array<{
    symbol: string;
    patternId: string;
    returnPct: number;
    timestamp: number;
  }>> = new Map();

  /**
   * Scan for propagation opportunities
   */
  scan(
    opportunities: AltOpportunity[],
    clusters: PatternCluster[],
    marketContext: MarketContext,
    venue: Venue = 'MOCK'
  ): CAPPResponse {
    // Group opportunities by pattern
    const byPattern = this.groupByPattern(opportunities);
    
    // Find propagations
    const propagations: PatternPropagation[] = [];
    const signals: PropagationSignal[] = [];
    
    for (const [patternId, members] of byPattern) {
      const cluster = clusters.find(c => c.clusterId === patternId);
      if (!cluster) continue;
      
      const propagation = this.analyzePropagation(
        patternId,
        cluster.label ?? 'Unknown',
        members,
        venue
      );
      
      if (propagation && propagation.signalStrength > 0.3) {
        propagations.push(propagation);
        
        // Generate signals for candidates
        for (const candidate of propagation.candidateAssets) {
          const opp = members.find(m => m.symbol === candidate.symbol);
          if (!opp) continue;
          
          const signal = this.createSignal(
            candidate.symbol,
            venue,
            propagation,
            opp,
            marketContext
          );
          
          if (signal) {
            signals.push(signal);
          }
        }
      }
    }
    
    // Sort signals by confidence
    signals.sort((a, b) => b.confidence - a.confidence);
    
    // Calculate stats
    const totalLeadingAssets = propagations.reduce(
      (sum, p) => sum + p.originCount, 0
    );
    const totalCandidates = propagations.reduce(
      (sum, p) => sum + p.candidateCount, 0
    );
    const avgDelay = propagations.length > 0
      ? propagations.reduce((sum, p) => sum + p.propagationDelay, 0) / propagations.length
      : 0;
    
    return {
      ok: true,
      asOf: Date.now(),
      venue,
      propagations,
      signals: signals.slice(0, 20),
      activePatternsCount: propagations.length,
      totalLeadingAssets,
      totalCandidates,
      avgPropagationDelay: avgDelay,
    };
  }

  /**
   * Record a significant move for tracking
   */
  recordMove(
    symbol: string,
    patternId: string,
    returnPct: number
  ): void {
    if (Math.abs(returnPct) < CAPP_CONFIG.minOriginReturn) return;
    
    const moves = this.recentMoves.get(patternId) ?? [];
    moves.push({
      symbol,
      patternId,
      returnPct,
      timestamp: Date.now(),
    });
    
    // Keep only recent moves
    const cutoff = Date.now() - CAPP_CONFIG.maxPropagationWindow * 60 * 60 * 1000;
    const filtered = moves.filter(m => m.timestamp > cutoff);
    
    this.recentMoves.set(patternId, filtered);
  }

  /**
   * Analyze propagation for a pattern
   */
  private analyzePropagation(
    patternId: string,
    patternLabel: string,
    members: AltOpportunity[],
    venue: Venue
  ): PatternPropagation | null {
    // Get recent moves for this pattern
    const recentMoves = this.recentMoves.get(patternId) ?? [];
    
    // Also check current momentum as proxy for "moved"
    const movedSymbols = new Set<string>();
    const originAssets: PatternPropagation['originAssets'] = [];
    
    for (const move of recentMoves) {
      if (!movedSymbols.has(move.symbol)) {
        movedSymbols.add(move.symbol);
        originAssets.push({
          symbol: move.symbol,
          returnPct: move.returnPct,
          movedAt: move.timestamp,
        });
      }
    }
    
    // Also consider members with high recent momentum as "moved"
    for (const member of members) {
      const momentum24h = Math.abs(member.vector.momentum_24h);
      if (momentum24h > CAPP_CONFIG.minOriginReturn && !movedSymbols.has(member.symbol)) {
        movedSymbols.add(member.symbol);
        originAssets.push({
          symbol: member.symbol,
          returnPct: member.vector.momentum_24h,
          movedAt: Date.now() - 12 * 60 * 60 * 1000, // Estimate
        });
      }
    }
    
    if (originAssets.length < CAPP_CONFIG.minOriginCount) {
      return null;
    }
    
    // Find candidates (not yet moved)
    const candidateAssets: PatternPropagation['candidateAssets'] = [];
    
    for (const member of members) {
      if (movedSymbols.has(member.symbol)) continue;
      
      // Low recent momentum = not yet moved
      const momentum24h = Math.abs(member.vector.momentum_24h);
      if (momentum24h > CAPP_CONFIG.minOriginReturn) continue;
      
      // Check similarity
      if (member.similarity < CAPP_CONFIG.minSimilarity) continue;
      
      candidateAssets.push({
        symbol: member.symbol,
        similarity: member.similarity,
        expectedMove: this.estimateExpectedMove(originAssets),
        confidence: member.confidence,
      });
    }
    
    if (candidateAssets.length === 0) {
      return null;
    }
    
    // Get pattern performance
    const patternRecord = patternMemoryService.getRecord(patternId);
    const successRate = patternRecord?.hitRate ?? 0.5;
    
    // Calculate avg return and propagation delay
    const avgOriginReturn = originAssets.reduce((sum, a) => sum + a.returnPct, 0) / originAssets.length;
    const propagationDelay = this.estimatePropagationDelay(originAssets);
    
    // Signal strength
    const signalStrength = calculateSignalStrength(
      originAssets.length,
      avgOriginReturn,
      successRate
    );
    
    return {
      patternId,
      patternLabel,
      originAssets,
      candidateAssets,
      avgOriginReturn,
      successRate,
      propagationDelay,
      originCount: originAssets.length,
      candidateCount: candidateAssets.length,
      signalStrength,
    };
  }

  /**
   * Create propagation signal
   */
  private createSignal(
    symbol: string,
    venue: Venue,
    propagation: PatternPropagation,
    opportunity: AltOpportunity,
    marketContext: MarketContext
  ): PropagationSignal | null {
    // Skip if regime is not favorable
    if (marketContext.marketRegime === 'RISK_OFF') {
      return null;
    }
    
    const candidate = propagation.candidateAssets.find(c => c.symbol === symbol);
    if (!candidate) return null;
    
    // Calculate confidence
    const baseConfidence = candidate.confidence;
    const propagationBoost = propagation.signalStrength * 0.2;
    const confidence = Math.min(0.95, baseConfidence + propagationBoost);
    
    // Expected move
    const expectedMove = {
      min: propagation.avgOriginReturn * 0.5,
      max: propagation.avgOriginReturn * 1.2,
    };
    
    // Leading assets (top 3)
    const leadingAssets = propagation.originAssets
      .slice(0, 3)
      .map(a => ({
        symbol: a.symbol,
        returnPct: a.returnPct,
        timeAgo: Date.now() - a.movedAt,
      }));
    
    // Urgency
    const avgTimeAgo = leadingAssets.reduce((sum, a) => sum + a.timeAgo, 0) / leadingAssets.length;
    const urgency = determineUrgency(propagation.propagationDelay, avgTimeAgo);
    
    // Reasons
    const reasons: string[] = [
      `${propagation.originCount} similar assets already moved +${propagation.avgOriginReturn.toFixed(1)}%`,
      `Pattern ${propagation.patternLabel} has ${(propagation.successRate * 100).toFixed(0)}% success rate`,
      `${symbol} showing ${(candidate.similarity * 100).toFixed(0)}% pattern similarity`,
    ];
    
    if (urgency === 'HIGH') {
      reasons.push('Propagation window still open');
    }
    
    return {
      symbol,
      venue,
      patternId: propagation.patternId,
      patternLabel: propagation.patternLabel,
      direction: opportunity.direction,
      expectedMove,
      confidence,
      leadingAssets,
      reasons,
      urgency,
      optimalEntryWindow: propagation.propagationDelay - avgTimeAgo,
      timestamp: Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private groupByPattern(
    opportunities: AltOpportunity[]
  ): Map<string, AltOpportunity[]> {
    const groups = new Map<string, AltOpportunity[]>();
    
    for (const opp of opportunities) {
      const patternId = opp.clusterId ?? 'NO_CLUSTER';
      const group = groups.get(patternId) ?? [];
      group.push(opp);
      groups.set(patternId, group);
    }
    
    return groups;
  }

  private estimateExpectedMove(
    originAssets: PatternPropagation['originAssets']
  ): number {
    const returns = originAssets.map(a => Math.abs(a.returnPct));
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    // Expect slightly less than origin
    return avg * 0.8;
  }

  private estimatePropagationDelay(
    originAssets: PatternPropagation['originAssets']
  ): number {
    if (originAssets.length === 0) return 4 * 60 * 60 * 1000; // Default 4h
    
    const timestamps = originAssets.map(a => a.movedAt);
    const earliest = Math.min(...timestamps);
    const latest = Math.max(...timestamps);
    
    // Delay is time between first and last mover, plus buffer
    return (latest - earliest) + 2 * 60 * 60 * 1000;
  }

  /**
   * Get active propagations
   */
  getActivePropagations(): Map<string, number> {
    const result = new Map<string, number>();
    for (const [patternId, moves] of this.recentMoves) {
      result.set(patternId, moves.length);
    }
    return result;
  }
}

export const patternPropagationService = new PatternPropagationService();

console.log('[Block24] Pattern Propagation Service loaded');
