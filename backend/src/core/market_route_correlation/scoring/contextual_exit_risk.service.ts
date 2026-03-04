/**
 * Contextual Exit Risk Scoring (P1.6)
 * 
 * Applies deterministic rules to amplify/dampen route risk
 * based on market context. Rules-only, no ML.
 */

import { IMarketSnapshot } from '../storage/route_market_context.model.js';

// ============================================
// Types
// ============================================

export interface RouteRiskInput {
  routeType: 'EXIT' | 'MIGRATION' | 'MIXING' | 'INTERNAL' | string;
  exitProbability: number;      // 0..1
  dumpRiskScore: number;        // 0..100
  pathEntropy: number;          // 0..1
  hasCexTouchpoint: boolean;
  hasSwapBeforeExit: boolean;
}

export interface ContextualRiskOutput {
  baseDumpRiskScore: number;
  contextualDumpRiskScore: number;
  marketAmplifier: number;      // 0.7..1.5
  contextTags: string[];
  confidenceImpact: number;     // -0.2..+0.2
}

// ============================================
// Risk Rules Engine
// ============================================

export class ContextualExitRiskService {
  
  /**
   * Calculate contextual risk from base risk + market snapshot
   */
  calculate(
    routeRisk: RouteRiskInput,
    market: IMarketSnapshot | null
  ): ContextualRiskOutput {
    const tags: string[] = [];
    let amplifier = 1.0;
    let confidenceImpact = 0;
    
    const baseScore = routeRisk.dumpRiskScore;
    
    // If no market data, return unchanged
    if (!market) {
      return {
        baseDumpRiskScore: baseScore,
        contextualDumpRiskScore: baseScore,
        marketAmplifier: 1.0,
        contextTags: ['NO_MARKET_DATA'],
        confidenceImpact: 0
      };
    }
    
    // ========================================
    // RULE 1: Volume Spike Amplifier
    // ========================================
    // IF route.type = EXIT AND volumeDeltaZscore > +2.5
    // THEN risk += 10
    if (routeRisk.routeType === 'EXIT' && market.volumeDeltaZscore > 2.5) {
      amplifier += 0.15;
      tags.push('VOLUME_SPIKE_EXIT');
      confidenceImpact += 0.1;
    }
    
    // ========================================
    // RULE 2: Thin Liquidity Stress
    // ========================================
    // IF liquidityRegime = THIN AND exitProbability > 0.6
    // THEN amplifier = 1.2
    if (market.liquidityRegime === 'THIN' && routeRisk.exitProbability > 0.6) {
      amplifier += 0.2;
      tags.push('THIN_LIQUIDITY_EXIT');
      confidenceImpact += 0.15;
    }
    
    // ========================================
    // RULE 3: High Volatility Dampener
    // ========================================
    // High volatility + low entropy = more predictable, less risky
    // IF volatilityRegime = HIGH AND pathEntropy < 0.3
    // THEN dampen risk (-0.05)
    if (market.volatilityRegime === 'HIGH' && routeRisk.pathEntropy < 0.3) {
      amplifier -= 0.05;
      tags.push('HIGH_VOL_LOW_ENTROPY');
    }
    
    // ========================================
    // RULE 4: Market Stress Flag
    // ========================================
    if (market.isStressed) {
      tags.push('MARKET_STRESS');
      amplifier += 0.1;
      confidenceImpact += 0.05;
    }
    
    // ========================================
    // RULE 5: CEX + Volume Spike
    // ========================================
    if (routeRisk.hasCexTouchpoint && market.volumeDeltaZscore > 2.0) {
      amplifier += 0.1;
      tags.push('CEX_VOLUME_SPIKE');
    }
    
    // ========================================
    // RULE 6: Swap Before Exit in Stress
    // ========================================
    if (routeRisk.hasSwapBeforeExit && market.isStressed) {
      amplifier += 0.1;
      tags.push('SWAP_EXIT_STRESS');
    }
    
    // ========================================
    // RULE 7: Low Quality Data Dampener
    // ========================================
    if (market.dataQuality < 0.5) {
      // Reduce confidence in contextual modifications
      amplifier = 1 + (amplifier - 1) * market.dataQuality;
      confidenceImpact *= market.dataQuality;
      tags.push('LOW_DATA_QUALITY');
    }
    
    // ========================================
    // RULE 8: Stable Market Dampener
    // ========================================
    if (
      market.volatilityRegime === 'LOW' &&
      market.liquidityRegime === 'DEEP' &&
      !market.isStressed
    ) {
      amplifier -= 0.1;
      tags.push('STABLE_MARKET');
      confidenceImpact -= 0.05;
    }
    
    // Clamp amplifier to safe bounds
    amplifier = Math.max(0.7, Math.min(1.5, amplifier));
    confidenceImpact = Math.max(-0.2, Math.min(0.2, confidenceImpact));
    
    // Calculate contextual score
    const contextualScore = Math.round(
      Math.max(0, Math.min(100, baseScore * amplifier))
    );
    
    return {
      baseDumpRiskScore: baseScore,
      contextualDumpRiskScore: contextualScore,
      marketAmplifier: Math.round(amplifier * 100) / 100,
      contextTags: tags,
      confidenceImpact: Math.round(confidenceImpact * 100) / 100
    };
  }
}

// Singleton
export const contextualExitRiskService = new ContextualExitRiskService();
