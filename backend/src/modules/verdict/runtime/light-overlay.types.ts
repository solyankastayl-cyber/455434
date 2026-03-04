/**
 * LIGHT OVERLAY TYPES
 * ===================
 * 
 * P3: Smart Caching Layer - Block 2
 * Types for real-time lightweight adjustments.
 * 
 * Light overlay applies fast adjustments on top of cached heavy verdict:
 * - Macro risk adjustments
 * - Volatility regime adjustments
 * - Funding crowdedness adjustments
 */

export type OverlayContext = {
  symbol: string;
  horizon: '1D' | '7D' | '30D';
  nowIso: string;
};

export type MacroInputs = {
  regime?: string;                                  // BTC_FLIGHT_TO_SAFETY, PANIC_SELL_OFF...
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  confidenceMult?: number;                          // e.g., 0.82 = -18%
};

export type VolatilityInputs = {
  atrPct?: number;                                  // ATR% or similar
  volRegime?: 'LOW' | 'NORMAL' | 'HIGH';
  uncertaintyMult?: number;                         // e.g., 0.9
};

export type FundingInputs = {
  fundingRate?: number;                             // Current funding (per 8h / per hour)
  crowdedness?: number;                             // 0..1
  squeezeBias?: number;                             // -1..+1
  fundingMult?: number;                             // Final multiplier
};

export type OverlayInputs = {
  macro?: MacroInputs;
  volatility?: VolatilityInputs;
  funding?: FundingInputs;
};

export type OverlayAdjustment = {
  key: string;                                      // "MACRO_CAP", "FUNDING_CROWD", "VOL_REGIME"
  deltaPct: number;                                 // -17.8 (percentage, for UI)
  note: string;                                     // Short explanation
};

export type OverlayResult = {
  rawConfidence: number;                            // 0..1
  adjustedConfidence: number;                       // 0..1
  confidenceMultTotal: number;                      // Total multiplier applied
  adjustments: OverlayAdjustment[];
  positionSizeMult?: number;                        // 0..1
};

console.log('[LightOverlayTypes] Types loaded');
