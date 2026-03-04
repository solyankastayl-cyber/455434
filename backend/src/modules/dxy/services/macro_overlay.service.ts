/**
 * MACRO OVERLAY SERVICE — B2
 * 
 * Pure functions for macro → DXY terminal integration.
 * Computes regime, agreement, guards, and adjustments.
 * 
 * RULES:
 * - Does NOT change direction (LONG/SHORT)
 * - Does NOT modify synthetic/replay/hybrid paths
 * - Only adds context, guards, and confidence scaling
 * 
 * ISOLATION: No imports from BTC/SPX modules
 */

import { MacroContext, MacroScore, MacroScoreComponent } from '../../dxy-macro-core/contracts/macro.contracts.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type RatesRegime = 'TIGHTENING' | 'EASING' | 'PAUSE';
export type InflationRegime = 'REHEATING' | 'DISINFLATION' | 'STABLE';
export type CurveRegime = 'INVERTED' | 'STEEP' | 'NORMAL';
export type LaborRegime = 'TIGHT_LABOR' | 'LABOR_STRESS' | 'NORMAL';
export type LiquidityRegime = 'LIQUIDITY_EXPANSION' | 'LIQUIDITY_CONTRACTION' | 'NEUTRAL';

export type MacroRegimeLabel = 
  | 'EASING' 
  | 'TIGHTENING' 
  | 'DISINFLATION' 
  | 'REHEATING' 
  | 'NEUTRAL' 
  | 'STRESS';

export type RiskMode = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
export type Agreement = 'ALIGNED' | 'NEUTRAL' | 'CONFLICT';
export type GuardSeverity = 'INFO' | 'WARN' | 'BLOCK';

export interface MacroRegime {
  label: MacroRegimeLabel;
  riskMode: RiskMode;
  agreementWithSignal: Agreement;
  
  // Individual regimes for transparency
  rates: RatesRegime;
  inflation: InflationRegime;
  curve: CurveRegime;
  labor: LaborRegime;
  liquidity: LiquidityRegime;
}

export interface TradingGuard {
  enabled: boolean;
  reason?: string;
  severity: GuardSeverity;
}

export interface MacroOverlay {
  confidenceMultiplier: number;  // 0.6..1.15
  sizeMultiplier: number;        // B6: 0..1 (affected by guard)
  thresholdShift: number;        // -0.005..+0.01
  tradingGuard: TradingGuard;
}

// B6: Crisis Guard Stress State
export interface StressState {
  creditComposite: number;
  vix: number;
  macroScoreSigned: number;
  triggered: boolean;
  level: 'NONE' | 'WARN' | 'BLOCK';
}

export interface MacroTerminalPack {
  score01: number;
  scoreSigned: number;
  confidence: number;
  components: Array<{
    key: string;
    pressure: number;
    weight: number;
    contribution: number;
  }>;
  regime: MacroRegime;
  overlay: MacroOverlay;
  stress: StressState;  // B6: Crisis Guard
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// B2.1 — REGIME CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Classify Rates Regime from FEDFUNDS
 * 
 * TIGHTENING: delta3m > +0.25 AND delta12m > +0.5
 * EASING: delta3m < -0.25 AND delta12m < -0.5
 * else: PAUSE
 */
export function classifyRatesRegime(
  delta3m: number | undefined,
  delta12m: number | undefined
): RatesRegime {
  const d3 = delta3m ?? 0;
  const d12 = delta12m ?? 0;
  
  if (d3 > 0.25 && d12 > 0.5) return 'TIGHTENING';
  if (d3 < -0.25 && d12 < -0.5) return 'EASING';
  return 'PAUSE';
}

/**
 * Classify Inflation Regime from Core CPI YoY
 * 
 * REHEATING: coreYoY > 3.5% AND rising
 * DISINFLATION: coreYoY < 2.5% AND falling
 * else: STABLE
 */
export function classifyInflationRegime(
  coreYoY: number | undefined,
  delta3m: number | undefined
): InflationRegime {
  const yoy = (coreYoY ?? 0) * 100;  // Convert to percentage
  const d3 = delta3m ?? 0;
  
  if (yoy > 3.5 && d3 > 0) return 'REHEATING';
  if (yoy < 2.5 && d3 < 0) return 'DISINFLATION';
  return 'STABLE';
}

/**
 * Classify Yield Curve Regime from T10Y2Y
 * 
 * INVERTED: < -0.5
 * STEEP: > +0.75
 * else: NORMAL
 */
export function classifyCurveRegime(value: number | undefined): CurveRegime {
  const v = value ?? 0;
  
  if (v < -0.5) return 'INVERTED';
  if (v > 0.75) return 'STEEP';
  return 'NORMAL';
}

/**
 * Classify Labor Regime from UNRATE
 * 
 * TIGHT_LABOR: UNRATE < 4 AND rising
 * LABOR_STRESS: UNRATE > 6 AND rising
 * else: NORMAL
 */
export function classifyLaborRegime(
  unrate: number | undefined,
  delta3m: number | undefined
): LaborRegime {
  const u = unrate ?? 5;
  const d3 = delta3m ?? 0;
  
  if (u < 4 && d3 > 0) return 'TIGHT_LABOR';
  if (u > 6 && d3 > 0) return 'LABOR_STRESS';
  return 'NORMAL';
}

/**
 * Classify Liquidity Regime from M2 YoY
 * 
 * LIQUIDITY_EXPANSION: M2 YoY > 6%
 * LIQUIDITY_CONTRACTION: M2 YoY < 0%
 * else: NEUTRAL
 */
export function classifyLiquidityRegime(m2YoY: number | undefined): LiquidityRegime {
  const yoy = (m2YoY ?? 0) * 100;  // Convert to percentage
  
  if (yoy > 6) return 'LIQUIDITY_EXPANSION';
  if (yoy < 0) return 'LIQUIDITY_CONTRACTION';
  return 'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════════
// B2.2 — RISK MODE AGGREGATION
// ═══════════════════════════════════════════════════════════════

/**
 * Aggregate individual regimes into Risk Mode
 * 
 * RISK_OFF: (TIGHTENING + INVERTED) OR LABOR_STRESS OR LIQUIDITY_CONTRACTION
 * RISK_ON: (EASING + STEEP) OR LIQUIDITY_EXPANSION OR (DISINFLATION + PAUSE)
 * else: NEUTRAL
 */
export function calcRiskMode(
  rates: RatesRegime,
  inflation: InflationRegime,
  curve: CurveRegime,
  labor: LaborRegime,
  liquidity: LiquidityRegime
): RiskMode {
  // RISK_OFF conditions
  if (rates === 'TIGHTENING' && curve === 'INVERTED') return 'RISK_OFF';
  if (labor === 'LABOR_STRESS') return 'RISK_OFF';
  if (liquidity === 'LIQUIDITY_CONTRACTION') return 'RISK_OFF';
  
  // RISK_ON conditions
  if (rates === 'EASING' && curve === 'STEEP') return 'RISK_ON';
  if (liquidity === 'LIQUIDITY_EXPANSION') return 'RISK_ON';
  if (inflation === 'DISINFLATION' && rates === 'PAUSE') return 'RISK_ON';
  
  return 'NEUTRAL';
}

/**
 * Determine primary regime label for display
 */
export function calcRegimeLabel(
  rates: RatesRegime,
  inflation: InflationRegime,
  labor: LaborRegime,
  riskMode: RiskMode
): MacroRegimeLabel {
  // Stress takes priority
  if (labor === 'LABOR_STRESS') return 'STRESS';
  
  // Rate policy dominates
  if (rates === 'TIGHTENING') return 'TIGHTENING';
  if (rates === 'EASING') return 'EASING';
  
  // Inflation secondary
  if (inflation === 'REHEATING') return 'REHEATING';
  if (inflation === 'DISINFLATION') return 'DISINFLATION';
  
  return 'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════════
// B2.3 — AGREEMENT WITH SIGNAL
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate agreement between fractal signal and macro environment
 * 
 * Logic:
 * - Negative macroSigned = dollar weak / risk-on → expect DXY DOWN → SHORT aligned
 * - Positive macroSigned = dollar strong / risk-off → expect DXY UP → LONG aligned
 * 
 * ALIGNED: signal matches macro direction
 * CONFLICT: signal opposes macro direction
 * NEUTRAL: macro is indecisive (|scoreSigned| < 0.1)
 */
export function calcAgreement(
  signalDirection: 'LONG' | 'SHORT' | 'HOLD',
  macroScoreSigned: number
): Agreement {
  // Macro is indecisive
  if (Math.abs(macroScoreSigned) < 0.1) return 'NEUTRAL';
  
  // HOLD doesn't have direction
  if (signalDirection === 'HOLD') return 'NEUTRAL';
  
  // Negative macro = dollar weakness = DXY down = SHORT expected
  // Positive macro = dollar strength = DXY up = LONG expected
  const macroExpects = macroScoreSigned < 0 ? 'SHORT' : 'LONG';
  
  if (signalDirection === macroExpects) return 'ALIGNED';
  return 'CONFLICT';
}

// ═══════════════════════════════════════════════════════════════
// B2.4 — GUARD RULES
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate trading guard based on macro conditions
 * 
 * BLOCK if ALL of:
 * - Yield Curve INVERTED
 * - Rates TIGHTENING
 * - Liquidity CONTRACTION
 * - Macro confidence > 0.6
 * 
 * WARN if:
 * - INVERTED without TIGHTENING
 * - LABOR_STRESS
 * - Macro confidence < 0.3
 */
export function calcTradingGuard(
  rates: RatesRegime,
  curve: CurveRegime,
  labor: LaborRegime,
  liquidity: LiquidityRegime,
  macroConfidence: number
): TradingGuard {
  // BLOCK condition: severe stress scenario
  if (
    curve === 'INVERTED' &&
    rates === 'TIGHTENING' &&
    liquidity === 'LIQUIDITY_CONTRACTION' &&
    macroConfidence > 0.6
  ) {
    return {
      enabled: true,
      severity: 'BLOCK',
      reason: 'Severe macro stress: inverted curve + tightening + liquidity contraction',
    };
  }
  
  // WARN conditions
  const warnings: string[] = [];
  
  if (curve === 'INVERTED' && rates !== 'TIGHTENING') {
    warnings.push('Yield curve inverted');
  }
  
  if (labor === 'LABOR_STRESS') {
    warnings.push('Labor market stress');
  }
  
  if (macroConfidence < 0.3) {
    warnings.push('Low macro data confidence');
  }
  
  if (warnings.length > 0) {
    return {
      enabled: false,
      severity: 'WARN',
      reason: warnings.join('; '),
    };
  }
  
  return {
    enabled: false,
    severity: 'INFO',
  };
}

// ═══════════════════════════════════════════════════════════════
// B2.5 — CONFIDENCE MULTIPLIER
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate confidence multiplier based on agreement and macro confidence
 * 
 * Base:
 * - ALIGNED: 1.10
 * - NEUTRAL: 1.00
 * - CONFLICT: 0.80
 * 
 * Then scale by macro confidence:
 * finalMultiplier = base * (0.8 + 0.2 * macroConfidence)
 * 
 * Clamp: 0.6 - 1.15
 */
export function calcConfidenceMultiplier(
  agreement: Agreement,
  macroConfidence: number
): number {
  // Base multiplier by agreement
  let base: number;
  switch (agreement) {
    case 'ALIGNED': base = 1.10; break;
    case 'NEUTRAL': base = 1.00; break;
    case 'CONFLICT': base = 0.80; break;
    default: base = 1.00;
  }
  
  // Scale by macro confidence
  const confidenceScale = 0.8 + 0.2 * Math.max(0, Math.min(1, macroConfidence));
  const multiplier = base * confidenceScale;
  
  // Clamp
  return Math.max(0.6, Math.min(1.15, Math.round(multiplier * 1000) / 1000));
}

// ═══════════════════════════════════════════════════════════════
// B2.6 — THRESHOLD SHIFT
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate threshold shift based on risk mode
 * 
 * RISK_OFF: +0.005 (require stronger signal)
 * RISK_ON: -0.003 (accept weaker signal)
 * NEUTRAL: 0
 */
export function calcThresholdShift(riskMode: RiskMode): number {
  switch (riskMode) {
    case 'RISK_OFF': return 0.005;
    case 'RISK_ON': return -0.003;
    default: return 0;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN FUNCTION: Build Macro Overlay
// ═══════════════════════════════════════════════════════════════

interface MacroContextMap {
  FEDFUNDS?: MacroContext;
  CPILFESL?: MacroContext;  // Core CPI
  T10Y2Y?: MacroContext;
  UNRATE?: MacroContext;
  M2SL?: MacroContext;
}

/**
 * Build complete macro overlay for DXY terminal
 * 
 * This is a PURE FUNCTION - no side effects, fully deterministic.
 */
export function buildMacroOverlay(
  macroScore: MacroScore,
  contexts: MacroContextMap,
  signalDirection: 'LONG' | 'SHORT' | 'HOLD'
): MacroTerminalPack {
  // Extract contexts
  const fedfunds = contexts.FEDFUNDS;
  const coreCpi = contexts.CPILFESL;
  const curve = contexts.T10Y2Y;
  const unrate = contexts.UNRATE;
  const m2 = contexts.M2SL;
  
  // B2.1: Classify individual regimes
  const ratesRegime = classifyRatesRegime(
    fedfunds?.deltas.delta3m,
    fedfunds?.deltas.delta12m
  );
  
  const inflationRegime = classifyInflationRegime(
    coreCpi?.current.transform === 'yoy' ? coreCpi.current.value : undefined,
    coreCpi?.deltas.delta3m
  );
  
  const curveRegime = classifyCurveRegime(
    curve?.current.value
  );
  
  const laborRegime = classifyLaborRegime(
    unrate?.current.value,
    unrate?.deltas.delta3m
  );
  
  const liquidityRegime = classifyLiquidityRegime(
    m2?.current.transform === 'yoy' ? m2.current.value : undefined
  );
  
  // B2.2: Aggregate to risk mode and label
  const riskMode = calcRiskMode(
    ratesRegime,
    inflationRegime,
    curveRegime,
    laborRegime,
    liquidityRegime
  );
  
  const regimeLabel = calcRegimeLabel(
    ratesRegime,
    inflationRegime,
    laborRegime,
    riskMode
  );
  
  // B2.3: Agreement with signal
  const agreement = calcAgreement(signalDirection, macroScore.scoreSigned);
  
  // Macro confidence (from score quality)
  const macroConfidence = macroScore.confidence === 'HIGH' ? 0.9 :
                          macroScore.confidence === 'MEDIUM' ? 0.6 : 0.3;
  
  // B2.4: Trading guard
  const tradingGuard = calcTradingGuard(
    ratesRegime,
    curveRegime,
    laborRegime,
    liquidityRegime,
    macroConfidence
  );
  
  // B2.5: Confidence multiplier
  const confidenceMultiplier = calcConfidenceMultiplier(agreement, macroConfidence);
  
  // B2.6: Threshold shift
  const thresholdShift = calcThresholdShift(riskMode);
  
  // Build components for transparency
  const components = macroScore.components.map(c => ({
    key: c.seriesId,
    pressure: c.rawPressure,
    weight: c.weight,
    contribution: c.normalizedPressure,
  }));
  
  return {
    score01: macroScore.score01,
    scoreSigned: macroScore.scoreSigned,
    confidence: macroConfidence,
    components,
    regime: {
      label: regimeLabel,
      riskMode,
      agreementWithSignal: agreement,
      rates: ratesRegime,
      inflation: inflationRegime,
      curve: curveRegime,
      labor: laborRegime,
      liquidity: liquidityRegime,
    },
    overlay: {
      confidenceMultiplier,
      thresholdShift,
      tradingGuard,
    },
    updatedAt: new Date().toISOString(),
  };
}
