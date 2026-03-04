/**
 * BLOCK 2.3 — Cluster Context Service
 * =====================================
 * Combines macro + funding context for cluster decisions.
 */

import type { ClusterContext, MacroRegime, FundingRegime, ClusterType, MACRO_CLUSTER_MATRIX } from './macro.types.js';
import { macroStateService } from './macro.state.service.js';
import { fundingOverlayService } from './funding.overlay.service.js';

export class ClusterContextService {
  /**
   * Build context for a cluster
   */
  async buildContext(clusterId: string, clusterType?: ClusterType): Promise<ClusterContext> {
    const ts = Date.now();

    // Get current macro state
    const macroState = macroStateService.getCurrent();
    const macroRegime = macroState?.regime ?? 'TRANSITION';
    const macroConfidence = macroState?.confidence ?? 0.5;

    // Get current funding state
    const fundingState = fundingOverlayService.getMarketState();
    const fundingRegime = fundingState?.regime ?? 'NEUTRAL';
    const fundingConfidence = fundingState?.confidence ?? 0.5;
    const avgFunding = fundingState?.avgFunding ?? 0;

    // Calculate combined modifier
    const macroModifier = this.getMacroModifier(macroRegime, clusterType);
    const fundingModifier = fundingOverlayService.getFundingModifier(fundingRegime);
    const contextModifier = macroModifier * fundingModifier;

    // Determine if allowed
    const { isAllowed, penaltyReason } = this.checkAllowed(
      macroRegime,
      fundingRegime,
      clusterType
    );

    return {
      clusterId,
      ts,
      macroRegime,
      macroConfidence,
      fundingRegime,
      fundingConfidence,
      avgFunding,
      contextModifier,
      isAllowed,
      penaltyReason,
    };
  }

  /**
   * Get macro modifier for cluster type
   */
  private getMacroModifier(regime: MacroRegime, clusterType?: ClusterType): number {
    if (!clusterType) return 1.0;

    const matrix: Record<MacroRegime, Record<ClusterType, number>> = {
      BTC_DOMINANT: {
        MOMENTUM: 0.4,
        MEAN_REVERSION: 0.7,
        BREAKOUT: 0.3,
        SQUEEZE: 0.5,
        CONSOLIDATION: 0.8,
      },
      ETH_ROTATION: {
        MOMENTUM: 0.8,
        MEAN_REVERSION: 0.6,
        BREAKOUT: 0.7,
        SQUEEZE: 0.6,
        CONSOLIDATION: 0.5,
      },
      ALTSEASON: {
        MOMENTUM: 1.0,
        MEAN_REVERSION: 0.5,
        BREAKOUT: 1.0,
        SQUEEZE: 0.7,
        CONSOLIDATION: 0.3,
      },
      RISK_OFF: {
        MOMENTUM: 0.3,
        MEAN_REVERSION: 0.8,
        BREAKOUT: 0.2,
        SQUEEZE: 0.4,
        CONSOLIDATION: 0.9,
      },
      RISK_ON: {
        MOMENTUM: 0.9,
        MEAN_REVERSION: 0.4,
        BREAKOUT: 0.9,
        SQUEEZE: 0.6,
        CONSOLIDATION: 0.3,
      },
      TRANSITION: {
        MOMENTUM: 0.5,
        MEAN_REVERSION: 0.6,
        BREAKOUT: 0.5,
        SQUEEZE: 0.6,
        CONSOLIDATION: 0.6,
      },
    };

    return matrix[regime]?.[clusterType] ?? 0.5;
  }

  /**
   * Check if cluster is allowed in current context
   */
  private checkAllowed(
    macroRegime: MacroRegime,
    fundingRegime: FundingRegime,
    clusterType?: ClusterType
  ): { isAllowed: boolean; penaltyReason?: string } {
    // Block momentum/breakout in RISK_OFF
    if (macroRegime === 'RISK_OFF' && clusterType) {
      if (['MOMENTUM', 'BREAKOUT'].includes(clusterType)) {
        return {
          isAllowed: false,
          penaltyReason: `${clusterType} blocked in RISK_OFF regime`,
        };
      }
    }

    // Block in BTC_DOMINANT for aggressive patterns
    if (macroRegime === 'BTC_DOMINANT' && clusterType === 'BREAKOUT') {
      return {
        isAllowed: false,
        penaltyReason: 'BREAKOUT blocked in BTC_DOMINANT regime',
      };
    }

    // Warn for extreme funding
    if (fundingRegime === 'EXTREME_LONG' || fundingRegime === 'EXTREME_SHORT') {
      return {
        isAllowed: true,
        penaltyReason: `Caution: ${fundingRegime} - high liquidation risk`,
      };
    }

    return { isAllowed: true };
  }

  /**
   * Apply context to cluster confidence
   */
  applyContextToCluster(
    baseConfidence: number,
    context: ClusterContext
  ): {
    finalConfidence: number;
    adjustments: string[];
  } {
    const adjustments: string[] = [];

    if (!context.isAllowed) {
      return {
        finalConfidence: baseConfidence * 0.3,  // Heavy penalty
        adjustments: [context.penaltyReason ?? 'Blocked by context'],
      };
    }

    let finalConfidence = baseConfidence * context.contextModifier;

    // Cap confidence in uncertain conditions
    if (context.macroRegime === 'TRANSITION') {
      finalConfidence = Math.min(finalConfidence, 0.65);
      adjustments.push('Capped at 65% due to TRANSITION regime');
    }

    // Cap in extreme funding
    if (context.fundingRegime === 'EXTREME_LONG' || context.fundingRegime === 'EXTREME_SHORT') {
      finalConfidence = Math.min(finalConfidence, 0.55);
      adjustments.push(`Capped at 55% due to ${context.fundingRegime}`);
    }

    if (context.penaltyReason) {
      adjustments.push(context.penaltyReason);
    }

    return {
      finalConfidence: Math.round(finalConfidence * 100) / 100,
      adjustments,
    };
  }

  /**
   * Get full context summary
   */
  async getSummary(): Promise<{
    macro: {
      regime: MacroRegime;
      confidence: number;
      btcDominance?: number;
      fearGreed?: number;
    };
    funding: {
      regime: FundingRegime;
      avgFunding: number;
      squeezePotential?: {
        hasSqueezeRisk: boolean;
        direction: string | null;
      };
    };
    recommendation: string;
  }> {
    const macro = macroStateService.getCurrent();
    const funding = fundingOverlayService.getMarketState();

    const squeezePotential = funding
      ? fundingOverlayService.detectSqueezePotential(funding)
      : null;

    // Generate recommendation
    let recommendation = 'Normal trading conditions';
    
    if (macro?.regime === 'RISK_OFF') {
      recommendation = 'Defensive mode: Focus on mean-reversion and hedges';
    } else if (macro?.regime === 'ALTSEASON') {
      recommendation = 'Aggressive mode: Momentum and breakout strategies favored';
    } else if (funding?.regime === 'EXTREME_LONG') {
      recommendation = 'Caution: Long squeeze risk elevated';
    } else if (funding?.regime === 'EXTREME_SHORT') {
      recommendation = 'Opportunity: Short squeeze potential detected';
    }

    return {
      macro: {
        regime: macro?.regime ?? 'TRANSITION',
        confidence: macro?.confidence ?? 0.5,
        btcDominance: macro?.btcDominance,
        fearGreed: macro?.fearGreedIndex,
      },
      funding: {
        regime: funding?.regime ?? 'NEUTRAL',
        avgFunding: funding?.avgFunding ?? 0,
        squeezePotential: squeezePotential
          ? {
              hasSqueezeRisk: squeezePotential.hasSqueezeRisk,
              direction: squeezePotential.direction,
            }
          : undefined,
      },
      recommendation,
    };
  }
}

export const clusterContextService = new ClusterContextService();

console.log('[Macro] Cluster Context Service loaded');
