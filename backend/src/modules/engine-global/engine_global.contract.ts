/**
 * ENGINE GLOBAL — P5.0 Contract
 * 
 * Single endpoint that returns the complete world view:
 * - Global risk mode
 * - Asset allocations (DXY/SPX/BTC)
 * - Evidence and reasoning
 * - Scenario probabilities
 * - What would flip the recommendation
 */

// ═══════════════════════════════════════════════════════════════
// CORE TYPES
// ═══════════════════════════════════════════════════════════════

export type RiskMode = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL' | 'CRISIS';
export type GuardLevel = 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK';
export type LiquidityRegime = 'EXPANSION' | 'CONTRACTION' | 'NEUTRAL';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

// ═══════════════════════════════════════════════════════════════
// INPUT SOURCES (what Engine aggregates)
// ═══════════════════════════════════════════════════════════════

export interface EngineInputSource {
  endpoint: string;
  status: 'OK' | 'FAILED' | 'TIMEOUT';
  latencyMs: number;
  asOf?: string;
}

export interface DxyInput {
  signalSigned: number;      // -1 to +1
  confidence: number;        // 0 to 1
  horizon: string;
  phase: string;
}

export interface MacroInput {
  scoreSigned: number;       // -1 to +1
  score01: number;           // 0 to 1
  confidence: Confidence;
  dominantRegime: string;
  keyDrivers: string[];
}

export interface LiquidityInput {
  impulse: number;           // -3 to +3
  regime: LiquidityRegime;
  confidence: number;
}

export interface GuardInput {
  level: GuardLevel;
  triggered: boolean;
  creditStress: number;
  vix: number;
}

export interface AeInput {
  regime: string;
  regimeConfidence: number;
  noveltyScore: number;
  scenarios: {
    bull: number;
    base: number;
    bear: number;
    dominant: string;
  };
}

export interface CascadeInput {
  asset: 'SPX' | 'BTC';
  sizeMultiplier: number;
  guardCap: number;
  mStress: number;
  mScenario: number;
  mNovel: number;
}

// ═══════════════════════════════════════════════════════════════
// ENGINE OUTPUT CONTRACT
// ═══════════════════════════════════════════════════════════════

export interface EngineAllocation {
  dxySize: number;           // 0 to 1
  spxSize: number;           // 0 to 1
  btcSize: number;           // 0 to 1
  cashSize: number;          // 0 to 1 (residual)
}

export interface EngineDriver {
  id: string;
  name: string;
  contribution: number;      // -1 to +1
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  explanation: string;
}

export interface EngineConflict {
  signal1: string;
  signal2: string;
  description: string;
  resolution: string;
}

export interface EngineFlipCondition {
  condition: string;
  likelihood: 'HIGH' | 'MEDIUM' | 'LOW';
  impact: string;
}

export interface EngineEvidence {
  headline: string;
  summary: string;
  drivers: EngineDriver[];
  conflicts: EngineConflict[];
  whatWouldFlip: EngineFlipCondition[];
  scenarioSummary: {
    bull: { prob: number; description: string };
    base: { prob: number; description: string };
    bear: { prob: number; description: string };
    dominant: string;
  };
}

export interface EngineGlobalState {
  riskMode: RiskMode;
  confidence: Confidence;
  guardLevel: GuardLevel;
  liquidityRegime: LiquidityRegime;
  macroTilt: number;         // -1 to +1
  scenarioDominant: string;
}

export interface EngineInputsSnapshot {
  dxy: DxyInput | null;
  macro: MacroInput | null;
  liquidity: LiquidityInput | null;
  guard: GuardInput | null;
  ae: AeInput | null;
  spxCascade: CascadeInput | null;
  btcCascade: CascadeInput | null;
}

export interface EngineMeta {
  asOf: string;
  version: string;
  sources: EngineInputSource[];
  computedAt: string;
  latencyMs: number;
}

// ═══════════════════════════════════════════════════════════════
// MAIN CONTRACT: GET /api/engine/global
// ═══════════════════════════════════════════════════════════════

// P7.0: Brain integration types
export interface BrainWouldApply {
  spxDelta: number;
  btcDelta: number;
  dxyDelta: number;
  cashDelta: number;
  reasons: string[];
}

export interface BrainSection {
  mode: 'on' | 'off' | 'shadow';
  decision?: any; // BrainOutputPack
  wouldApply?: BrainWouldApply;
}

export interface EngineGlobalResponse {
  ok: boolean;
  meta: EngineMeta;
  global: EngineGlobalState;
  allocations: EngineAllocation;
  inputs: EngineInputsSnapshot;
  evidence: EngineEvidence;
  policy?: any; // PolicyBreakdown from P5.2
  brain?: BrainSection; // P7.0: Brain integration
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const ENGINE_VERSION = '5.0.0';

export const DEFAULT_ALLOCATIONS: EngineAllocation = {
  dxySize: 0,
  spxSize: 0,
  btcSize: 0,
  cashSize: 1,
};

export const GUARD_ALLOCATION_CAPS: Record<GuardLevel, { spx: number; btc: number; dxy: number }> = {
  'NONE': { spx: 1.0, btc: 1.0, dxy: 1.0 },
  'WARN': { spx: 0.75, btc: 0.60, dxy: 0.85 },
  'CRISIS': { spx: 0.35, btc: 0.25, dxy: 0.60 },
  'BLOCK': { spx: 0, btc: 0, dxy: 0 },
};
