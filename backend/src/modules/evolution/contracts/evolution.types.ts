/**
 * EVOLUTION TYPES
 * ===============
 * 
 * Types for self-learning evolution system.
 * 
 * Block 1: Added HealthState and HealthSnapshot types
 * to support health-weighted credibility calculations.
 */

export type Horizon = "1D" | "7D" | "30D";

// Block 1: Health state at forecast creation time
export type HealthState = "HEALTHY" | "DEGRADED" | "CRITICAL";

export type HealthSnapshot = {
  state: HealthState;
  modifier: number;       // 1.0 / 0.6 / 0.3
  ece?: number;           // Expected Calibration Error
  divergence?: number;    // Model divergence metric  
  criticalStreak?: number; // Consecutive critical readings
  capturedAt: string;     // Timestamp of health capture
};

export type Outcome = {
  forecastId: string;
  verdictId: string;
  symbol: string;
  horizon: Horizon;

  entryTs: string;
  resolveAtTs: string;

  entryPrice: number;
  exitPrice: number;

  action: "BUY" | "SELL" | "HOLD";
  realizedReturn: number; // signed
  success: boolean;
  maxDrawdown?: number;

  // Block 1: Health state when forecast was made
  healthState?: HealthState;
  healthSnapshot?: HealthSnapshot;

  computedAt: string;
};

export type CredKey =
  | { kind: "SYMBOL"; symbol: string }
  | { kind: "MODEL"; modelId: string; horizon: Horizon }
  | { kind: "REGIME"; regime: string };

export type CredState = {
  key: CredKey;
  n: number;
  emaScore: number;   // 0..1
  emaReturn: number;  // avg return
  emaDrawdown: number;
  updatedAt: string;
};

console.log('[Evolution] Types loaded');
