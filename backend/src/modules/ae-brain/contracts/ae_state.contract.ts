/**
 * C1 — State Vector Contract
 * Global state aggregator for AE Brain
 * P2.4.3: Added liquidityImpulse axis
 */

export interface AeStateVector {
  asOf: string;                    // YYYY-MM-DD
  vector: {
    macroSigned: number;           // [-1..1] macro regime direction
    macroConfidence: number;       // [0..1] macro confidence
    guardLevel: number;            // [0..1] NONE=0, WARN=0.33, CRISIS=0.66, BLOCK=1.0
    dxySignalSigned: number;       // [-1..1] DXY direction signal
    dxyConfidence: number;         // [0..1] DXY confidence
    regimeBias90d: number;         // [-1..1] 90-day regime bias
    liquidityImpulse: number;      // [-1..1] P2.4.3 — Fed liquidity impulse
  };
  health: {
    ok: boolean;
    missing: string[];
  };
  // P2.4.3: Liquidity details
  liquidity?: {
    impulse: number;               // Raw impulse (-3..+3)
    regime: string;                // EXPANSION | NEUTRAL | CONTRACTION
    confidence: number;            // 0..1
  };
}

// Guard level numeric mapping
export const GUARD_LEVEL_MAP: Record<string, number> = {
  'NONE': 0,
  'WARN': 0.33,
  'CRISIS': 0.66,
  'BLOCK': 1.0,
};

// Action to signed signal
export const ACTION_SIGN_MAP: Record<string, number> = {
  'LONG': 1,
  'SHORT': -1,
  'HOLD': 0,
};
