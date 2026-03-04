/**
 * SPX MACRO OVERLAY ENGINE
 * 
 * Adjusts SPX Hybrid projection using DXY Macro Final signal
 * 
 * Formula: SPX_final = SPX_hybrid + (β × overlayWeight × DXY_delta)
 * 
 * Where:
 * - β = SPX/DXY sensitivity coefficient (usually negative)
 * - overlayWeight = f(corr, confidence, quality, regime)
 * - DXY_delta = expected DXY move (%)
 * 
 * SPX and DXY are inversely correlated:
 * - DXY BEARISH → positive adjustment to SPX
 * - DXY BULLISH → negative adjustment to SPX
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ProjectionPack {
  horizon: string;
  asOf: string;
  expectedP50: number;
  rangeP10P90: [number, number];
  series: Array<{ t: number; y: number }>;
  confidence: number;
  quality: number;
  dataStatus: 'REAL' | 'FALLBACK' | 'NO_DATA';
}

export interface MacroOverlayMeta {
  corr: number;
  beta: number;
  overlayWeight: number;
  dxyDeltaP50: number;
  spxBaseP50: number;
  adjustmentP50: number;
  adjustedP50: number;
  reasonCodes: string[];
  overlayActive: boolean;
}

export interface MacroOverlayResult {
  adjusted: ProjectionPack;
  baseHybrid: ProjectionPack;
  dxyMacro: ProjectionPack;
  meta: MacroOverlayMeta;
}

export interface CalibrationParams {
  // Correlation thresholds
  minAbsCorr: number;
  
  // Quality/Confidence thresholds
  minQuality: number;
  minConfidence: number;
  
  // Beta bounds
  betaMin: number;
  betaMax: number;
  
  // Maximum adjustment allowed
  maxAdjAbs: number;
  
  // Hard stop conditions
  hardStops: string[];
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT CALIBRATION
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CALIBRATION: CalibrationParams = {
  minAbsCorr: 0.15,
  minQuality: 40,
  minConfidence: 0.45,
  betaMin: -2.0,
  betaMax: 0.5,
  maxAdjAbs: 5.0, // max 5% adjustment
  hardStops: ['SPX_NOT_REAL', 'DXY_NOT_REAL', 'LOW_CORR'],
};

// Beta estimates by horizon (SPX sensitivity to DXY)
// Negative = inverse relationship (typical)
const BETA_BY_HORIZON: Record<string, number> = {
  '7d': -0.35,
  '14d': -0.40,
  '30d': -0.42,
  '90d': -0.45,
  '180d': -0.48,
  '365d': -0.50,
};

// Correlation estimates by horizon
const CORR_BY_HORIZON: Record<string, number> = {
  '7d': -0.28,
  '14d': -0.32,
  '30d': -0.35,
  '90d': -0.38,
  '180d': -0.40,
  '365d': -0.42,
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY WEIGHT CALCULATION
// ═══════════════════════════════════════════════════════════════

function computeOverlayWeight(params: {
  corr: number;
  spxConf: number;
  dxyConf: number;
  spxQuality: number;
  dxyQuality: number;
  regimeConfidence?: number;
  calibration: CalibrationParams;
}): number {
  const { corr, spxConf, dxyConf, spxQuality, dxyQuality, regimeConfidence = 0.5, calibration } = params;
  
  // wCorr: how strong is correlation signal
  const absCorr = Math.abs(corr);
  const wCorr = absCorr < calibration.minAbsCorr 
    ? 0 
    : clamp((absCorr - calibration.minAbsCorr) / (1 - calibration.minAbsCorr), 0, 1);
  
  // wConf: minimum of both confidences
  const wConf = Math.min(spxConf, dxyConf);
  
  // wQuality: average quality normalized
  const wQuality = Math.min(spxQuality, dxyQuality) / 100;
  
  // wRegime: regime confidence boost/penalty
  const wRegime = clamp(regimeConfidence, 0.3, 1.0);
  
  // Final weight
  const w = wCorr * wConf * wQuality * wRegime;
  
  return clamp(w, 0, 1);
}

// ═══════════════════════════════════════════════════════════════
// SERIES ADJUSTMENT
// ═══════════════════════════════════════════════════════════════

function adjustSeries(
  series: Array<{ t: number; y: number }>,
  adjustmentPct: number
): Array<{ t: number; y: number }> {
  if (!series || series.length === 0) return series;
  
  // Apply proportional adjustment to each point
  const baseY = series[0]?.y || 100;
  const adjustmentFactor = 1 + (adjustmentPct / 100);
  
  return series.map((point, idx) => {
    // Gradual application of adjustment over time
    const progress = idx / (series.length - 1);
    const currentAdjustment = progress * (adjustmentFactor - 1);
    
    return {
      t: point.t,
      y: point.y * (1 + currentAdjustment),
    };
  });
}

function adjustRange(
  range: [number, number],
  adjustmentPct: number
): [number, number] {
  return [
    round2(range[0] + adjustmentPct * 0.8), // P10 slightly less adjusted
    round2(range[1] + adjustmentPct * 1.0), // P90 fully adjusted
  ];
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENGINE
// ═══════════════════════════════════════════════════════════════

export function buildMacroOverlaySPX(
  spxHybrid: ProjectionPack,
  dxyMacro: ProjectionPack,
  macroContext?: { regimeConfidence?: number },
  calibration: CalibrationParams = DEFAULT_CALIBRATION
): MacroOverlayResult {
  const reasonCodes: string[] = [];
  
  // 1) Data guards
  if (spxHybrid.dataStatus !== 'REAL') reasonCodes.push('SPX_NOT_REAL');
  if (dxyMacro.dataStatus !== 'REAL') reasonCodes.push('DXY_NOT_REAL');
  
  // 2) Quality/Confidence guards
  const spxQ = spxHybrid.quality ?? 0;
  const dxyQ = dxyMacro.quality ?? 0;
  const spxC = spxHybrid.confidence ?? 0;
  const dxyC = dxyMacro.confidence ?? 0;
  
  if (spxQ < calibration.minQuality) reasonCodes.push('SPX_LOW_QUALITY');
  if (dxyQ < calibration.minQuality) reasonCodes.push('DXY_LOW_QUALITY');
  if (spxC < calibration.minConfidence) reasonCodes.push('SPX_LOW_CONF');
  if (dxyC < calibration.minConfidence) reasonCodes.push('DXY_LOW_CONF');
  
  // 3) Get beta and correlation for horizon
  const horizon = spxHybrid.horizon.toLowerCase();
  const beta = clamp(
    BETA_BY_HORIZON[horizon] ?? -0.42,
    calibration.betaMin,
    calibration.betaMax
  );
  const corr = CORR_BY_HORIZON[horizon] ?? -0.35;
  
  if (Math.abs(corr) < calibration.minAbsCorr) reasonCodes.push('LOW_CORR');
  
  // 4) Calculate overlay weight
  let overlayWeight = computeOverlayWeight({
    corr,
    spxConf: spxC,
    dxyConf: dxyC,
    spxQuality: spxQ,
    dxyQuality: dxyQ,
    regimeConfidence: macroContext?.regimeConfidence,
    calibration,
  });
  
  // 5) Hard stops
  const hasHardStop = reasonCodes.some(rc => calibration.hardStops.includes(rc));
  if (hasHardStop) {
    overlayWeight = 0;
    reasonCodes.push('OVERLAY_DISABLED');
  }
  
  // 6) Calculate adjustment
  const dxyDelta = dxyMacro.expectedP50; // % expected DXY move
  const spxBase = spxHybrid.expectedP50;
  
  // Formula: adjustment = weight * beta * dxyDelta
  // If beta negative and dxyDelta negative (DXY bearish) → adjustment positive (SPX bullish)
  const rawAdjustment = overlayWeight * beta * dxyDelta;
  const adjustment = clamp(rawAdjustment, -calibration.maxAdjAbs, calibration.maxAdjAbs);
  
  const adjustedP50 = round2(spxBase + adjustment);
  
  // 7) Adjust range and series
  const adjustedRange = adjustRange(spxHybrid.rangeP10P90, adjustment);
  const adjustedSeries = adjustSeries(spxHybrid.series, adjustment);
  
  // 8) Adjust confidence (reduce if overlay weak)
  const adjustedConfidence = spxC * (0.7 + 0.3 * overlayWeight);
  
  // 9) Build adjusted pack
  const adjusted: ProjectionPack = {
    ...spxHybrid,
    expectedP50: adjustedP50,
    rangeP10P90: adjustedRange,
    series: adjustedSeries,
    confidence: round2(adjustedConfidence),
    quality: Math.round((spxQ + dxyQ) / 2),
  };
  
  return {
    adjusted,
    baseHybrid: spxHybrid,
    dxyMacro,
    meta: {
      corr: round2(corr),
      beta: round2(beta),
      overlayWeight: round2(overlayWeight),
      dxyDeltaP50: round2(dxyDelta),
      spxBaseP50: round2(spxBase),
      adjustmentP50: round2(adjustment),
      adjustedP50,
      reasonCodes,
      overlayActive: overlayWeight > 0 && !hasHardStop,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  buildMacroOverlaySPX,
  DEFAULT_CALIBRATION,
  BETA_BY_HORIZON,
  CORR_BY_HORIZON,
};
