/**
 * Route Classifier (P0.3)
 * 
 * Classifies routes by intent/behavior type.
 * Deterministic rules, no ML.
 */

import { ILiquidityRoute, RouteType } from './liquidity_route.model.js';
import { IRouteSegment } from './route_segment.model.js';

// ============================================
// Classification Rules
// ============================================

interface ClassificationResult {
  routeType: RouteType;
  confidence: number;
  reasoning: string[];
}

/**
 * Classify a route based on its characteristics
 */
export function classifyRoute(
  route: Partial<ILiquidityRoute>,
  segments: IRouteSegment[],
  endIsCEX: boolean
): ClassificationResult {
  const reasoning: string[] = [];
  
  // Rule 1: EXIT - ends at CEX
  if (endIsCEX) {
    reasoning.push('Route terminates at known CEX');
    return {
      routeType: 'EXIT',
      confidence: 0.9,
      reasoning
    };
  }
  
  // Rule 2: MIXING - zig-zag pattern or router usage
  const mixingScore = detectMixingPattern(segments);
  if (mixingScore > 0.7) {
    reasoning.push('Zig-zag pattern detected');
    reasoning.push('Multiple bridges used sequentially');
    return {
      routeType: 'MIXING',
      confidence: mixingScore,
      reasoning
    };
  }
  
  // Rule 3: MIGRATION - multi-chain, no exit
  const chainsInvolved = route.chainsInvolved || [];
  if (chainsInvolved.length >= 2 && route.startChain !== route.endChain) {
    reasoning.push(`Multi-chain route: ${chainsInvolved.join(' → ')}`);
    reasoning.push('No CEX destination detected');
    return {
      routeType: 'MIGRATION',
      confidence: 0.75,
      reasoning
    };
  }
  
  // Rule 4: INTERNAL - same chain
  if (chainsInvolved.length <= 1 || route.startChain === route.endChain) {
    reasoning.push('Single chain movements');
    return {
      routeType: 'INTERNAL',
      confidence: 0.8,
      reasoning
    };
  }
  
  // Default: UNKNOWN
  reasoning.push('Cannot determine clear intent');
  return {
    routeType: 'UNKNOWN',
    confidence: 0.3,
    reasoning
  };
}

// ============================================
// Pattern Detection
// ============================================

/**
 * Detect mixing/obfuscation patterns
 */
function detectMixingPattern(segments: IRouteSegment[]): number {
  let score = 0;
  const indicators = {
    multipleRouters: false,
    zigZag: false,
    rapidChainSwitch: false,
    amountSplitting: false
  };
  
  // Check for multiple bridge usage
  const bridges = segments.filter(s => s.type === 'BRIDGE');
  if (bridges.length >= 3) {
    indicators.multipleRouters = true;
    score += 0.3;
  }
  
  // Check for zig-zag (A→B→A pattern)
  const chainSequence = segments.map(s => s.chainFrom);
  for (let i = 2; i < chainSequence.length; i++) {
    if (chainSequence[i] === chainSequence[i-2] && chainSequence[i] !== chainSequence[i-1]) {
      indicators.zigZag = true;
      score += 0.4;
      break;
    }
  }
  
  // Check for rapid chain switching (< 5 min between bridges)
  for (let i = 1; i < bridges.length; i++) {
    const gap = new Date(bridges[i].timestamp).getTime() - 
                new Date(bridges[i-1].timestamp).getTime();
    if (gap < 5 * 60 * 1000) {
      indicators.rapidChainSwitch = true;
      score += 0.2;
      break;
    }
  }
  
  // Check for amount fragmentation
  const amounts = segments.map(s => parseFloat(s.amount)).filter(a => !isNaN(a));
  if (amounts.length > 2) {
    const firstAmount = amounts[0];
    const fragments = amounts.filter(a => a < firstAmount * 0.5);
    if (fragments.length >= 2) {
      indicators.amountSplitting = true;
      score += 0.2;
    }
  }
  
  return Math.min(1, score);
}

/**
 * Detect potential dump pattern (EXIT with high confidence)
 */
export function detectDumpPattern(
  route: Partial<ILiquidityRoute>,
  segments: IRouteSegment[]
): { isDump: boolean; confidence: number; signals: string[] } {
  const signals: string[] = [];
  let confidence = 0;
  
  // Must be EXIT type
  if (route.routeType !== 'EXIT') {
    return { isDump: false, confidence: 0, signals: [] };
  }
  
  // Signal 1: Large amount
  if (route.totalAmountUsd && route.totalAmountUsd > 100000) {
    signals.push(`Large amount: $${route.totalAmountUsd.toLocaleString()}`);
    confidence += 0.3;
  }
  
  // Signal 2: Fast execution
  if (route.durationMs && route.durationMs < 30 * 60 * 1000) { // < 30 min
    signals.push('Fast execution (<30 min)');
    confidence += 0.2;
  }
  
  // Signal 3: Direct path (few segments)
  if (segments.length <= 3) {
    signals.push('Direct path to exchange');
    confidence += 0.2;
  }
  
  // Signal 4: High route confidence
  if (route.confidenceScore && route.confidenceScore > 0.8) {
    signals.push('High route confidence');
    confidence += 0.2;
  }
  
  // Signal 5: Known CEX
  if (route.endLabel) {
    signals.push(`Destination: ${route.endLabel}`);
    confidence += 0.1;
  }
  
  return {
    isDump: confidence >= 0.5,
    confidence: Math.min(1, confidence),
    signals
  };
}

/**
 * Detect accumulation pattern (inflows from CEX)
 */
export function detectAccumulationPattern(
  routes: Array<Partial<ILiquidityRoute>>
): { isAccumulating: boolean; confidence: number; signals: string[] } {
  const signals: string[] = [];
  let confidence = 0;
  
  // Check for multiple CEX withdrawals to same wallet
  const withdrawalRoutes = routes.filter(r => r.startLabel && r.routeType !== 'EXIT');
  
  if (withdrawalRoutes.length >= 3) {
    signals.push(`Multiple inflows from exchanges: ${withdrawalRoutes.length}`);
    confidence += 0.4;
  }
  
  // Check for consistent destination
  const endWallets = new Set(routes.map(r => r.endWallet?.toLowerCase()).filter(Boolean));
  if (endWallets.size === 1 && routes.length >= 2) {
    signals.push('Consistent destination wallet');
    confidence += 0.3;
  }
  
  return {
    isAccumulating: confidence >= 0.5,
    confidence: Math.min(1, confidence),
    signals
  };
}

// ============================================
// Route Severity Mapping
// ============================================

export type RouteSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/**
 * Get alert severity based on route classification
 */
export function getRouteSeverity(
  route: Partial<ILiquidityRoute>,
  isDump: boolean
): RouteSeverity {
  // CRITICAL: Confirmed large dump
  if (isDump && route.totalAmountUsd && route.totalAmountUsd > 500000) {
    return 'CRITICAL';
  }
  
  // HIGH: EXIT route with good confidence
  if (route.routeType === 'EXIT' && (route.confidenceScore || 0) > 0.7) {
    return 'HIGH';
  }
  
  // HIGH: Potential dump
  if (isDump) {
    return 'HIGH';
  }
  
  // MEDIUM: EXIT route
  if (route.routeType === 'EXIT') {
    return 'MEDIUM';
  }
  
  // MEDIUM: Mixing pattern
  if (route.routeType === 'MIXING') {
    return 'MEDIUM';
  }
  
  // LOW: Migration
  if (route.routeType === 'MIGRATION') {
    return 'LOW';
  }
  
  // INFO: Everything else
  return 'INFO';
}
