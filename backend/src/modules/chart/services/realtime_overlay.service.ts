/**
 * REAL-TIME OVERLAY SERVICE
 * ==========================
 * 
 * Provides real-time market context overlay for the Price vs Expectation chart.
 * Shows derivatives state, regime detection, and confidence modifiers.
 * 
 * This is NOT part of the prediction - it's contextual information
 * that helps interpret the forecast.
 */

import { fundingService } from '../../exchange/funding/funding.service.js';
import type { FundingContext } from '../../exchange/funding/contracts/funding.context.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type MarketRegime = 'TREND' | 'RANGE' | 'SQUEEZE' | 'VOLATILE';
export type FundingState = 'NORMAL' | 'ELEVATED' | 'EXTREME';
export type LiquidationRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RealtimeOverlay {
  asset: string;
  timestamp: number;
  
  // Regime detection
  regime: MarketRegime;
  regimeConfidence: number;
  
  // Funding state
  funding: {
    rate: number | null;
    state: FundingState;
    annualized: number | null;
  };
  
  // Positioning
  positioning: {
    longShortRatio: number | null;  // % long (e.g., 65 = 65% long)
    oiDeltaPct: number | null;      // OI change in last period
    imbalanceDirection: 'LONG_HEAVY' | 'SHORT_HEAVY' | 'BALANCED' | null;
  };
  
  // Risk assessment
  liquidationRisk: LiquidationRisk;
  
  // Confidence modifier for forecast
  confidenceModifier: number;  // -0.15 to 0 (negative = reduce confidence)
  
  // Summary
  summary: string;
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function classifyFundingState(rate: number | null): FundingState {
  if (rate === null) return 'NORMAL';
  
  const absRate = Math.abs(rate);
  
  // Funding rate thresholds (8h rate)
  // > 0.05% = elevated (>0.0005)
  // > 0.1% = extreme (>0.001)
  if (absRate > 0.001) return 'EXTREME';
  if (absRate > 0.0005) return 'ELEVATED';
  return 'NORMAL';
}

function classifyPositioning(
  longPct: number | null
): { direction: 'LONG_HEAVY' | 'SHORT_HEAVY' | 'BALANCED' | null; isExtreme: boolean } {
  if (longPct === null) return { direction: null, isExtreme: false };
  
  // 70%+ long or 30%- long (70%+ short) = squeeze risk
  if (longPct >= 70) return { direction: 'LONG_HEAVY', isExtreme: true };
  if (longPct <= 30) return { direction: 'SHORT_HEAVY', isExtreme: true };
  if (longPct >= 60) return { direction: 'LONG_HEAVY', isExtreme: false };
  if (longPct <= 40) return { direction: 'SHORT_HEAVY', isExtreme: false };
  
  return { direction: 'BALANCED', isExtreme: false };
}

function detectRegime(
  fundingState: FundingState,
  positioningExtreme: boolean,
  oiDelta: number | null
): { regime: MarketRegime; confidence: number } {
  // Squeeze: extreme positioning + elevated/extreme funding
  if (positioningExtreme && fundingState !== 'NORMAL') {
    return { regime: 'SQUEEZE', confidence: 0.8 };
  }
  
  // Volatile: extreme funding without positioning
  if (fundingState === 'EXTREME') {
    return { regime: 'VOLATILE', confidence: 0.7 };
  }
  
  // Trend: significant OI growth
  if (oiDelta !== null && Math.abs(oiDelta) > 5) {
    return { regime: 'TREND', confidence: 0.6 };
  }
  
  // Default: Range
  return { regime: 'RANGE', confidence: 0.5 };
}

function calculateLiquidationRisk(
  positioningExtreme: boolean,
  fundingState: FundingState
): LiquidationRisk {
  if (positioningExtreme && fundingState === 'EXTREME') return 'HIGH';
  if (positioningExtreme || fundingState === 'EXTREME') return 'MEDIUM';
  return 'LOW';
}

function calculateConfidenceModifier(
  liquidationRisk: LiquidationRisk,
  regime: MarketRegime
): number {
  // High risk = reduce forecast confidence
  if (liquidationRisk === 'HIGH') return -0.15;
  if (liquidationRisk === 'MEDIUM') return -0.07;
  if (regime === 'VOLATILE') return -0.05;
  return 0;
}

function buildSummary(overlay: Partial<RealtimeOverlay>): string {
  const parts: string[] = [];
  
  if (overlay.regime === 'SQUEEZE') {
    parts.push('Market in potential squeeze condition');
  } else if (overlay.regime === 'VOLATILE') {
    parts.push('High volatility environment');
  } else if (overlay.regime === 'TREND') {
    parts.push('Trending market');
  } else {
    parts.push('Range-bound market');
  }
  
  if (overlay.funding?.state === 'EXTREME') {
    const direction = (overlay.funding.rate || 0) > 0 ? 'positive' : 'negative';
    parts.push(`Extreme ${direction} funding`);
  }
  
  if (overlay.liquidationRisk === 'HIGH') {
    parts.push('High liquidation risk');
  }
  
  return parts.join('. ');
}

function buildWarnings(overlay: Partial<RealtimeOverlay>): string[] {
  const warnings: string[] = [];
  
  if (overlay.liquidationRisk === 'HIGH') {
    warnings.push('Cascade liquidations possible - reduce position size');
  }
  
  if (overlay.funding?.state === 'EXTREME') {
    const direction = (overlay.funding.rate || 0) > 0 ? 'longs' : 'shorts';
    warnings.push(`${direction} paying extreme funding - squeeze risk`);
  }
  
  if (overlay.positioning?.imbalanceDirection === 'LONG_HEAVY' && overlay.positioning.longShortRatio && overlay.positioning.longShortRatio > 70) {
    warnings.push('Market heavily long-biased - short squeeze less likely');
  }
  
  if (overlay.positioning?.imbalanceDirection === 'SHORT_HEAVY' && overlay.positioning.longShortRatio && overlay.positioning.longShortRatio < 30) {
    warnings.push('Market heavily short-biased - long squeeze possible');
  }
  
  return warnings;
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export async function buildRealtimeOverlay(asset: string): Promise<RealtimeOverlay> {
  const symbol = asset.includes('USDT') ? asset : `${asset}USDT`;
  const assetNorm = asset.toUpperCase().replace('USDT', '');
  
  // Try to get funding context
  let fundingContext: FundingContext | null = null;
  try {
    fundingContext = await fundingService.getContextOne(symbol);
  } catch (e) {
    console.warn(`[Overlay] Failed to get funding for ${symbol}:`, e);
  }
  
  // Extract funding data
  const fundingRate = fundingContext?.snapshot?.rate ?? null;
  const fundingState = classifyFundingState(fundingRate);
  const annualized = fundingRate !== null ? fundingRate * 3 * 365 * 100 : null; // 8h rate to annual %
  
  // Extract positioning (from funding context if available)
  // Note: Real L/S ratio would come from a separate derivatives service
  // For now, we estimate from funding direction
  let longShortRatio: number | null = null;
  let oiDeltaPct: number | null = null;
  
  // Mock positioning based on funding (would be real data in production)
  if (fundingRate !== null) {
    // High positive funding = more longs, negative = more shorts
    longShortRatio = 50 + (fundingRate / 0.001) * 20; // Very rough estimate
    longShortRatio = Math.max(20, Math.min(80, longShortRatio));
  }
  
  const positioning = classifyPositioning(longShortRatio);
  const { regime, confidence: regimeConfidence } = detectRegime(
    fundingState,
    positioning.isExtreme,
    oiDeltaPct
  );
  
  const liquidationRisk = calculateLiquidationRisk(positioning.isExtreme, fundingState);
  const confidenceModifier = calculateConfidenceModifier(liquidationRisk, regime);
  
  const overlay: RealtimeOverlay = {
    asset: assetNorm,
    timestamp: Date.now(),
    
    regime,
    regimeConfidence,
    
    funding: {
      rate: fundingRate,
      state: fundingState,
      annualized,
    },
    
    positioning: {
      longShortRatio,
      oiDeltaPct,
      imbalanceDirection: positioning.direction,
    },
    
    liquidationRisk,
    confidenceModifier,
    
    summary: '',
    warnings: [],
  };
  
  overlay.summary = buildSummary(overlay);
  overlay.warnings = buildWarnings(overlay);
  
  return overlay;
}

console.log('[Overlay] Realtime Overlay Service loaded');
