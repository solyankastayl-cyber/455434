/**
 * BRAIN v4 — DECISION ENGINE SERVICE
 * 
 * Transforms raw data into actionable intelligence.
 * Brain answers: Where are we? What to do? Why? How confident?
 */

import { getEngineGlobalWithBrain } from '../engine-global/engine_global_brain_bridge.service.js';
import { getVersionInfo, SYSTEM_VERSION, SYSTEM_FREEZE, CAPITAL_SCALING_VERSION } from '../../core/version.js';
import { getLatestMacroPoint } from '../dxy-macro-core/ingest/macro.ingest.service.js';
import { computeMacroScore } from '../dxy-macro-core/services/macro_score.service.js';
import type {
  BrainDecisionPack,
  MarketVerdict,
  ActionRecommendation,
  Reason,
  HorizonPhase,
  RiskMap,
  CausalChain,
  MacroIndicatorSummary,
  AllocationPipeline,
  CapitalScalingSummary,
  ModelTransparency,
  ModelDecomposition,
  MarketRegime,
  MarketBias,
  MarketPosture,
  ReasonSentiment,
  PhaseStrength,
} from './brain_decision.contract.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function computeInputsHash(data: any): string {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}

// ═══════════════════════════════════════════════════════════════
// VERDICT BUILDER
// ═══════════════════════════════════════════════════════════════

function buildVerdict(engineData: any, macroScore: any): MarketVerdict {
  const brainDecision = engineData?.brainDecision;
  const scenarioProbs = brainDecision?.scenarioProbs || { BASE: 60, RISK: 30, TAIL: 10 };
  const posture = brainDecision?.posture || 'NEUTRAL';
  
  // Determine regime from scenario probabilities
  let regime: MarketRegime = 'NEUTRAL_MIXED';
  if (scenarioProbs.TAIL > 30) regime = 'CRISIS';
  else if (scenarioProbs.RISK > 50) regime = 'RISK_OFF';
  else if (scenarioProbs.BASE > 70) regime = 'NEUTRAL';
  
  // Determine bias from macro and forecasts
  const macroScoreSigned = macroScore?.score?.scoreSigned ?? 0;
  const horizons = engineData?.forecastByHorizon || [];
  const h90 = horizons.find((h: any) => h.horizon === 90);
  const hybridSignal = h90?.hybrid ?? 0;
  
  let dominantBias: MarketBias = 'NEUTRAL';
  if (hybridSignal > 5 && macroScoreSigned >= -0.2) dominantBias = 'BULLISH';
  else if (hybridSignal < -5 || macroScoreSigned < -0.3) dominantBias = 'BEARISH';
  
  // Calculate confidence
  const baseProb = scenarioProbs.BASE / 100;
  const macroConfidence = macroScore?.score?.confidence ?? 50;
  const confidence = Math.round((baseProb * 0.4 + macroConfidence / 100 * 0.6) * 100);
  
  return {
    regime,
    dominantBias,
    posture: posture as MarketPosture,
    confidence: Math.min(95, Math.max(20, confidence)),
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTION BUILDER
// ═══════════════════════════════════════════════════════════════

function buildAction(verdict: MarketVerdict, engineData: any): ActionRecommendation {
  const capitalScaling = engineData?.capitalScaling;
  const scaleFactor = capitalScaling?.scaleFactor ?? 1.0;
  
  // Determine primary action based on verdict
  let primary: string;
  let multiplier: number;
  let cashBuffer: string;
  let leverage: boolean = false;
  
  if (verdict.regime === 'CRISIS') {
    primary = 'Move to defensive positioning immediately';
    multiplier = 0.50;
    cashBuffer = '40-50%';
  } else if (verdict.regime === 'RISK_OFF') {
    primary = 'Reduce exposure and increase cash buffer';
    multiplier = 0.70;
    cashBuffer = '25-35%';
  } else if (verdict.posture === 'DEFENSIVE') {
    primary = 'Maintain defensive stance with limited risk';
    multiplier = 0.85;
    cashBuffer = '20-30%';
  } else if (verdict.posture === 'OFFENSIVE' && verdict.dominantBias === 'BULLISH') {
    primary = 'Increase risk exposure selectively';
    multiplier = 1.15;
    cashBuffer = '10-15%';
  } else if (verdict.dominantBias === 'BULLISH') {
    primary = 'Maintain balanced exposure with selective risk additions';
    multiplier = 1.00;
    cashBuffer = '15-20%';
  } else if (verdict.dominantBias === 'BEARISH') {
    primary = 'Reduce risk exposure gradually';
    multiplier = 0.85;
    cashBuffer = '25-30%';
  } else {
    primary = 'No clear edge. Maintain capital discipline.';
    multiplier = 1.00;
    cashBuffer = '15-20%';
  }
  
  // Adjust multiplier by capital scaling
  multiplier = round2(multiplier * scaleFactor);
  
  return {
    primary,
    multiplier,
    cashBufferRange: cashBuffer,
    leverageRecommended: leverage,
  };
}

// ═══════════════════════════════════════════════════════════════
// REASONS BUILDER
// ═══════════════════════════════════════════════════════════════

async function buildReasons(macroData: any, engineData: any, macroScore: any): Promise<Reason[]> {
  const reasons: Reason[] = [];
  
  // Inflation
  const cpi = macroData.cpiYoY ?? 2.5;
  if (cpi < 3) {
    reasons.push({
      text: `Inflation contained (${cpi.toFixed(1)}%)`,
      sentiment: 'supportive',
      indicator: 'inflation',
    });
  } else if (cpi > 4) {
    reasons.push({
      text: `Inflation elevated (${cpi.toFixed(1)}%)`,
      sentiment: 'risk',
      indicator: 'inflation',
    });
  } else {
    reasons.push({
      text: `Inflation moderate (${cpi.toFixed(1)}%)`,
      sentiment: 'neutral',
      indicator: 'inflation',
    });
  }
  
  // USD / Fed Funds
  const fedRate = macroData.fedRate ?? 3.64;
  if (fedRate < 3) {
    reasons.push({
      text: 'Fed accommodative, USD pressure down',
      sentiment: 'supportive',
      indicator: 'fed_rate',
    });
  } else if (fedRate > 5) {
    reasons.push({
      text: 'Fed tight, USD strength pressure',
      sentiment: 'risk',
      indicator: 'fed_rate',
    });
  } else {
    reasons.push({
      text: 'USD stable, no tightening impulse',
      sentiment: 'neutral',
      indicator: 'fed_rate',
    });
  }
  
  // Credit stress
  const creditSpread = macroData.creditSpread ?? 1.73;
  if (creditSpread < 2) {
    reasons.push({
      text: 'Credit stress muted',
      sentiment: 'supportive',
      indicator: 'credit_spread',
    });
  } else if (creditSpread > 3) {
    reasons.push({
      text: 'Credit spreads widening',
      sentiment: 'risk',
      indicator: 'credit_spread',
    });
  }
  
  // Volatility
  const capitalScaling = engineData?.capitalScaling;
  const volScale = capitalScaling?.volScale ?? 1.0;
  if (volScale > 0.9) {
    reasons.push({
      text: 'Volatility within normal range',
      sentiment: 'supportive',
    });
  } else if (volScale < 0.7) {
    reasons.push({
      text: 'Volatility elevated',
      sentiment: 'risk',
    });
  }
  
  // Tail risk
  const tailScale = capitalScaling?.tailScale ?? 1.0;
  if (tailScale > 0.9) {
    reasons.push({
      text: 'Tail probability limited',
      sentiment: 'supportive',
    });
  } else if (tailScale < 0.7) {
    reasons.push({
      text: 'Tail risk elevated',
      sentiment: 'risk',
    });
  }
  
  // Limit to 5 reasons
  return reasons.slice(0, 5);
}

// ═══════════════════════════════════════════════════════════════
// HORIZONS BUILDER
// ═══════════════════════════════════════════════════════════════

function buildHorizons(engineData: any): HorizonPhase[] {
  const forecasts = engineData?.forecastByHorizon || [];
  
  return [30, 90, 180, 365].map(h => {
    const forecast = forecasts.find((f: any) => f.horizon === h);
    const hybrid = forecast?.hybrid ?? 0;
    const macroAdj = forecast?.macroAdjusted ?? hybrid;
    
    // Determine phase
    let phase: MarketBias = 'NEUTRAL';
    if (macroAdj > 5) phase = 'BULLISH';
    else if (macroAdj < -5) phase = 'BEARISH';
    
    // Determine strength
    let strength: PhaseStrength = 'weak';
    const absSignal = Math.abs(macroAdj);
    if (absSignal > 15) strength = 'strong';
    else if (absSignal > 8) strength = 'medium';
    
    // Confidence based on signal strength
    const confidence = Math.min(90, 40 + absSignal * 2);
    
    return {
      horizon: h as 30 | 90 | 180 | 365,
      phase,
      strength,
      confidence: Math.round(confidence),
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// RISK MAP BUILDER
// ═══════════════════════════════════════════════════════════════

function buildRiskMap(engineData: any): RiskMap {
  const capitalScaling = engineData?.capitalScaling;
  const healthStrip = engineData?.healthStrip;
  
  const volScale = capitalScaling?.volScale ?? 1.0;
  const tailScale = capitalScaling?.tailScale ?? 1.0;
  const scaleFactor = capitalScaling?.scaleFactor ?? 1.0;
  const guard = healthStrip?.guard || 'NONE';
  
  // Volatility regime
  let volatilityRegime: 'low' | 'normal' | 'elevated' | 'extreme' = 'normal';
  if (volScale > 1.1) volatilityRegime = 'low';
  else if (volScale < 0.7) volatilityRegime = 'extreme';
  else if (volScale < 0.85) volatilityRegime = 'elevated';
  
  // Tail risk
  let tailRisk: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (tailScale < 0.5) tailRisk = 'critical';
  else if (tailScale < 0.7) tailRisk = 'high';
  else if (tailScale < 0.9) tailRisk = 'medium';
  
  // Guard status
  const guardMap: Record<string, 'none' | 'warn' | 'block' | 'crisis'> = {
    'NONE': 'none',
    'WARN': 'warn',
    'BLOCK': 'block',
    'CRISIS': 'crisis',
  };
  
  // Override intensity (from brain decision)
  const brainDecision = engineData?.brainDecision;
  const overrideIntensity = brainDecision?.maxOverrideCap ?? 0;
  
  return {
    volatilityRegime,
    tailRisk,
    guardStatus: guardMap[guard] || 'none',
    overrideIntensity: round2(overrideIntensity * 100),
    capitalScaling: round2(scaleFactor * 100),
  };
}

// ═══════════════════════════════════════════════════════════════
// CAUSAL FLOW BUILDER
// ═══════════════════════════════════════════════════════════════

function buildCausalFlow(macroData: any, macroScore: any): CausalChain[] {
  const chains: CausalChain[] = [];
  
  // SPX Chain: Inflation → Rates → USD → SPX
  const cpi = macroData.cpiYoY ?? 2.5;
  const fedRate = macroData.fedRate ?? 3.64;
  
  const inflationToRates: 'positive' | 'negative' | 'neutral' = cpi > 3 ? 'positive' : cpi < 2 ? 'negative' : 'neutral';
  const ratesToUsd: 'positive' | 'negative' | 'neutral' = fedRate > 4 ? 'positive' : fedRate < 2 ? 'negative' : 'neutral';
  const usdToSpx: 'positive' | 'negative' | 'neutral' = fedRate > 4.5 ? 'negative' : fedRate < 3 ? 'positive' : 'neutral';
  
  chains.push({
    id: 'spx_macro_chain',
    links: [
      { from: 'Inflation', to: 'Rates', direction: inflationToRates, strength: 0.7 },
      { from: 'Rates', to: 'USD', direction: ratesToUsd, strength: 0.8 },
      { from: 'USD', to: 'SPX', direction: usdToSpx, strength: 0.6 },
    ],
    targetAsset: 'SPX',
    netEffect: usdToSpx,
  });
  
  // BTC Chain: Liquidity → BTC, Credit Stress → BTC
  const creditSpread = macroData.creditSpread ?? 1.73;
  const liquidityEffect: 'positive' | 'negative' | 'neutral' = 'neutral'; // Need M2 data
  const creditToBtc: 'positive' | 'negative' | 'neutral' = creditSpread > 2.5 ? 'negative' : creditSpread < 1.5 ? 'positive' : 'neutral';
  
  chains.push({
    id: 'btc_liquidity_chain',
    links: [
      { from: 'Liquidity', to: 'BTC', direction: liquidityEffect, strength: 0.5 },
      { from: 'Credit Stress', to: 'BTC', direction: creditToBtc, strength: 0.6 },
    ],
    targetAsset: 'BTC',
    netEffect: creditToBtc,
  });
  
  return chains;
}

// ═══════════════════════════════════════════════════════════════
// MACRO SUMMARY BUILDER
// ═══════════════════════════════════════════════════════════════

function buildMacroSummary(macroData: any): MacroIndicatorSummary[] {
  const summary: MacroIndicatorSummary[] = [];
  
  // Fed Funds Rate
  const fedRate = macroData.fedRate;
  if (fedRate !== null) {
    summary.push({
      key: 'fed_rate',
      title: 'Fed Funds Rate',
      currentValue: `${fedRate.toFixed(2)}%`,
      status: fedRate > 5 ? 'risk' : fedRate > 3 ? 'neutral' : 'supportive',
      interpretation: fedRate > 5 ? 'Tight policy' : fedRate > 3 ? 'Moderately tight' : 'Accommodative',
      normalRange: '2-4%',
      riskRange: '>5%',
      bullishCondition: 'Falling below 3%',
      bearishCondition: 'Rising above 5%',
      usdImpact: 'Higher rates = stronger USD',
      spxImpact: 'High rates pressure multiples',
      btcImpact: 'High rates = negative for BTC',
    });
  }
  
  // CPI
  const cpi = macroData.cpiYoY;
  if (cpi !== null) {
    summary.push({
      key: 'inflation',
      title: 'Inflation (CPI YoY)',
      currentValue: `${cpi.toFixed(1)}%`,
      status: cpi > 4 ? 'risk' : cpi > 2.5 ? 'neutral' : 'supportive',
      interpretation: cpi > 4 ? 'Elevated' : cpi > 2.5 ? 'Above target' : 'Near target',
      normalRange: '2-3%',
      riskRange: '>4%',
      bullishCondition: 'Falling below 3%',
      bearishCondition: 'Accelerating above 4%',
      usdImpact: 'High inflation = tightening pressure',
      spxImpact: 'High inflation compresses multiples',
      btcImpact: 'Moderate inflation = BTC hedge narrative',
    });
  }
  
  // Unemployment
  const unrate = macroData.unemployment;
  if (unrate !== null) {
    summary.push({
      key: 'unemployment',
      title: 'Unemployment Rate',
      currentValue: `${unrate.toFixed(1)}%`,
      status: unrate > 5 ? 'risk' : unrate > 4 ? 'neutral' : 'supportive',
      interpretation: unrate > 5 ? 'Rising joblessness' : unrate < 4 ? 'Tight labor' : 'Moderate',
      normalRange: '3.5-4.5%',
      riskRange: '>5.5%',
      bullishCondition: 'Stable below 4%',
      bearishCondition: 'Rising above 5%',
      usdImpact: 'Low unemployment = hawkish Fed',
      spxImpact: 'Low unemployment supports earnings',
      btcImpact: 'Indirect via risk sentiment',
    });
  }
  
  // Yield Curve
  const yieldSpread = macroData.yieldSpread;
  if (yieldSpread !== null) {
    const spreadBp = Math.round(yieldSpread * 100);
    summary.push({
      key: 'yield_curve',
      title: 'Yield Curve (10Y-2Y)',
      currentValue: `${spreadBp}bp`,
      status: yieldSpread < 0 ? 'risk' : yieldSpread < 0.5 ? 'neutral' : 'supportive',
      interpretation: yieldSpread < 0 ? 'Inverted - recession signal' : yieldSpread < 0.5 ? 'Flattening' : 'Normal',
      normalRange: '50-150bp',
      riskRange: '<0bp (inverted)',
      bullishCondition: 'Steepening above 100bp',
      bearishCondition: 'Inversion below 0bp',
      usdImpact: 'Inversion = eventual easing',
      spxImpact: 'Inversion leads recession 12-18mo',
      btcImpact: 'Steepening = risk-on',
    });
  }
  
  // Credit Spreads
  const creditSpread = macroData.creditSpread;
  if (creditSpread !== null) {
    summary.push({
      key: 'credit_spread',
      title: 'Credit Spreads (BAA-10Y)',
      currentValue: `${Math.round(creditSpread * 100)}bp`,
      status: creditSpread > 3 ? 'risk' : creditSpread > 2 ? 'neutral' : 'supportive',
      interpretation: creditSpread > 3 ? 'Stress elevated' : creditSpread > 2 ? 'Above normal' : 'Healthy',
      normalRange: '150-250bp',
      riskRange: '>300bp',
      bullishCondition: 'Compressing below 200bp',
      bearishCondition: 'Widening above 300bp',
      usdImpact: 'Wide spreads = risk-off USD bid',
      spxImpact: 'Wide spreads pressure equities',
      btcImpact: 'Wide spreads = BTC selloff',
    });
  }
  
  // Housing
  const housing = macroData.housingStarts;
  if (housing !== null) {
    summary.push({
      key: 'housing',
      title: 'Housing Starts',
      currentValue: `${Math.round(housing)}K`,
      status: housing > 1500 ? 'supportive' : housing < 1200 ? 'risk' : 'neutral',
      interpretation: housing > 1500 ? 'Strong activity' : housing < 1200 ? 'Weak activity' : 'Moderate',
      normalRange: '1200-1600K',
      riskRange: '<1000K',
      bullishCondition: 'Rising above 1400K',
      bearishCondition: 'Falling below 1100K',
      usdImpact: 'Indirect via growth',
      spxImpact: 'Housing leads consumer spending',
      btcImpact: 'Indirect via risk sentiment',
    });
  }
  
  return summary;
}

// ═══════════════════════════════════════════════════════════════
// ALLOCATION BUILDER
// ═══════════════════════════════════════════════════════════════

function buildAllocation(engineData: any): AllocationPipeline {
  const allocs = engineData?.allocationsPipeline;
  
  const base = allocs?.base || { spx: 60, btc: 20, cash: 20 };
  const afterBrain = allocs?.afterBrain || base;
  const final = allocs?.final || afterBrain;
  
  const brainDelta = {
    spx: afterBrain.spx - base.spx,
    btc: afterBrain.btc - base.btc,
    cash: afterBrain.cash - base.cash,
  };
  
  const finalDelta = {
    spx: final.spx - afterBrain.spx,
    btc: final.btc - afterBrain.btc,
    cash: final.cash - afterBrain.cash,
  };
  
  // Calculate impacts
  const brainImpact = round2(Math.abs(brainDelta.spx) + Math.abs(brainDelta.btc));
  const totalChange = round2(Math.abs(final.spx - base.spx) + Math.abs(final.btc - base.btc));
  const scalingImpact = round2(Math.abs(finalDelta.spx) + Math.abs(finalDelta.btc));
  
  let explanation = 'Allocations stable';
  if (scalingImpact > 5) {
    explanation = 'Volatility above target → exposure reduced';
  } else if (brainImpact > 5) {
    explanation = 'Macro regime shift → allocation adjusted';
  }
  
  return {
    base,
    afterBrain,
    final,
    impact: {
      brainImpact,
      optimizerImpact: 0,
      scalingImpact,
      explanation,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// CAPITAL SCALING BUILDER
// ═══════════════════════════════════════════════════════════════

function buildCapitalScaling(engineData: any): CapitalScalingSummary {
  const cs = engineData?.capitalScaling;
  
  const scaleFactor = cs?.scaleFactor ?? 1.0;
  const volScale = cs?.volScale ?? 1.0;
  const tailScale = cs?.tailScale ?? 1.0;
  const regimeScale = cs?.regimeScale ?? 1.0;
  
  const drivers = [
    {
      name: 'Volatility Scale',
      value: round2(volScale * 100),
      effect: volScale > 0.95 ? 'neutral' as const : volScale > 0.8 ? 'reduce' as const : 'reduce' as const,
    },
    {
      name: 'Tail Risk Scale',
      value: round2(tailScale * 100),
      effect: tailScale > 0.95 ? 'neutral' as const : tailScale > 0.8 ? 'reduce' as const : 'reduce' as const,
    },
    {
      name: 'Regime Scale',
      value: round2(regimeScale * 100),
      effect: regimeScale > 0.95 ? 'neutral' as const : regimeScale > 0.8 ? 'reduce' as const : 'reduce' as const,
    },
  ];
  
  let explanation = 'Normal conditions, full exposure allowed';
  if (scaleFactor < 0.7) {
    explanation = 'Risk conditions elevated → capital significantly reduced';
  } else if (scaleFactor < 0.9) {
    explanation = 'Volatility above target → capital reduced';
  }
  
  return {
    scaleFactor: round2(scaleFactor * 100),
    drivers,
    explanation,
  };
}

// ═══════════════════════════════════════════════════════════════
// TRANSPARENCY BUILDER
// ═══════════════════════════════════════════════════════════════

function buildTransparency(engineData: any): ModelTransparency {
  const audit = engineData?.audit;
  
  return {
    systemVersion: SYSTEM_VERSION,
    capitalScalingVersion: CAPITAL_SCALING_VERSION,
    dataAsOf: new Date().toISOString().split('T')[0],
    determinismHash: audit?.inputsHash || computeInputsHash(engineData),
    frozen: SYSTEM_FREEZE,
  };
}

// ═══════════════════════════════════════════════════════════════
// ADVANCED DECOMPOSITION
// ═══════════════════════════════════════════════════════════════

function buildAdvanced(engineData: any): ModelDecomposition {
  const forecasts = engineData?.forecastByHorizon || [];
  
  return {
    horizons: [30, 90, 180, 365].map(h => {
      const f = forecasts.find((x: any) => x.horizon === h) || {};
      return {
        horizon: h,
        synthetic: round2(f.synthetic ?? 0),
        replay: round2(f.replay ?? 0),
        hybrid: round2(f.hybrid ?? 0),
        macroAdj: round2(f.macroAdjusted ?? 0),
        macroDelta: round2(f.macroDelta ?? 0),
      };
    }),
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════

export async function getBrainDecisionPack(): Promise<BrainDecisionPack> {
  // Fetch all data
  const engineData = await getEngineGlobalWithBrain({
    brain: true,
    brainMode: 'on',
    capital: true,
    capitalMode: 'on',
  });
  
  // Fetch macro score
  let macroScore: any = null;
  try {
    macroScore = await computeMacroScore();
  } catch (e) {
    console.warn('[BrainDecision] Could not compute macro score:', (e as Error).message);
  }
  
  // Fetch real macro data
  const [fedFunds, cpi, unrate, t10y2y, baa10y, houst] = await Promise.all([
    getLatestMacroPoint('FEDFUNDS'),
    getLatestMacroPoint('CPIAUCSL'),
    getLatestMacroPoint('UNRATE'),
    getLatestMacroPoint('T10Y2Y'),
    getLatestMacroPoint('BAA10Y'),
    getLatestMacroPoint('HOUST'),
  ]);
  
  const macroData = {
    fedRate: fedFunds?.value ?? null,
    cpiYoY: 2.5, // TODO: calculate from historical
    unemployment: unrate?.value ?? null,
    yieldSpread: t10y2y ? t10y2y.value / 100 : null,
    creditSpread: baa10y?.value ?? null,
    housingStarts: houst?.value ?? null,
  };
  
  // Build verdict first
  const verdict = buildVerdict(engineData, macroScore);
  
  // Build all components
  const action = buildAction(verdict, engineData);
  const reasons = await buildReasons(macroData, engineData, macroScore);
  const horizons = buildHorizons(engineData);
  const risk = buildRiskMap(engineData);
  const causal = buildCausalFlow(macroData, macroScore);
  const macroSummary = buildMacroSummary(macroData);
  const allocation = buildAllocation(engineData);
  const capitalScaling = buildCapitalScaling(engineData);
  const transparency = buildTransparency(engineData);
  const advanced = buildAdvanced(engineData);
  
  return {
    verdict,
    action,
    reasons,
    horizons,
    risk,
    causal,
    macroSummary,
    allocation,
    capitalScaling,
    transparency,
    advanced,
    generatedAt: new Date().toISOString(),
  };
}
