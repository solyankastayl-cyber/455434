/**
 * MACRO ENGINE INTERFACE — Unified contract for V1 and V2
 * 
 * V1 = Linear Macro Adjustment (baseline, stable)
 * V2 = Regime State Engine (Markov/persistence/gold)
 * 
 * UI renders overlay the same way, regardless of engine version.
 */

// ═══════════════════════════════════════════════════════════════
// ENGINE VERSION
// ═══════════════════════════════════════════════════════════════

export type MacroEngineVersion = 'v1' | 'v2';

// ═══════════════════════════════════════════════════════════════
// REGIME TYPES
// ═══════════════════════════════════════════════════════════════

export type MacroRegime = 
  | 'EASING' 
  | 'TIGHTENING' 
  | 'STRESS' 
  | 'NEUTRAL' 
  | 'NEUTRAL_MIXED'
  | 'RISK_ON'
  | 'RISK_OFF';

// ═══════════════════════════════════════════════════════════════
// COMPONENT ROLES (includes gold)
// ═══════════════════════════════════════════════════════════════

export type MacroRole = 
  | 'rates' 
  | 'inflation' 
  | 'labor' 
  | 'curve' 
  | 'liquidity' 
  | 'credit'
  | 'gold'           // NEW: Gold as exogenous signal
  | 'growth';

// ═══════════════════════════════════════════════════════════════
// HORIZON
// ═══════════════════════════════════════════════════════════════

export type MacroHorizon = '7D' | '14D' | '30D' | '90D' | '180D' | '365D';

// ═══════════════════════════════════════════════════════════════
// PATH POINT (for overlay)
// ═══════════════════════════════════════════════════════════════

export interface MacroPathPoint {
  t: number;
  price: number;
  ret?: number;
}

// ═══════════════════════════════════════════════════════════════
// HORIZON OVERLAY (unified format for chart)
// ═══════════════════════════════════════════════════════════════

export interface HorizonOverlay {
  horizon: MacroHorizon;
  hybridEndReturn: number;
  macroEndReturn: number;
  delta: number;              // macro - hybrid
  path?: MacroPathPoint[];    // ready for chart
}

// ═══════════════════════════════════════════════════════════════
// DRIVER COMPONENT
// ═══════════════════════════════════════════════════════════════

export interface MacroDriverComponent {
  key: string;                // "T10Y2Y" | "FEDFUNDS" | "GOLD"
  displayName: string;
  role: MacroRole;
  weight: number;             // current weight
  corr?: number;              // correlation with DXY (diagnostic)
  lagDays?: number;           // optimal lag
  valueNow?: number;          // normalized value (z-score)
  contribution?: number;      // contribution to scoreSigned
  tooltip?: string;
}

// ═══════════════════════════════════════════════════════════════
// GUARD
// ═══════════════════════════════════════════════════════════════

export type GuardLevel = 'NONE' | 'SOFT' | 'HARD';

export interface MacroGuard {
  level: GuardLevel;
  reasonCodes: string[];
}

// ═══════════════════════════════════════════════════════════════
// DATA COVERAGE (for diagnostics)
// ═══════════════════════════════════════════════════════════════

export interface SeriesCoverage {
  points: number;
  from: string;
  to: string;
  staleDays?: number;
}

// ═══════════════════════════════════════════════════════════════
// MACRO PACK — Unified response (V1 and V2 same structure)
// ═══════════════════════════════════════════════════════════════

export interface MacroPack {
  engineVersion: MacroEngineVersion;
  
  // Overlay for chart (unified format)
  overlay: {
    horizons: HorizonOverlay[];
  };
  
  // Regime state
  regime: {
    dominant: MacroRegime;
    confidence: number;       // 0..1
    probs: Record<MacroRegime, number>;
    persistence?: number;     // v2 only: stay probability
    transitionHint?: string;  // v2 only: likely next regime
  };
  
  // Drivers (scoreSigned decomposition)
  drivers: {
    scoreSigned: number;
    confidenceMultiplier: number;
    regimeBoost: number;
    components: MacroDriverComponent[];
  };
  
  // Guard
  guard: MacroGuard;
  
  // Metadata
  meta: {
    asOf: string;
    dataCoverage: Record<string, SeriesCoverage>;
    processingTimeMs?: number;
    stateInfo?: {
      entropy: number;
      changeCount30D: number;
      lastChangeAt?: string;
      weightsSource: string;
      volScale?: number;
    };
  };
  
  // Engine-specific internals (for debugging)
  internals?: {
    v1?: {
      kappa: number;
      boost: number;
      rawAdjustment: number;
    };
    v2?: {
      transitionMatrix?: number[][];
      stationaryDist?: Record<MacroRegime, number>;
      goldSignal?: {
        z120: number;
        ret30: number;
        ret90: number;
        flightToQuality: boolean;
      };
    };
  };
}

// ═══════════════════════════════════════════════════════════════
// MACRO ENGINE INTERFACE (both V1 and V2 implement this)
// ═══════════════════════════════════════════════════════════════

export interface IMacroEngine {
  version: MacroEngineVersion;
  
  /**
   * Compute macro pack for given asset and horizon
   */
  computePack(params: {
    asset: 'DXY' | 'SPX' | 'BTC';
    horizon: MacroHorizon;
    hybridEndReturn: number;
    hybridPath?: MacroPathPoint[];
  }): Promise<MacroPack>;
  
  /**
   * Get current regime state
   */
  getRegimeState(): Promise<{
    regime: MacroRegime;
    confidence: number;
    probs: Record<MacroRegime, number>;
  }>;
  
  /**
   * Get driver components
   */
  getDrivers(): Promise<MacroDriverComponent[]>;
  
  /**
   * Health check
   */
  healthCheck(): Promise<{ ok: boolean; issues: string[] }>;
}

// ═══════════════════════════════════════════════════════════════
// ENGINE CONFIG
// ═══════════════════════════════════════════════════════════════

export interface MacroEngineConfig {
  defaultEngine: MacroEngineVersion;
  autoSwitch: boolean;        // auto-switch to v2 if conditions met
  v2MinConfidence: number;    // minimum confidence to use v2
  v2MinDataPoints: number;    // minimum data points for v2
}

export const DEFAULT_ENGINE_CONFIG: MacroEngineConfig = {
  defaultEngine: 'v1',
  autoSwitch: true,
  v2MinConfidence: 0.6,
  v2MinDataPoints: 500,
};
