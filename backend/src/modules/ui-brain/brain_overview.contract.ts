/**
 * BRAIN OVERVIEW CONTRACT — User Brain Page v3
 * 
 * Aggregated data pack for institutional UI
 */

// ═══════════════════════════════════════════════════════════════
// INDICATOR TYPES
// ═══════════════════════════════════════════════════════════════

export type IndicatorStatus = 'positive' | 'negative' | 'neutral' | 'warning' | 'nodata';
export type UsdImpact = 'bullish_usd' | 'bearish_usd' | 'neutral';

export interface IndicatorCard {
  key: string;
  title: string;
  value: number | string;
  delta?: number;
  direction?: 'up' | 'down' | 'flat';
  status: IndicatorStatus;
  impact: UsdImpact;
  explanation: string;
  tooltip: string;
  lastUpdate: string;
}

// ═══════════════════════════════════════════════════════════════
// HEALTH STRIP
// ═══════════════════════════════════════════════════════════════

export interface HealthStrip {
  systemGrade: 'PRODUCTION' | 'REVIEW' | 'DEGRADED';
  brainScenario: 'BASE' | 'RISK' | 'TAIL';
  guard: 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK';
  crossAssetRegime: string;
  metaPosture: 'OFFENSIVE' | 'DEFENSIVE' | 'NEUTRAL';
  capitalScalingStatus: string;
  scaleFactor: number;
  determinismHash: string;
}

// ═══════════════════════════════════════════════════════════════
// MACRO ENGINE
// ═══════════════════════════════════════════════════════════════

export interface MacroEngineOutput {
  scoreSigned: number;
  confidence: number;
  dominantRegime: 'EASING' | 'TIGHTENING' | 'STRESS' | 'NEUTRAL';
  persistence: number;
  stabilityScore: number;
  topDrivers: Array<{ name: string; effect: '+' | '-'; weight: number }>;
  weightsTop: Array<{ key: string; weight: number }>;
}

// ═══════════════════════════════════════════════════════════════
// FORECAST
// ═══════════════════════════════════════════════════════════════

export interface HorizonForecast {
  horizon: 30 | 90 | 180 | 365;
  synthetic: number;
  replay: number;
  hybrid: number;
  macroAdjusted: number;
  macroDelta: number;
}

// ═══════════════════════════════════════════════════════════════
// TRANSMISSION
// ═══════════════════════════════════════════════════════════════

export interface TransmissionChannel {
  name: string;
  status: IndicatorStatus;
  explanation: string;
  confidence: number;
}

export interface TransmissionMap {
  inflationChannel: TransmissionChannel;
  ratesChannel: TransmissionChannel;
  flightToQualityChannel: TransmissionChannel;
}

// ═══════════════════════════════════════════════════════════════
// BRAIN DECISION
// ═══════════════════════════════════════════════════════════════

export interface ScenarioProbabilities {
  BASE: number;
  RISK: number;
  TAIL: number;
}

export interface Recommendation {
  action: string;
  reason: string;
  tags: string[];
}

export interface BrainDecisionSection {
  scenarioProbs: ScenarioProbabilities;
  currentScenario: 'BASE' | 'RISK' | 'TAIL';
  posture: 'OFFENSIVE' | 'DEFENSIVE' | 'NEUTRAL';
  maxOverrideCap: number;
  recommendations: Recommendation[];
}

// ═══════════════════════════════════════════════════════════════
// ALLOCATIONS PIPELINE
// ═══════════════════════════════════════════════════════════════

export interface AllocationSnapshot {
  spx: number;
  btc: number;
  cash: number;
}

export interface IntensityBreakdown {
  brain: number;
  metaRiskScale: number;
  optimizer: number;
  capitalScaling: number;
  total: number;
}

export interface AllocationsPipeline {
  base: AllocationSnapshot;
  afterBrain: AllocationSnapshot;
  final: AllocationSnapshot;
  deltas: {
    brainDelta: AllocationSnapshot;
    finalDelta: AllocationSnapshot;
  };
  intensityBreakdown: IntensityBreakdown;
}

// ═══════════════════════════════════════════════════════════════
// CAPITAL SCALING
// ═══════════════════════════════════════════════════════════════

export interface CapitalScalingSection {
  scaleFactor: number;
  mode: 'on' | 'off' | 'shadow';
  volScale: number;
  tailScale: number;
  regimeScale: number;
  guardAdjusted: boolean;
  explanation: string;
  clampsApplied: string[];
}

// ═══════════════════════════════════════════════════════════════
// AUDIT
// ═══════════════════════════════════════════════════════════════

export interface AuditSection {
  inputsHash: string;
  systemVersion: string;
  brainModelId: string;
  macroEngineVersion: string;
  capitalScalingVersion: string;
  frozen: boolean;
  lastPromoteAt?: string;
}

// ═══════════════════════════════════════════════════════════════
// META
// ═══════════════════════════════════════════════════════════════

export interface BrainOverviewMeta {
  asOf: string;
  dataFreshDays: number;
  inputsHash: string;
  systemVersion: string;
  freeze: boolean;
  generatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// MAIN PACK
// ═══════════════════════════════════════════════════════════════

export interface BrainOverviewPack {
  meta: BrainOverviewMeta;
  healthStrip: HealthStrip;
  macroInputs: IndicatorCard[];
  macroEngine: MacroEngineOutput;
  forecastByHorizon: HorizonForecast[];
  transmission: TransmissionMap;
  brainDecision: BrainDecisionSection;
  allocationsPipeline: AllocationsPipeline;
  capitalScaling: CapitalScalingSection;
  audit: AuditSection;
}
