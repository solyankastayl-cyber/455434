/**
 * BRAIN OVERVIEW SERVICE — User Brain Page v3
 * 
 * Aggregates all brain/engine data into single UI pack
 */

import { getEngineGlobalWithBrain } from '../engine-global/engine_global_brain_bridge.service.js';
import { getVersionInfo, SYSTEM_VERSION, SYSTEM_FREEZE, CAPITAL_SCALING_VERSION } from '../../core/version.js';
import type {
  BrainOverviewPack,
  BrainOverviewMeta,
  HealthStrip,
  IndicatorCard,
  MacroEngineOutput,
  HorizonForecast,
  TransmissionMap,
  BrainDecisionSection,
  AllocationsPipeline,
  CapitalScalingSection,
  AuditSection,
  IndicatorStatus,
  UsdImpact,
} from './brain_overview.contract.js';
import { getLatestMacroPoint } from '../dxy-macro-core/ingest/macro.ingest.service.js';
import { computeMacroScore } from '../dxy-macro-core/services/macro_score.service.js';

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Fetch real macro data from FRED-ingested database
 */
async function fetchRealMacroData(): Promise<{
  fedRate: number | null;
  cpiYoY: number | null;
  unemployment: number | null;
  yieldSpread: number | null;
  m2Growth: number | null;
  creditSpread: number | null;
  housingStarts: number | null;
  goldPrice: number | null;
}> {
  try {
    const [fedFunds, cpi, unrate, t10y2y, m2, baa10y, houst] = await Promise.all([
      getLatestMacroPoint('FEDFUNDS'),
      getLatestMacroPoint('CPIAUCSL'),
      getLatestMacroPoint('UNRATE'),
      getLatestMacroPoint('T10Y2Y'),
      getLatestMacroPoint('M2SL'),
      getLatestMacroPoint('BAA10Y'),
      getLatestMacroPoint('HOUST'),
    ]);
    
    // Calculate CPI YoY - need historical point
    let cpiYoY: number | null = null;
    if (cpi) {
      // CPI is an index, we need to get value from 12 months ago for YoY
      // For now, use a simpler approach - estimate from current level
      // Real implementation would query historical data
      cpiYoY = 2.8; // Placeholder - TODO: calculate from historical
    }
    
    return {
      fedRate: fedFunds?.value ?? null,
      cpiYoY,
      unemployment: unrate?.value ?? null,
      yieldSpread: t10y2y ? t10y2y.value / 100 : null, // Convert from bp to decimal
      m2Growth: null, // TODO: calculate YoY from historical
      creditSpread: baa10y?.value ?? null, // BAA-10Y spread in %
      housingStarts: houst?.value ?? null, // Housing starts thousands
      goldPrice: null, // TODO: add gold price source
    };
  } catch (e) {
    console.error('[BrainOverview] Error fetching real macro data:', e);
    return {
      fedRate: null,
      cpiYoY: null,
      unemployment: null,
      yieldSpread: null,
      m2Growth: null,
      creditSpread: null,
      housingStarts: null,
      goldPrice: null,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// MACRO INDICATORS BUILDER
// ═══════════════════════════════════════════════════════════════

async function buildMacroInputs(worldState: any, macroPack: any): Promise<IndicatorCard[]> {
  const indicators: IndicatorCard[] = [];
  const now = new Date().toISOString();
  
  // Fetch real data from FRED-ingested database
  const realData = await fetchRealMacroData();
  
  // Also get macro score for additional context
  let macroScore: any = null;
  try {
    macroScore = await computeMacroScore();
  } catch (e) {
    console.warn('[BrainOverview] Could not fetch macro score:', (e as Error).message);
  }
  
  // 1. FED RATE (Monetary Policy) - use real FRED data
  const fedRate = realData.fedRate ?? worldState?.macro?.fedRate ?? macroPack?.components?.fedRate ?? null;
  indicators.push({
    key: 'fed_rate',
    title: 'Fed Funds Rate',
    value: fedRate !== null ? `${fedRate.toFixed(2)}%` : 'N/A',
    status: fedRate !== null ? (fedRate > 5 ? 'warning' : fedRate > 3 ? 'neutral' : 'positive') : 'nodata',
    impact: fedRate !== null ? (fedRate > 4 ? 'bullish_usd' : 'bearish_usd') : 'neutral',
    explanation: fedRate !== null ? (fedRate > 5 ? 'Tight policy' : fedRate > 3 ? 'Moderately tight' : 'Accommodative') : 'No data',
    tooltip: 'Federal Reserve target interest rate. Higher rates strengthen USD and pressure risk assets.',
    lastUpdate: now,
  });
  
  // 2. INFLATION (CPI)
  // Try to get from macro score components first
  const cpiComponent = macroScore?.components?.find((c: any) => c.seriesId === 'CPIAUCSL' || c.seriesId === 'CPILFESL');
  const cpi = cpiComponent?.rawPressure !== undefined 
    ? 2.5 + (cpiComponent.rawPressure * 2) // Convert pressure to approx YoY %
    : realData.cpiYoY ?? worldState?.macro?.cpiYoY ?? macroPack?.components?.cpi ?? null;
  indicators.push({
    key: 'inflation',
    title: 'Inflation (CPI YoY)',
    value: cpi !== null ? `${cpi.toFixed(1)}%` : 'N/A',
    direction: cpi !== null ? (cpi > 3 ? 'up' : 'down') : undefined,
    status: cpi !== null ? (cpi > 4 ? 'negative' : cpi > 2.5 ? 'warning' : 'positive') : 'nodata',
    impact: cpi !== null ? (cpi > 3.5 ? 'bullish_usd' : 'neutral') : 'neutral',
    explanation: cpi !== null ? (cpi > 4 ? 'Elevated inflation' : cpi > 2.5 ? 'Above target' : 'Near target') : 'No data',
    tooltip: 'Consumer Price Index year-over-year change. High inflation pressures Fed to tighten.',
    lastUpdate: now,
  });
  
  // 3. LABOR (Unemployment) - use real FRED data
  const unrate = realData.unemployment ?? worldState?.macro?.unemployment ?? macroPack?.components?.unrate ?? null;
  indicators.push({
    key: 'unemployment',
    title: 'Unemployment Rate',
    value: unrate !== null ? `${unrate.toFixed(1)}%` : 'N/A',
    status: unrate !== null ? (unrate > 5 ? 'negative' : unrate > 4 ? 'warning' : 'positive') : 'nodata',
    impact: unrate !== null ? (unrate < 4 ? 'bullish_usd' : 'bearish_usd') : 'neutral',
    explanation: unrate !== null ? (unrate > 5 ? 'Rising joblessness' : unrate < 4 ? 'Tight labor market' : 'Moderate') : 'No data',
    tooltip: 'US unemployment rate. Low unemployment can fuel inflation and hawkish Fed policy.',
    lastUpdate: now,
  });
  
  // 4. YIELD CURVE - use real FRED data
  const yieldSpread = realData.yieldSpread ?? worldState?.macro?.yieldCurveSpread ?? macroPack?.components?.yieldCurve ?? null;
  indicators.push({
    key: 'yield_curve',
    title: 'Yield Curve (10Y-2Y)',
    value: yieldSpread !== null ? `${(yieldSpread * 100).toFixed(0)}bp` : 'N/A',
    status: yieldSpread !== null ? (yieldSpread < 0 ? 'negative' : yieldSpread < 0.5 ? 'warning' : 'positive') : 'nodata',
    impact: yieldSpread !== null ? (yieldSpread < 0 ? 'bearish_usd' : 'neutral') : 'neutral',
    explanation: yieldSpread !== null ? (yieldSpread < 0 ? 'Inverted - recession signal' : yieldSpread < 0.5 ? 'Flattening' : 'Normal') : 'No data',
    tooltip: 'Treasury 10Y minus 2Y spread. Inversion historically signals recession.',
    lastUpdate: now,
  });
  
  // 5. LIQUIDITY
  const liquidity = worldState?.macro?.liquidityScore ?? macroPack?.liquidityImpulse ?? null;
  indicators.push({
    key: 'liquidity',
    title: 'Liquidity Impulse',
    value: liquidity !== null ? (liquidity > 0 ? '+' : '') + liquidity.toFixed(2) : 'N/A',
    direction: liquidity !== null ? (liquidity > 0 ? 'up' : liquidity < 0 ? 'down' : 'flat') : undefined,
    status: liquidity !== null ? (liquidity > 0.5 ? 'positive' : liquidity < -0.5 ? 'negative' : 'neutral') : 'nodata',
    impact: liquidity !== null ? (liquidity > 0 ? 'bearish_usd' : 'bullish_usd') : 'neutral',
    explanation: liquidity !== null ? (liquidity > 0.5 ? 'Expanding liquidity' : liquidity < -0.5 ? 'Contracting' : 'Stable') : 'No data',
    tooltip: 'M2 money supply growth momentum. Expansion supports risk assets.',
    lastUpdate: now,
  });
  
  // 6. CREDIT SPREAD - use real FRED BAA10Y data
  const creditSpread = realData.creditSpread ?? worldState?.macro?.creditSpreadNorm ?? macroPack?.components?.creditSpread ?? null;
  indicators.push({
    key: 'credit_spread',
    title: 'Credit Spreads',
    value: creditSpread !== null ? `${(creditSpread * 100).toFixed(0)}bp` : 'N/A',
    status: creditSpread !== null ? (creditSpread > 3 ? 'negative' : creditSpread > 2 ? 'warning' : 'positive') : 'nodata',
    impact: creditSpread !== null ? (creditSpread > 2.5 ? 'bullish_usd' : 'neutral') : 'neutral',
    explanation: creditSpread !== null ? (creditSpread > 3 ? 'Stress elevated' : creditSpread > 2 ? 'Above normal' : 'Healthy') : 'No data',
    tooltip: 'Corporate bond spreads over Treasuries. Widening indicates risk aversion.',
    lastUpdate: now,
  });
  
  // 7. HOUSING - use real FRED HOUST data
  const housingRaw = realData.housingStarts ?? null;
  // Housing starts are in thousands, normalize to show meaningful value
  const housing = housingRaw !== null ? housingRaw : (worldState?.macro?.housingStarts ?? macroPack?.components?.housing ?? null);
  indicators.push({
    key: 'housing',
    title: 'Housing Activity',
    value: housingRaw !== null ? `${housingRaw.toFixed(0)}K` : (housing !== null ? (housing > 0 ? '+' : '') + `${(housing * 100).toFixed(1)}%` : 'N/A'),
    direction: housing !== null ? (housing > 0 ? 'up' : 'down') : undefined,
    status: housingRaw !== null ? (housingRaw > 1500 ? 'positive' : housingRaw < 1200 ? 'negative' : 'neutral') : (housing !== null ? (housing > 0.05 ? 'positive' : housing < -0.05 ? 'negative' : 'neutral') : 'nodata'),
    impact: 'neutral',
    explanation: housingRaw !== null ? (housingRaw > 1500 ? 'Strong housing' : housingRaw < 1200 ? 'Weak housing' : 'Moderate') : (housing !== null ? (housing > 0.05 ? 'Expanding' : housing < -0.05 ? 'Contracting' : 'Stable') : 'No data'),
    tooltip: 'Housing starts (thousands). Leading indicator of economic activity.',
    lastUpdate: now,
  });
  
  // 8. MONEY SUPPLY
  const moneyGrowth = worldState?.macro?.moneyGrowthYoY ?? macroPack?.components?.m2Growth ?? null;
  indicators.push({
    key: 'money_supply',
    title: 'Money Supply (M2)',
    value: moneyGrowth !== null ? (moneyGrowth > 0 ? '+' : '') + `${(moneyGrowth * 100).toFixed(1)}%` : 'N/A',
    direction: moneyGrowth !== null ? (moneyGrowth > 0 ? 'up' : 'down') : undefined,
    status: moneyGrowth !== null ? (moneyGrowth > 0.05 ? 'positive' : moneyGrowth < -0.02 ? 'negative' : 'neutral') : 'nodata',
    impact: moneyGrowth !== null ? (moneyGrowth > 0.03 ? 'bearish_usd' : 'bullish_usd') : 'neutral',
    explanation: moneyGrowth !== null ? (moneyGrowth > 0.05 ? 'Strong growth' : moneyGrowth < -0.02 ? 'Contraction' : 'Moderate') : 'No data',
    tooltip: 'Broad money supply year-over-year change.',
    lastUpdate: now,
  });
  
  // 9. GOLD (Flight-to-quality)
  const goldBias = worldState?.gold?.bias ?? macroPack?.goldSignal ?? null;
  indicators.push({
    key: 'gold',
    title: 'Gold (Safe Haven)',
    value: goldBias !== null ? (goldBias > 0 ? 'Bid' : goldBias < 0 ? 'Offered' : 'Neutral') : 'N/A',
    direction: goldBias !== null ? (goldBias > 0 ? 'up' : goldBias < 0 ? 'down' : 'flat') : undefined,
    status: goldBias !== null ? (goldBias > 0.5 ? 'warning' : 'neutral') : 'nodata',
    impact: goldBias !== null ? (goldBias > 0 ? 'bearish_usd' : 'bullish_usd') : 'neutral',
    explanation: goldBias !== null ? (goldBias > 0.5 ? 'Flight-to-quality active' : goldBias < -0.3 ? 'Risk appetite' : 'Balanced') : 'No data',
    tooltip: 'Gold as a risk-off indicator. Rising gold often signals uncertainty.',
    lastUpdate: now,
  });
  
  return indicators;
}

// ═══════════════════════════════════════════════════════════════
// MACRO ENGINE OUTPUT BUILDER
// ═══════════════════════════════════════════════════════════════

function buildMacroEngine(worldState: any, brainDecision: any): MacroEngineOutput {
  const macro = worldState?.macro || {};
  const macroPack = brainDecision?.macro || {};
  
  return {
    scoreSigned: round2(macroPack.scoreSigned ?? macro.macroScore ?? 0),
    confidence: round2((macroPack.confidence ?? macro.confidence ?? 0.5) * 100),
    dominantRegime: macroPack.dominantRegime ?? macro.regime ?? 'NEUTRAL',
    persistence: macroPack.persistence ?? macro.persistenceDays ?? 0,
    stabilityScore: round2(macroPack.stabilityScore ?? 0.5),
    topDrivers: (macroPack.topDrivers || []).slice(0, 3).map((d: any) => ({
      name: d.name || d.key || 'Unknown',
      effect: d.effect || (d.contribution > 0 ? '+' : '-'),
      weight: round2(Math.abs(d.weight || d.contribution || 0)),
    })),
    weightsTop: (macroPack.weights || []).slice(0, 5).map((w: any) => ({
      key: w.key || w.name || 'Unknown',
      weight: round2(w.weight || 0),
    })),
  };
}

// ═══════════════════════════════════════════════════════════════
// FORECAST BUILDER
// ═══════════════════════════════════════════════════════════════

function buildForecastByHorizon(brainDecision: any): HorizonForecast[] {
  const horizons: (30 | 90 | 180 | 365)[] = [30, 90, 180, 365];
  const forecasts = brainDecision?.forecastByHorizon || [];
  
  return horizons.map(h => {
    const f = forecasts.find((fc: any) => fc.horizon === h) || {};
    return {
      horizon: h,
      synthetic: round2((f.synthetic ?? 0) * 100),
      replay: round2((f.replay ?? 0) * 100),
      hybrid: round2((f.hybrid ?? 0) * 100),
      macroAdjusted: round2((f.macroAdjusted ?? f.hybrid ?? 0) * 100),
      macroDelta: round2((f.macroDelta ?? 0) * 100),
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// TRANSMISSION MAP BUILDER
// ═══════════════════════════════════════════════════════════════

function buildTransmission(worldState: any, brainDecision: any): TransmissionMap {
  const macro = worldState?.macro || {};
  const crossAsset = worldState?.crossAsset || brainDecision?.crossAsset || {};
  
  const inflationPressure = macro.cpiYoY > 3 || macro.inflationPressure > 0.5;
  const ratesPressure = macro.fedRate > 4 || macro.yieldCurveSpread < 0;
  const flightActive = macro.creditSpreadNorm > 2.5 || worldState?.gold?.bias > 0.3;
  
  return {
    inflationChannel: {
      name: 'Inflation Pressure',
      status: inflationPressure ? 'warning' : 'neutral',
      explanation: inflationPressure 
        ? 'Elevated inflation pressuring monetary policy' 
        : 'Inflation contained',
      confidence: round2(macro.confidence || 0.6),
    },
    ratesChannel: {
      name: 'Rates & Yield',
      status: ratesPressure ? 'negative' : 'positive',
      explanation: ratesPressure
        ? 'Tight rates environment pressuring risk'
        : 'Supportive rate environment',
      confidence: round2(macro.confidence || 0.6),
    },
    flightToQualityChannel: {
      name: 'Flight-to-Quality',
      status: flightActive ? 'warning' : 'neutral',
      explanation: flightActive
        ? 'Safe haven demand elevated'
        : 'Risk appetite stable',
      confidence: round2(crossAsset?.confidence || 0.5),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// BRAIN DECISION BUILDER
// ═══════════════════════════════════════════════════════════════

function buildBrainDecision(brainDecision: any, metaRisk: any): BrainDecisionSection {
  const scenario = brainDecision?.scenario || {};
  const probs = scenario.probabilities || brainDecision?.probabilities || {};
  
  const recommendations: any[] = [];
  const directives = Array.isArray(brainDecision?.directives) ? brainDecision.directives : [];
  
  // Build recommendations from directives
  if (directives.includes('reduce_risk') || scenario.name === 'TAIL') {
    recommendations.push({
      action: 'Reduce overall risk exposure',
      reason: 'Elevated tail risk detected',
      tags: ['scenario', 'tail'],
    });
  }
  if (directives.includes('increase_cash') || metaRisk?.posture === 'DEFENSIVE') {
    recommendations.push({
      action: 'Increase cash allocation',
      reason: 'Defensive posture recommended',
      tags: ['metaRisk', 'defensive'],
    });
  }
  if (metaRisk?.guardLevel === 'CRISIS' || metaRisk?.guardLevel === 'BLOCK') {
    recommendations.push({
      action: 'Maximum risk reduction active',
      reason: `Guard level: ${metaRisk?.guardLevel}`,
      tags: ['guard', metaRisk?.guardLevel?.toLowerCase()],
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      action: 'Maintain balanced exposure',
      reason: 'Normal market conditions',
      tags: ['base', 'neutral'],
    });
  }
  
  return {
    scenarioProbs: {
      BASE: round2((probs.BASE || probs.base || 0.65) * 100),
      RISK: round2((probs.RISK || probs.risk || 0.25) * 100),
      TAIL: round2((probs.TAIL || probs.tail || 0.10) * 100),
    },
    currentScenario: scenario.name || 'BASE',
    posture: metaRisk?.posture || 'NEUTRAL',
    maxOverrideCap: round2(metaRisk?.maxOverrideCap || 0.35),
    recommendations,
  };
}

// ═══════════════════════════════════════════════════════════════
// ALLOCATIONS PIPELINE BUILDER
// ═══════════════════════════════════════════════════════════════

function buildAllocationsPipeline(engineResult: any): AllocationsPipeline {
  const alloc = engineResult.allocations || {};
  const brain = engineResult.brain || {};
  const steps = brain.bridgeSteps || [];
  
  // Base (step 0)
  const baseStep = steps.find((s: any) => s.step === '0_base') || {};
  const base = {
    spx: round4(baseStep.spx ?? alloc.spxSize ?? 0),
    btc: round4(baseStep.btc ?? alloc.btcSize ?? 0),
    cash: round4(baseStep.cash ?? alloc.cashSize ?? 0),
  };
  
  // After Brain (step 4)
  const afterBrainStep = steps.find((s: any) => s.step === '4_global_scale') || steps.find((s: any) => s.step === '1_brain_directives') || {};
  const afterBrain = {
    spx: round4(afterBrainStep.spx ?? base.spx),
    btc: round4(afterBrainStep.btc ?? base.btc),
    cash: round4(afterBrainStep.cash ?? base.cash),
  };
  
  // Final
  const final = {
    spx: round4(alloc.spxSize ?? 0),
    btc: round4(alloc.btcSize ?? 0),
    cash: round4(alloc.cashSize ?? 0),
  };
  
  // Intensity breakdown
  const intensity = brain.overrideIntensity || {};
  
  return {
    base,
    afterBrain,
    final,
    deltas: {
      brainDelta: {
        spx: round4(afterBrain.spx - base.spx),
        btc: round4(afterBrain.btc - base.btc),
        cash: round4(afterBrain.cash - base.cash),
      },
      finalDelta: {
        spx: round4(final.spx - base.spx),
        btc: round4(final.btc - base.btc),
        cash: round4(final.cash - base.cash),
      },
    },
    intensityBreakdown: {
      brain: round4(intensity.brain || 0),
      metaRiskScale: round4(intensity.metaRiskScale || 0),
      optimizer: round4(intensity.optimizer || 0),
      capitalScaling: round4(brain.capitalScaling?.scaleFactor ? Math.abs(1 - brain.capitalScaling.scaleFactor) : 0),
      total: round4(intensity.total || 0),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// CAPITAL SCALING BUILDER
// ═══════════════════════════════════════════════════════════════

function buildCapitalScaling(capitalScalingPack: any): CapitalScalingSection {
  const cs = capitalScalingPack || {};
  const drivers = cs.drivers || {};
  
  // Build explanation
  let explanation = 'Risk budget optimized';
  const clampsApplied: string[] = [];
  
  if (drivers.volScale < 0.9) {
    explanation = 'Volatility above target → capital reduced';
    clampsApplied.push('VOL_SCALE');
  }
  if (drivers.tailScale < 0.85) {
    explanation = 'Elevated tail risk → capital reduced';
    clampsApplied.push('TAIL_PENALTY');
  }
  if (drivers.guardAdjusted) {
    explanation = 'Guard constraint active → capital capped';
    clampsApplied.push('GUARD_CAP');
  }
  if (cs.warnings?.length > 0) {
    clampsApplied.push(...cs.warnings.map((w: string) => w.split(':')[0]));
  }
  
  return {
    scaleFactor: round4(cs.scaleFactor ?? 1),
    mode: cs.mode || 'on',
    volScale: round4(drivers.volScale ?? 1),
    tailScale: round4(drivers.tailScale ?? 1),
    regimeScale: round4(drivers.regimeScale ?? 1),
    guardAdjusted: drivers.guardAdjusted || false,
    explanation,
    clampsApplied,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export async function getBrainOverview(asOf?: string): Promise<BrainOverviewPack> {
  const effectiveAsOf = asOf || new Date().toISOString().split('T')[0];
  
  // Fetch engine data with all layers enabled
  const engineResult = await getEngineGlobalWithBrain({
    asOf: effectiveAsOf,
    brain: true,
    brainMode: 'on',
    optimizer: true,
    capital: true,
    capitalMode: 'on',
  });
  
  const brain = engineResult.brain || {};
  const brainDecision = brain.decision || {};
  const metaRisk = brain.metaRisk || {};
  const capitalScalingPack = brain.capitalScaling || {};
  const worldState = brainDecision.worldState || {};
  const macroPack = brainDecision.macro || worldState.macro || {};
  
  // Build all sections
  const meta: BrainOverviewMeta = {
    asOf: effectiveAsOf,
    dataFreshDays: 0, // Would calculate from actual data
    inputsHash: capitalScalingPack.hash || 'unknown',
    systemVersion: SYSTEM_VERSION,
    freeze: SYSTEM_FREEZE,
    generatedAt: new Date().toISOString(),
  };
  
  const healthStrip: HealthStrip = {
    systemGrade: SYSTEM_FREEZE ? 'PRODUCTION' : 'REVIEW',
    brainScenario: brainDecision?.scenario?.name || 'BASE',
    guard: metaRisk?.guardLevel || 'NONE',
    crossAssetRegime: worldState?.crossAsset?.regime || brainDecision?.crossAsset?.regime || 'UNKNOWN',
    metaPosture: metaRisk?.posture || 'NEUTRAL',
    capitalScalingStatus: capitalScalingPack.mode === 'on' ? 'ACTIVE' : 'SHADOW',
    scaleFactor: round4(capitalScalingPack.scaleFactor || 1),
    determinismHash: capitalScalingPack.hash || 'unknown',
  };
  
  return {
    meta,
    healthStrip,
    macroInputs: await buildMacroInputs(worldState, macroPack),
    macroEngine: buildMacroEngine(worldState, brainDecision),
    forecastByHorizon: buildForecastByHorizon(brainDecision),
    transmission: buildTransmission(worldState, brainDecision),
    brainDecision: buildBrainDecision(brainDecision, metaRisk),
    allocationsPipeline: buildAllocationsPipeline(engineResult),
    capitalScaling: buildCapitalScaling(capitalScalingPack),
    audit: {
      inputsHash: meta.inputsHash,
      systemVersion: SYSTEM_VERSION,
      brainModelId: brainDecision?.modelId || 'brain-v2',
      macroEngineVersion: 'macro-v2',
      capitalScalingVersion: CAPITAL_SCALING_VERSION,
      frozen: SYSTEM_FREEZE,
      lastPromoteAt: undefined,
    },
  };
}

// Singleton
let _service: BrainOverviewService | null = null;

export class BrainOverviewService {
  static getInstance(): BrainOverviewService {
    if (!_service) {
      _service = new BrainOverviewService();
    }
    return _service;
  }
  
  async getOverview(asOf?: string): Promise<BrainOverviewPack> {
    return getBrainOverview(asOf);
  }
}

export function getBrainOverviewService(): BrainOverviewService {
  return BrainOverviewService.getInstance();
}
