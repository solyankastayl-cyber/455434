/**
 * S10.2 — Order Flow Intelligence Types (LOCKED)
 * 
 * These are computed states, not signals.
 * They describe market BEHAVIOR, not predictions.
 * 
 * DO NOT MODIFY once S10.2 is complete.
 */

// ═══════════════════════════════════════════════════════════════
// ORDER FLOW STATE
// "Who is currently pushing the price?"
// ═══════════════════════════════════════════════════════════════
export type AggressorSide = 'BUY' | 'SELL' | 'NEUTRAL';

export interface OrderFlowState {
  symbol: string;
  aggressorSide: AggressorSide;        // Who is dominant
  aggressorRatio: number;               // -1 to 1 (positive = buyers)
  tradeIntensity: number;               // 0-100, normalized activity level
  dominanceScore: number;               // 0-1, how strong is the dominance
  buyVolume: number;                    // Actual buy volume
  sellVolume: number;                   // Actual sell volume
  totalTrades: number;                  // Trade count in window
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════
// ABSORPTION STATE
// "Is someone absorbing the selling/buying pressure?"
// ═══════════════════════════════════════════════════════════════
export type AbsorptionStrength = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface AbsorptionState {
  symbol: string;
  detected: boolean;                    // Is absorption happening?
  side: AggressorSide;                  // Which side is being absorbed
  absorbedVolume: number;               // Volume being absorbed
  priceMoved: boolean;                  // Did price move despite volume?
  strength: AbsorptionStrength;         // How strong is absorption
  priceChangePercent: number;           // Price change during absorption
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════
// IMBALANCE PRESSURE
// "What does the order book tell us about intention?"
// ═══════════════════════════════════════════════════════════════
export type PressureDirection = 'BUY' | 'SELL' | 'NEUTRAL';

export interface ImbalancePressure {
  symbol: string;
  bidAskImbalance: number;              // -1 to 1 (positive = more bids)
  pressure: PressureDirection;          // Net pressure direction
  confidence: number;                   // 0-1, how confident in signal
  bidVolume: number;                    // Total bid volume in book
  askVolume: number;                    // Total ask volume in book
  spread: number;                       // Current spread percentage
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════
// ORDER FLOW SUMMARY (aggregated view)
// ═══════════════════════════════════════════════════════════════
export interface OrderFlowSummary {
  symbol: string;
  flow: OrderFlowState;
  absorption: AbsorptionState;
  pressure: ImbalancePressure;
  marketBias: AggressorSide;            // Overall market bias
  biasStrength: number;                 // 0-100
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC DATA (for admin)
// ═══════════════════════════════════════════════════════════════
export interface OrderFlowDiagnostics {
  symbol: string;
  rawInputs: {
    tradeFlowTimestamp: Date | null;
    orderBookTimestamp: Date | null;
    buyVolume: number;
    sellVolume: number;
    bidLevels: number;
    askLevels: number;
  };
  calculatedStates: {
    aggressorRatio: number;
    imbalance: number;
    intensity: number;
    absorptionDetected: boolean;
  };
  thresholds: {
    aggressorThreshold: number;
    absorptionVolumeMin: number;
    imbalanceThreshold: number;
    intensityNormalization: number;
  };
  evaluationHistory: Array<{
    timestamp: Date;
    aggressorSide: AggressorSide;
    dominanceScore: number;
  }>;
}
