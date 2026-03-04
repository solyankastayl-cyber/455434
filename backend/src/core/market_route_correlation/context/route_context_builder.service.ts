/**
 * Route Context Builder (P1.6)
 * 
 * Main orchestrator that builds and stores route market context.
 * Links routes with market conditions and computes contextual risk.
 */

import {
  RouteMarketContextModel,
  IRouteMarketContext,
  IRouteMarketContextDocument
} from '../storage/route_market_context.model.js';
import { marketContextResolver } from './market_context_resolver.service.js';
import { contextualExitRiskService, RouteRiskInput } from '../scoring/contextual_exit_risk.service.js';

// ============================================
// Types
// ============================================

export interface RouteData {
  routeId: string;
  token: string;
  routeType: string;
  exitProbability: number;
  dumpRiskScore: number;
  pathEntropy: number;
  hasCexTouchpoint: boolean;
  hasSwapBeforeExit: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface BuildContextResult {
  ok: boolean;
  context?: IRouteMarketContextDocument;
  error?: string;
  isNew: boolean;
}

// ============================================
// Builder Service
// ============================================

export class RouteContextBuilder {
  
  /**
   * Build or update market context for a route
   */
  async buildContext(route: RouteData): Promise<BuildContextResult> {
    const now = Date.now();
    
    try {
      // Check if context already exists
      const existing = await RouteMarketContextModel.findOne({ routeId: route.routeId });
      
      // Define time window (±2 hours around route activity)
      const timeWindow = {
        from: route.firstSeenAt - 2 * 60 * 60 * 1000,
        to: route.lastSeenAt + 2 * 60 * 60 * 1000
      };
      
      // Resolve market context
      const marketResult = await marketContextResolver.resolve({
        token: route.token,
        fromTs: timeWindow.from,
        toTs: timeWindow.to
      });
      
      // Build route risk input
      const routeRisk: RouteRiskInput = {
        routeType: route.routeType,
        exitProbability: route.exitProbability,
        dumpRiskScore: route.dumpRiskScore,
        pathEntropy: route.pathEntropy,
        hasCexTouchpoint: route.hasCexTouchpoint,
        hasSwapBeforeExit: route.hasSwapBeforeExit
      };
      
      // Calculate contextual risk
      const contextualRisk = contextualExitRiskService.calculate(
        routeRisk,
        marketResult.snapshot
      );
      
      // Build context document
      const contextData: Partial<IRouteMarketContext> = {
        routeId: route.routeId,
        token: route.token.toUpperCase(),
        timeWindow,
        marketSnapshot: marketResult.snapshot,
        sourceQuality: marketResult.sourceQuality,
        resolvedAt: now,
        contextualRisk: {
          baseDumpRiskScore: contextualRisk.baseDumpRiskScore,
          contextualDumpRiskScore: contextualRisk.contextualDumpRiskScore,
          marketAmplifier: contextualRisk.marketAmplifier,
          contextTags: contextualRisk.contextTags,
          confidenceImpact: contextualRisk.confidenceImpact
        },
        updatedAt: now
      };
      
      if (existing) {
        // Update existing
        Object.assign(existing, contextData);
        await existing.save();
        
        return { ok: true, context: existing, isNew: false };
      } else {
        // Create new
        const newContext = new RouteMarketContextModel({
          ...contextData,
          createdAt: now
        });
        await newContext.save();
        
        return { ok: true, context: newContext, isNew: true };
      }
      
    } catch (err) {
      return {
        ok: false,
        error: (err as Error).message,
        isNew: false
      };
    }
  }
  
  /**
   * Batch build contexts for multiple routes
   */
  async buildBatch(routes: RouteData[]): Promise<{
    processed: number;
    created: number;
    updated: number;
    errors: number;
  }> {
    let created = 0;
    let updated = 0;
    let errors = 0;
    
    for (const route of routes) {
      const result = await this.buildContext(route);
      
      if (result.ok) {
        if (result.isNew) created++;
        else updated++;
      } else {
        errors++;
      }
    }
    
    return {
      processed: routes.length,
      created,
      updated,
      errors
    };
  }
  
  /**
   * Get context with fresh market data recalculation
   */
  async refreshContext(routeId: string): Promise<BuildContextResult> {
    const existing = await RouteMarketContextModel.findOne({ routeId });
    
    if (!existing) {
      return {
        ok: false,
        error: 'Route context not found',
        isNew: false
      };
    }
    
    // We need original route data - for now just re-resolve market
    const marketResult = await marketContextResolver.resolve({
      token: existing.token,
      fromTs: existing.timeWindow.from,
      toTs: existing.timeWindow.to
    });
    
    // Recalculate with existing route risk if available
    if (existing.contextualRisk) {
      const routeRisk: RouteRiskInput = {
        routeType: 'EXIT', // Default, ideally from route
        exitProbability: 0.5,
        dumpRiskScore: existing.contextualRisk.baseDumpRiskScore,
        pathEntropy: 0.5,
        hasCexTouchpoint: false,
        hasSwapBeforeExit: false
      };
      
      const contextualRisk = contextualExitRiskService.calculate(
        routeRisk,
        marketResult.snapshot
      );
      
      existing.marketSnapshot = marketResult.snapshot;
      existing.sourceQuality = marketResult.sourceQuality;
      existing.resolvedAt = Date.now();
      existing.contextualRisk = {
        baseDumpRiskScore: contextualRisk.baseDumpRiskScore,
        contextualDumpRiskScore: contextualRisk.contextualDumpRiskScore,
        marketAmplifier: contextualRisk.marketAmplifier,
        contextTags: contextualRisk.contextTags,
        confidenceImpact: contextualRisk.confidenceImpact
      };
      existing.updatedAt = Date.now();
      
      await existing.save();
    }
    
    return { ok: true, context: existing, isNew: false };
  }
}

// Singleton
export const routeContextBuilder = new RouteContextBuilder();
