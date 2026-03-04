/**
 * OVERLAY INPUTS BUILDER
 * ======================
 * 
 * P3: Smart Caching Layer - Block 2
 * Quickly gathers real-time inputs for light overlay.
 * 
 * This service fetches current market state from existing ports/services:
 * - Macro regime from MetaBrain
 * - Volatility from price service
 * - Funding from exchange data
 * 
 * All operations should be fast (< 100ms total).
 */

import type { OverlayInputs, MacroInputs, VolatilityInputs, FundingInputs } from './light-overlay.types.js';

export type OverlayDeps = {
  macroPort?: {
    getMacroState: (symbol: string) => Promise<MacroInputs>;
  };
  fundingPort?: {
    getFundingState: (symbol: string) => Promise<FundingInputs>;
  };
  volatilityPort?: {
    getVolatilityState: (symbol: string) => Promise<VolatilityInputs>;
  };
};

export class OverlayInputsBuilder {
  constructor(private deps: OverlayDeps = {}) {}

  /**
   * Build overlay inputs from real-time data
   * Uses stubs if ports are not provided
   */
  async build(symbol: string): Promise<OverlayInputs> {
    const symbolNorm = symbol.toUpperCase();

    // Fetch all inputs in parallel
    const [macro, funding, volatility] = await Promise.all([
      this.getMacro(symbolNorm),
      this.getFunding(symbolNorm),
      this.getVolatility(symbolNorm),
    ]);

    return { macro, funding, volatility };
  }

  private async getMacro(symbol: string): Promise<MacroInputs> {
    if (this.deps.macroPort) {
      try {
        return await this.deps.macroPort.getMacroState(symbol);
      } catch (e) {
        console.warn('[OverlayInputsBuilder] Macro port error:', e);
      }
    }
    
    // Stub: return neutral macro state
    return {
      regime: 'NEUTRAL',
      riskLevel: 'MEDIUM',
      confidenceMult: 1.0,
    };
  }

  private async getFunding(symbol: string): Promise<FundingInputs> {
    if (this.deps.fundingPort) {
      try {
        return await this.deps.fundingPort.getFundingState(symbol);
      } catch (e) {
        console.warn('[OverlayInputsBuilder] Funding port error:', e);
      }
    }
    
    // Stub: return neutral funding state
    return {
      fundingRate: 0,
      crowdedness: 0.3,
      squeezeBias: 0,
      fundingMult: 1.0,
    };
  }

  private async getVolatility(symbol: string): Promise<VolatilityInputs> {
    if (this.deps.volatilityPort) {
      try {
        return await this.deps.volatilityPort.getVolatilityState(symbol);
      } catch (e) {
        console.warn('[OverlayInputsBuilder] Volatility port error:', e);
      }
    }
    
    // Stub: return neutral volatility state
    return {
      atrPct: 3,
      volRegime: 'NORMAL',
      uncertaintyMult: 1.0,
    };
  }
}

// Singleton instance (with stubs for now)
export const overlayInputsBuilder = new OverlayInputsBuilder();

console.log('[OverlayInputsBuilder] Module loaded');
