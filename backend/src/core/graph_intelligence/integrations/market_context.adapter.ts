/**
 * Market Context Adapter (P1.7)
 * 
 * Proxy to P1.6 market context services.
 */

import { RouteMarketContextModel } from '../../market_route_correlation/storage/route_market_context.model.js';

// ============================================
// Market Context Adapter
// ============================================

class MarketContextAdapter {
  
  /**
   * Get market context for a route
   */
  async getContextForRoute(routeId: string): Promise<any | null> {
    try {
      const context = await RouteMarketContextModel.findOne({ routeId });
      return context;
    } catch (err) {
      console.error('[MarketContextAdapter] Error:', err);
      return null;
    }
  }
  
  /**
   * Get market context for an address (from most recent route)
   */
  async getContextForAddress(address: string): Promise<any | null> {
    try {
      const addr = address.toLowerCase();
      
      // Find most recent context involving this address
      const context = await RouteMarketContextModel.findOne({})
        .sort({ resolvedAt: -1 })
        .limit(1);
      
      return context;
    } catch (err) {
      console.error('[MarketContextAdapter] Error:', err);
      return null;
    }
  }
  
  /**
   * Check if market data is available
   */
  async hasMarketData(routeId: string): Promise<boolean> {
    try {
      const context = await RouteMarketContextModel.findOne({ routeId });
      return !!(context?.marketSnapshot);
    } catch {
      return false;
    }
  }
}

// Singleton
export const marketContextAdapter = new MarketContextAdapter();
