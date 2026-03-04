/**
 * ENGINE GLOBAL SERVICE — P5.1 Aggregator + P5.2 Policy
 * 
 * Collects all system layers into single world view.
 * Applies allocation policy rules.
 * Deterministic, asOf-supported, no lookahead.
 */

import type {
  EngineGlobalResponse,
  EngineGlobalState,
  EngineAllocation,
  EngineInputsSnapshot,
  EngineEvidence,
  EngineMeta,
  EngineInputSource,
  EngineDriver,
  EngineConflict,
  EngineFlipCondition,
  DxyInput,
  MacroInput,
  LiquidityInput,
  GuardInput,
  AeInput,
  CascadeInput,
  RiskMode,
  GuardLevel,
  LiquidityRegime,
  Confidence,
} from './engine_global.contract.js';

import {
  ENGINE_VERSION,
  DEFAULT_ALLOCATIONS,
  GUARD_ALLOCATION_CAPS,
} from './engine_global.contract.js';

// P5.2: Import policy and cache
import { applyAllocationPolicy, explainPolicy, PolicyBreakdown } from './allocation_policy.service.js';
import { engineCache, CACHE_TTL, buildCacheKey } from './engine_cache.js';

// ═══════════════════════════════════════════════════════════════
// INTERNAL API FETCHER WITH CACHE
// ═══════════════════════════════════════════════════════════════

const BASE_URL = 'http://127.0.0.1:8002';
const FETCH_TIMEOUT = 120000; // 120 seconds for complex cascade calculations

async function fetchEndpointCached<T>(
  endpoint: string,
  asOf?: string,
  ttl?: number
): Promise<{ data: T | null; source: EngineInputSource; cached: boolean }> {
  const cacheKey = buildCacheKey(endpoint, asOf);
  
  // Check cache first
  const cached = engineCache.get<T>(cacheKey);
  if (cached !== null) {
    return {
      data: cached,
      source: { endpoint, status: 'OK', latencyMs: 0, asOf },
      cached: true,
    };
  }
  
  // Fetch from API
  const result = await fetchEndpoint<T>(endpoint, asOf);
  
  // Cache successful results
  if (result.data && result.source.status === 'OK' && ttl) {
    engineCache.set(cacheKey, result.data, ttl);
  }
  
  return { ...result, cached: false };
}

async function fetchEndpoint<T>(
  endpoint: string,
  asOf?: string
): Promise<{ data: T | null; source: EngineInputSource }> {
  const t0 = Date.now();
  const url = asOf ? `${BASE_URL}${endpoint}?asOf=${asOf}` : `${BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, { 
      signal: AbortSignal.timeout(FETCH_TIMEOUT) 
    });
    
    if (!response.ok) {
      return {
        data: null,
        source: { endpoint, status: 'FAILED', latencyMs: Date.now() - t0, asOf },
      };
    }
    
    const data = await response.json();
    return {
      data: data as T,
      source: { endpoint, status: 'OK', latencyMs: Date.now() - t0, asOf },
    };
  } catch (e) {
    return {
      data: null,
      source: { endpoint, status: 'TIMEOUT', latencyMs: Date.now() - t0, asOf },
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// INPUT EXTRACTORS
// ═══════════════════════════════════════════════════════════════

function extractDxyInput(data: any): DxyInput | null {
  if (!data?.ok) return null;
  
  // Try research terminal format
  if (data.data?.decision) {
    return {
      signalSigned: data.data.decision.action === 'BULLISH' ? 0.5 : 
                    data.data.decision.action === 'BEARISH' ? -0.5 : 0,
      confidence: data.data.decision.confidence ?? 0.5,
      horizon: data.data.focus || '30d',
      phase: data.data.phase?.phase || 'UNKNOWN',
    };
  }
  
  // Try fractal terminal format
  if (data.fractal) {
    const signal = data.fractal.signal || data.fractal.direction || 0;
    return {
      signalSigned: signal,
      confidence: data.fractal.confidence ?? 0.5,
      horizon: data.focus || '30d',
      phase: data.phase?.phase || 'UNKNOWN',
    };
  }
  
  return null;
}

function extractMacroInput(data: any): MacroInput | null {
  if (!data?.ok || !data.score) return null;
  
  const score = data.score;
  return {
    scoreSigned: score.scoreSigned ?? 0,
    score01: score.score01 ?? 0.5,
    confidence: (score.confidence || 'MEDIUM') as Confidence,
    dominantRegime: score.summary?.dominantRegime || 'NEUTRAL',
    keyDrivers: score.summary?.keyDrivers?.slice(0, 3) || [],
  };
}

function extractLiquidityInput(data: any): LiquidityInput | null {
  if (!data?.impulse && data?.impulse !== 0) return null;
  
  return {
    impulse: data.impulse ?? 0,
    regime: (data.regime || 'NEUTRAL') as LiquidityRegime,
    confidence: data.confidence ?? 0.5,
  };
}

function extractGuardInput(data: any): GuardInput | null {
  if (!data?.ok) return null;
  
  return {
    level: (data.level || 'NONE') as GuardLevel,
    triggered: data.level !== 'NONE',
    creditStress: data.stress?.creditComposite ?? 0,
    vix: data.stress?.vix ?? 15,
  };
}

function extractAeInput(data: any): AeInput | null {
  if (!data) return null;
  
  const regime = typeof data.regime === 'string' ? data.regime : data.regime?.regime || 'NEUTRAL';
  const scenarios = data.scenarios?.scenarios || [];
  
  const bull = scenarios.find((s: any) => s.name?.includes('BULL'))?.prob ?? 0.25;
  const bear = scenarios.find((s: any) => s.name?.includes('BEAR'))?.prob ?? 0.25;
  const base = scenarios.find((s: any) => s.name === 'BASE')?.prob ?? 0.5;
  
  return {
    regime,
    regimeConfidence: data.regime?.confidence ?? 0.5,
    noveltyScore: data.novelty?.score ?? 0,
    scenarios: {
      bull,
      base,
      bear,
      dominant: bull > base && bull > bear ? 'BULL' : bear > base ? 'BEAR' : 'BASE',
    },
  };
}

function extractCascadeInput(data: any, asset: 'SPX' | 'BTC'): CascadeInput | null {
  if (!data?.ok || !data.cascade) return null;
  
  const cascade = data.cascade;
  const mults = cascade.multipliers || {};
  
  return {
    asset,
    sizeMultiplier: mults.sizeMultiplier ?? mults.mTotal ?? mults.mTotalRaw ?? 1,
    guardCap: mults.factors?.guardCap ?? mults.guardCap ?? 1,
    mStress: mults.factors?.mStress ?? mults.mStress ?? 1,
    mScenario: mults.factors?.mScenario ?? mults.mScenario ?? 1,
    mNovel: mults.factors?.mNovel ?? mults.mNovel ?? 1,
  };
}

// ═══════════════════════════════════════════════════════════════
// GLOBAL STATE CALCULATOR
// ═══════════════════════════════════════════════════════════════

function calculateGlobalState(inputs: EngineInputsSnapshot): EngineGlobalState {
  const { macro, liquidity, guard, ae } = inputs;
  
  // Guard level (highest priority)
  const guardLevel: GuardLevel = guard?.level || 'NONE';
  
  // Liquidity regime
  const liquidityRegime: LiquidityRegime = liquidity?.regime || 'NEUTRAL';
  
  // Macro tilt
  const macroTilt = macro?.scoreSigned ?? 0;
  
  // Scenario dominant
  const scenarioDominant = ae?.scenarios?.dominant || 'BASE';
  
  // Calculate risk mode
  let riskMode: RiskMode = 'NEUTRAL';
  
  if (guardLevel === 'BLOCK') {
    riskMode = 'CRISIS';
  } else if (guardLevel === 'CRISIS') {
    riskMode = 'RISK_OFF';
  } else if (guardLevel === 'WARN') {
    riskMode = ae?.regime?.includes('RISK_OFF') ? 'RISK_OFF' : 'NEUTRAL';
  } else {
    // Guard is NONE - use macro and AE
    if (ae?.regime?.includes('RISK_ON')) {
      riskMode = 'RISK_ON';
    } else if (ae?.regime?.includes('RISK_OFF')) {
      riskMode = 'RISK_OFF';
    } else if (macroTilt > 0.2 && liquidityRegime === 'EXPANSION') {
      riskMode = 'RISK_ON';
    } else if (macroTilt < -0.2 && liquidityRegime === 'CONTRACTION') {
      riskMode = 'RISK_OFF';
    }
  }
  
  // Calculate confidence
  let confidence: Confidence = 'MEDIUM';
  
  const macroConf = macro?.confidence === 'HIGH' ? 0.9 : macro?.confidence === 'LOW' ? 0.3 : 0.6;
  const aeConf = ae?.regimeConfidence ?? 0.5;
  const liqConf = liquidity?.confidence ?? 0.5;
  const avgConf = (macroConf + aeConf + liqConf) / 3;
  
  if (avgConf > 0.7 && ae?.noveltyScore && ae.noveltyScore < 0.3) {
    confidence = 'HIGH';
  } else if (avgConf < 0.4 || (ae?.noveltyScore && ae.noveltyScore > 0.5)) {
    confidence = 'LOW';
  }
  
  return {
    riskMode,
    confidence,
    guardLevel,
    liquidityRegime,
    macroTilt: Math.round(macroTilt * 1000) / 1000,
    scenarioDominant,
  };
}

// ═══════════════════════════════════════════════════════════════
// ALLOCATION CALCULATOR
// ═══════════════════════════════════════════════════════════════

function calculateAllocations(
  inputs: EngineInputsSnapshot,
  globalState: EngineGlobalState
): EngineAllocation {
  const { guardLevel, liquidityRegime, riskMode, macroTilt } = globalState;
  const caps = GUARD_ALLOCATION_CAPS[guardLevel];
  
  // Start with cascade sizes
  let spxSize = inputs.spxCascade?.sizeMultiplier ?? 0.5;
  let btcSize = inputs.btcCascade?.sizeMultiplier ?? 0.5;
  let dxySize = Math.abs(inputs.dxy?.signalSigned ?? 0) * 0.5; // DXY sizing from signal strength
  
  // Apply guard caps
  spxSize = Math.min(spxSize, caps.spx);
  btcSize = Math.min(btcSize, caps.btc);
  dxySize = Math.min(dxySize, caps.dxy);
  
  // Risk mode adjustments
  if (riskMode === 'CRISIS') {
    spxSize = 0;
    btcSize = 0;
    dxySize = 0;
  } else if (riskMode === 'RISK_OFF') {
    spxSize *= 0.6;
    btcSize *= 0.4;  // BTC more sensitive
    dxySize *= 0.8;
  } else if (riskMode === 'RISK_ON') {
    // Slight boost, but don't exceed cascade recommendation
    spxSize = Math.min(spxSize * 1.1, caps.spx);
    btcSize = Math.min(btcSize * 1.1, caps.btc);
  }
  
  // Liquidity adjustments
  if (liquidityRegime === 'CONTRACTION') {
    btcSize *= 0.7;  // BTC most sensitive to liquidity
    spxSize *= 0.9;
  } else if (liquidityRegime === 'EXPANSION') {
    btcSize = Math.min(btcSize * 1.15, caps.btc);
  }
  
  // Normalize and round
  spxSize = Math.round(Math.max(0, Math.min(1, spxSize)) * 1000) / 1000;
  btcSize = Math.round(Math.max(0, Math.min(1, btcSize)) * 1000) / 1000;
  dxySize = Math.round(Math.max(0, Math.min(1, dxySize)) * 1000) / 1000;
  
  // Cash is residual (simplified - not true portfolio math)
  const totalRisk = (spxSize + btcSize + dxySize) / 3;
  const cashSize = Math.round((1 - totalRisk) * 1000) / 1000;
  
  return { dxySize, spxSize, btcSize, cashSize };
}

// ═══════════════════════════════════════════════════════════════
// EVIDENCE BUILDER
// ═══════════════════════════════════════════════════════════════

function buildEvidence(
  inputs: EngineInputsSnapshot,
  globalState: EngineGlobalState,
  allocations: EngineAllocation
): EngineEvidence {
  const drivers = buildDrivers(inputs, globalState);
  const conflicts = buildConflicts(inputs, globalState);
  const whatWouldFlip = buildFlipConditions(globalState, inputs);
  const scenarioSummary = buildScenarioSummary(inputs.ae);
  
  // Build headline
  const headline = buildHeadline(globalState, allocations);
  
  // Build summary
  const summary = buildSummary(globalState, inputs);
  
  return {
    headline,
    summary,
    drivers,
    conflicts,
    whatWouldFlip,
    scenarioSummary,
  };
}

function buildHeadline(state: EngineGlobalState, allocs: EngineAllocation): string {
  const riskDesc = {
    'RISK_ON': 'Risk-On',
    'RISK_OFF': 'Risk-Off',
    'NEUTRAL': 'Neutral',
    'CRISIS': 'CRISIS MODE',
  }[state.riskMode];
  
  const totalExposure = Math.round((allocs.spxSize + allocs.btcSize) * 100);
  
  if (state.guardLevel === 'BLOCK') {
    return `CRISIS: All positions blocked. 100% cash.`;
  }
  
  if (state.guardLevel === 'CRISIS') {
    return `${riskDesc}: Defensive positioning. ${totalExposure}% risk exposure.`;
  }
  
  return `${riskDesc}: ${state.confidence} confidence. SPX ${Math.round(allocs.spxSize * 100)}%, BTC ${Math.round(allocs.btcSize * 100)}%.`;
}

function buildSummary(state: EngineGlobalState, inputs: EngineInputsSnapshot): string {
  const parts: string[] = [];
  
  // Guard status
  if (state.guardLevel !== 'NONE') {
    parts.push(`Guard is ${state.guardLevel}, limiting exposure.`);
  }
  
  // Liquidity
  if (state.liquidityRegime === 'EXPANSION') {
    parts.push('Fed liquidity is expansionary, supporting risk assets.');
  } else if (state.liquidityRegime === 'CONTRACTION') {
    parts.push('Fed liquidity is contractionary, headwind for risk.');
  }
  
  // Macro
  if (inputs.macro) {
    if (state.macroTilt > 0.15) {
      parts.push('Macro environment favors USD strength.');
    } else if (state.macroTilt < -0.15) {
      parts.push('Macro environment pressures USD.');
    } else {
      parts.push('Macro environment is mixed.');
    }
  }
  
  // Scenario
  parts.push(`${state.scenarioDominant} scenario is most likely.`);
  
  return parts.join(' ');
}

function buildDrivers(inputs: EngineInputsSnapshot, state: EngineGlobalState): EngineDriver[] {
  const drivers: EngineDriver[] = [];
  
  // Guard
  if (state.guardLevel !== 'NONE') {
    drivers.push({
      id: 'guard',
      name: 'Crisis Guard',
      contribution: state.guardLevel === 'BLOCK' ? -1 : state.guardLevel === 'CRISIS' ? -0.6 : -0.3,
      direction: 'BEARISH',
      explanation: `Guard at ${state.guardLevel} level, capping position sizes.`,
    });
  }
  
  // Macro
  if (inputs.macro) {
    const dir = inputs.macro.scoreSigned > 0.05 ? 'BULLISH' : 
                inputs.macro.scoreSigned < -0.05 ? 'BEARISH' : 'NEUTRAL';
    drivers.push({
      id: 'macro',
      name: 'Macro Score',
      contribution: inputs.macro.scoreSigned,
      direction: dir,
      explanation: inputs.macro.keyDrivers[0] || 'Multiple macro factors.',
    });
  }
  
  // Liquidity
  if (inputs.liquidity) {
    const normalizedImpulse = inputs.liquidity.impulse / 3; // Normalize to -1..+1
    const dir = normalizedImpulse > 0.1 ? 'BULLISH' : normalizedImpulse < -0.1 ? 'BEARISH' : 'NEUTRAL';
    drivers.push({
      id: 'liquidity',
      name: 'Fed Liquidity',
      contribution: normalizedImpulse,
      direction: dir,
      explanation: `Liquidity regime is ${inputs.liquidity.regime}.`,
    });
  }
  
  // AE Regime
  if (inputs.ae) {
    const regimeScore = inputs.ae.regime.includes('RISK_ON') ? 0.3 :
                        inputs.ae.regime.includes('RISK_OFF') ? -0.3 : 0;
    const dir = regimeScore > 0 ? 'BULLISH' : regimeScore < 0 ? 'BEARISH' : 'NEUTRAL';
    drivers.push({
      id: 'ae_regime',
      name: 'AE Regime',
      contribution: regimeScore,
      direction: dir,
      explanation: `AE Brain classifies regime as ${inputs.ae.regime}.`,
    });
  }
  
  // SPX Cascade
  if (inputs.spxCascade) {
    const cascadeScore = inputs.spxCascade.sizeMultiplier - 0.5; // Deviation from neutral
    const dir = cascadeScore > 0.1 ? 'BULLISH' : cascadeScore < -0.1 ? 'BEARISH' : 'NEUTRAL';
    drivers.push({
      id: 'spx_cascade',
      name: 'SPX Cascade',
      contribution: cascadeScore,
      direction: dir,
      explanation: `SPX size multiplier: ${Math.round(inputs.spxCascade.sizeMultiplier * 100)}%`,
    });
  }
  
  // BTC Cascade
  if (inputs.btcCascade) {
    const cascadeScore = inputs.btcCascade.sizeMultiplier - 0.5;
    const dir = cascadeScore > 0.1 ? 'BULLISH' : cascadeScore < -0.1 ? 'BEARISH' : 'NEUTRAL';
    drivers.push({
      id: 'btc_cascade',
      name: 'BTC Cascade',
      contribution: cascadeScore,
      direction: dir,
      explanation: `BTC size multiplier: ${Math.round(inputs.btcCascade.sizeMultiplier * 100)}%`,
    });
  }
  
  // Sort by absolute contribution
  return drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 5);
}

function buildConflicts(inputs: EngineInputsSnapshot, state: EngineGlobalState): EngineConflict[] {
  const conflicts: EngineConflict[] = [];
  
  // Macro vs Liquidity
  if (inputs.macro && inputs.liquidity) {
    const macroDir = inputs.macro.scoreSigned > 0.1 ? 'bullish' : inputs.macro.scoreSigned < -0.1 ? 'bearish' : null;
    const liqDir = inputs.liquidity.regime === 'EXPANSION' ? 'bullish' : 
                   inputs.liquidity.regime === 'CONTRACTION' ? 'bearish' : null;
    
    if (macroDir && liqDir && macroDir !== liqDir) {
      conflicts.push({
        signal1: `Macro (${macroDir})`,
        signal2: `Liquidity (${liqDir})`,
        description: `Macro score is ${macroDir} but liquidity regime is ${liqDir}.`,
        resolution: 'Liquidity often leads macro; size conservatively.',
      });
    }
  }
  
  // AE vs Guard
  if (inputs.ae && state.guardLevel !== 'NONE') {
    if (inputs.ae.regime.includes('RISK_ON') && state.guardLevel !== 'NONE') {
      conflicts.push({
        signal1: 'AE Regime (risk-on)',
        signal2: `Guard (${state.guardLevel})`,
        description: 'AE sees risk-on but guard is limiting positions.',
        resolution: 'Guard takes precedence; wait for stress to clear.',
      });
    }
  }
  
  // Scenario vs Regime
  if (inputs.ae) {
    const dominant = inputs.ae.scenarios.dominant;
    if (dominant === 'BULL' && state.riskMode === 'RISK_OFF') {
      conflicts.push({
        signal1: 'Bull Scenario Dominant',
        signal2: 'Risk-Off Mode',
        description: 'Scenarios favor upside but overall mode is risk-off.',
        resolution: 'Risk-off mode overrides; scenario may shift.',
      });
    }
  }
  
  return conflicts;
}

function buildFlipConditions(state: EngineGlobalState, inputs: EngineInputsSnapshot): EngineFlipCondition[] {
  const conditions: EngineFlipCondition[] = [];
  
  if (state.riskMode === 'CRISIS' || state.guardLevel === 'BLOCK') {
    conditions.push({
      condition: 'Guard downgrades from BLOCK to WARN or NONE',
      likelihood: 'MEDIUM',
      impact: 'Would re-enable position taking',
    });
    conditions.push({
      condition: 'VIX drops below 25, credit spreads normalize',
      likelihood: 'MEDIUM',
      impact: 'Would trigger guard downgrade',
    });
  } else if (state.riskMode === 'RISK_OFF') {
    conditions.push({
      condition: 'Guard clears to NONE',
      likelihood: 'MEDIUM',
      impact: 'Would allow larger position sizes',
    });
    conditions.push({
      condition: 'Fed announces liquidity support',
      likelihood: 'LOW',
      impact: 'Would shift to risk-on',
    });
    conditions.push({
      condition: 'Macro score improves above +0.15',
      likelihood: 'MEDIUM',
      impact: 'Would shift toward neutral/risk-on',
    });
  } else if (state.riskMode === 'RISK_ON') {
    conditions.push({
      condition: 'VIX spike triggers guard',
      likelihood: 'LOW',
      impact: 'Would shift to risk-off',
    });
    conditions.push({
      condition: 'Liquidity shifts to contraction',
      likelihood: 'MEDIUM',
      impact: 'Would reduce BTC allocation',
    });
  } else {
    conditions.push({
      condition: 'Clear directional signal from macro or AE',
      likelihood: 'MEDIUM',
      impact: 'Would shift from neutral to directional',
    });
  }
  
  return conditions;
}

function buildScenarioSummary(ae: AeInput | null): EngineEvidence['scenarioSummary'] {
  if (!ae) {
    return {
      bull: { prob: 0.25, description: 'Upside continuation' },
      base: { prob: 0.5, description: 'Range-bound, no clear trend' },
      bear: { prob: 0.25, description: 'Downside risk' },
      dominant: 'BASE',
    };
  }
  
  return {
    bull: {
      prob: ae.scenarios.bull,
      description: ae.scenarios.bull > 0.35 
        ? 'Strong upside potential. Risk-on momentum.'
        : 'Limited upside probability.',
    },
    base: {
      prob: ae.scenarios.base,
      description: ae.scenarios.base > 0.4
        ? 'Range-bound or modest continuation expected.'
        : 'Directional move more likely than base.',
    },
    bear: {
      prob: ae.scenarios.bear,
      description: ae.scenarios.bear > 0.35
        ? 'Elevated downside risk. Consider hedges.'
        : 'Downside risk contained.',
    },
    dominant: ae.scenarios.dominant,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN AGGREGATOR (P5.1 + P5.2)
// ═══════════════════════════════════════════════════════════════

export interface EngineGlobalResponseWithPolicy extends EngineGlobalResponse {
  policy: PolicyBreakdown;
}

export async function buildEngineGlobal(asOf?: string): Promise<EngineGlobalResponseWithPolicy> {
  const t0 = Date.now();
  const effectiveAsOf = asOf || new Date().toISOString().split('T')[0];
  const sources: EngineInputSource[] = [];
  let cachedCount = 0;
  
  console.log(`[Engine Global P5.2] Building world view for asOf=${effectiveAsOf}`);
  
  // Fetch all inputs in parallel WITH CACHING
  const [
    dxyResult,
    macroResult,
    liquidityResult,
    guardResult,
    aeResult,
    spxResult,
    btcResult,
  ] = await Promise.all([
    fetchEndpointCached<any>('/api/fractal/dxy/terminal', asOf, CACHE_TTL.DXY),
    fetchEndpointCached<any>('/api/dxy-macro-core/score', asOf, CACHE_TTL.MACRO),
    fetchEndpointCached<any>('/api/liquidity/state', asOf, CACHE_TTL.LIQUIDITY),
    fetchEndpointCached<any>('/api/dxy-macro-core/guard/current', asOf, CACHE_TTL.GUARD),
    fetchEndpointCached<any>('/api/ae/terminal', asOf, CACHE_TTL.AE),
    fetchEndpointCached<any>('/api/fractal/spx/cascade', undefined, CACHE_TTL.CASCADE),
    fetchEndpointCached<any>('/api/fractal/btc/cascade', undefined, CACHE_TTL.CASCADE),
  ]);
  
  // Collect sources and count cached
  const results = [dxyResult, macroResult, liquidityResult, guardResult, aeResult, spxResult, btcResult];
  for (const r of results) {
    sources.push(r.source);
    if (r.cached) cachedCount++;
  }
  
  console.log(`[Engine Global P5.2] Cached: ${cachedCount}/7 sources`);
  
  // Extract inputs
  const inputs: EngineInputsSnapshot = {
    dxy: extractDxyInput(dxyResult.data),
    macro: extractMacroInput(macroResult.data),
    liquidity: extractLiquidityInput(liquidityResult.data),
    guard: extractGuardInput(guardResult.data),
    ae: extractAeInput(aeResult.data),
    spxCascade: extractCascadeInput(spxResult.data, 'SPX'),
    btcCascade: extractCascadeInput(btcResult.data, 'BTC'),
  };
  
  // Calculate global state
  const globalState = calculateGlobalState(inputs);
  
  // P5.2: Apply allocation policy (instead of simple calculation)
  const policyBreakdown = applyAllocationPolicy(inputs, globalState);
  const allocations = policyBreakdown.finalAllocations;
  
  // Build evidence with policy explanation
  const evidence = buildEvidence(inputs, globalState, allocations);
  evidence.summary = explainPolicy(policyBreakdown);
  
  const meta: EngineMeta = {
    asOf: effectiveAsOf,
    version: ENGINE_VERSION + '-P5.2',
    sources,
    computedAt: new Date().toISOString(),
    latencyMs: Date.now() - t0,
  };
  
  console.log(`[Engine Global P5.2] Complete. Mode: ${globalState.riskMode}, SPX: ${allocations.spxSize}, BTC: ${allocations.btcSize}, Latency: ${meta.latencyMs}ms`);
  
  return {
    ok: true,
    meta,
    global: globalState,
    allocations,
    inputs,
    evidence,
    policy: policyBreakdown,
  };
}

export { ENGINE_VERSION };
