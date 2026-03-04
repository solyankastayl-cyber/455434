/**
 * Market Route Features Provider (P1.6)
 * 
 * Extracts ML features from route market context.
 * Features are contextual interpretations, NOT raw market data.
 */

import { RouteMarketContextModel } from '../storage/route_market_context.model.js';

// ============================================
// Types
// ============================================

export interface MarketRouteFeatures {
  // Route-specific market context
  route_marketAmplifier: number | null;
  route_contextualRiskDelta: number | null;
  
  // Market conditions during route
  market_stressDuringRoute: boolean | null;
  market_volatilityDuringExit: number | null;   // 0=LOW, 0.5=NORMAL, 1=HIGH
  market_liquidityDuringExit: number | null;    // 0=THIN, 0.5=NORMAL, 1=DEEP
  
  // Quality/coverage
  market_contextQuality: number | null;
  market_hasContextData: boolean;
}

// ============================================
// Feature Provider
// ============================================

export class MarketRouteFeatureProvider {
  
  /**
   * Extract features for a route
   */
  async getFeatures(routeId: string): Promise<MarketRouteFeatures> {
    const context = await RouteMarketContextModel.findOne({ routeId });
    
    // No context data
    if (!context || !context.marketSnapshot) {
      return this.createNullFeatures();
    }
    
    const snapshot = context.marketSnapshot;
    const risk = context.contextualRisk;
    
    return {
      // Route amplification
      route_marketAmplifier: risk?.marketAmplifier ?? 1.0,
      route_contextualRiskDelta: risk 
        ? risk.contextualDumpRiskScore - risk.baseDumpRiskScore 
        : null,
      
      // Market conditions (encoded)
      market_stressDuringRoute: snapshot.isStressed,
      market_volatilityDuringExit: this.encodeVolatility(snapshot.volatilityRegime),
      market_liquidityDuringExit: this.encodeLiquidity(snapshot.liquidityRegime),
      
      // Quality
      market_contextQuality: context.sourceQuality,
      market_hasContextData: true
    };
  }
  
  /**
   * Batch get features for multiple routes
   */
  async getBatchFeatures(routeIds: string[]): Promise<Map<string, MarketRouteFeatures>> {
    const contexts = await RouteMarketContextModel.find({
      routeId: { $in: routeIds }
    });
    
    const contextMap = new Map(contexts.map(c => [c.routeId, c]));
    const result = new Map<string, MarketRouteFeatures>();
    
    for (const routeId of routeIds) {
      const context = contextMap.get(routeId);
      
      if (!context || !context.marketSnapshot) {
        result.set(routeId, this.createNullFeatures());
        continue;
      }
      
      const snapshot = context.marketSnapshot;
      const risk = context.contextualRisk;
      
      result.set(routeId, {
        route_marketAmplifier: risk?.marketAmplifier ?? 1.0,
        route_contextualRiskDelta: risk 
          ? risk.contextualDumpRiskScore - risk.baseDumpRiskScore 
          : null,
        market_stressDuringRoute: snapshot.isStressed,
        market_volatilityDuringExit: this.encodeVolatility(snapshot.volatilityRegime),
        market_liquidityDuringExit: this.encodeLiquidity(snapshot.liquidityRegime),
        market_contextQuality: context.sourceQuality,
        market_hasContextData: true
      });
    }
    
    return result;
  }
  
  // ============================================
  // Encoding Helpers
  // ============================================
  
  private encodeVolatility(regime: string): number {
    switch (regime) {
      case 'LOW': return 0;
      case 'NORMAL': return 0.5;
      case 'HIGH': return 1;
      default: return 0.5;
    }
  }
  
  private encodeLiquidity(regime: string): number {
    switch (regime) {
      case 'THIN': return 0;
      case 'NORMAL': return 0.5;
      case 'DEEP': return 1;
      default: return 0.5;
    }
  }
  
  private createNullFeatures(): MarketRouteFeatures {
    return {
      route_marketAmplifier: null,
      route_contextualRiskDelta: null,
      market_stressDuringRoute: null,
      market_volatilityDuringExit: null,
      market_liquidityDuringExit: null,
      market_contextQuality: null,
      market_hasContextData: false
    };
  }
}

// Singleton
export const marketRouteFeatureProvider = new MarketRouteFeatureProvider();

// ============================================
// Feature Count
// ============================================

export function getMarketRouteFeatureCount(): number {
  return 7;
}
