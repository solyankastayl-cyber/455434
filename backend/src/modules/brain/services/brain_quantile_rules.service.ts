/**
 * P8.0-C — Brain Quantile Rules Service
 * 
 * Transforms Quantile Forecast into Brain decisions:
 *   WorldState → Quantile Forecast → Scenario Engine → Risk Engine → Directives
 * 
 * Scenario posterior:
 *   P(TAIL) = clamp01(tailRisk * 0.8)
 *   P(RISK) = clamp01(regime_p_stress * 0.7 + vol_spike * 0.3)
 *   P(BASE) = 1 - P(RISK) - P(TAIL)
 * 
 * Override logic:
 *   1. Tail amplification: if q05 < threshold → amplify haircut
 *   2. Bull extension: if mean > 0 AND tailRisk < 0.2 AND guard = NONE → sizeScale 1.1
 *   3. Neutral dampening: if spread > threshold → allocations × 0.9
 */

import {
  QuantileForecastResponse,
  Horizon,
  HORIZONS,
  HorizonForecast,
} from '../ml/contracts/quantile_forecast.contract.js';
import { WorldStatePack } from '../contracts/world_state.contract.js';
import {
  ScenarioPack,
  ScenarioName,
  BrainDirectives,
  RiskMode,
  ScenarioDiagnostics,
} from '../contracts/brain_output.contract.js';
import { getBrainScenarioSanityService, SanityInput } from './brain_scenario_sanity.service.js';

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS
// ═══════════════════════════════════════════════════════════════

/** q05 thresholds per horizon for tail amplification */
const TAIL_Q05_THRESHOLDS: Record<Horizon, number> = {
  '30D': -0.03,
  '90D': -0.06,
  '180D': -0.10,
  '365D': -0.15,
};

/** Maximum q05 thresholds for haircut scaling */
const TAIL_Q05_MAX: Record<Horizon, number> = {
  '30D': -0.08,
  '90D': -0.15,
  '180D': -0.25,
  '365D': -0.40,
};

/** Spread thresholds per horizon for neutral dampening */
const SPREAD_THRESHOLDS: Record<Horizon, number> = {
  '30D': 0.04,
  '90D': 0.10,
  '180D': 0.16,
  '365D': 0.25,
};

const TAIL_RISK_THRESHOLD = 0.35;
const TAIL_MODE_THRESHOLD = 0.50;
const BULL_TAIL_RISK_MAX = 0.20;
const DAMPENING_FACTOR = 0.90;

// ═══════════════════════════════════════════════════════════════
// OVERRIDE REASONING (for debug endpoint)
// ═══════════════════════════════════════════════════════════════

export interface OverrideReasoning {
  tailAmplified: boolean;
  tailAmplificationDetails?: {
    horizon: string;
    q05: number;
    threshold: number;
    haircutScale: number;
  };
  bullExtension: boolean;
  bullExtensionDetails?: {
    mean: number;
    tailRisk: number;
    guardLevel: string;
    sizeScale: number;
  };
  neutralDampened: boolean;
  neutralDampeningDetails?: {
    horizon: string;
    spread: number;
    threshold: number;
    factor: number;
  };
  scenarioInputs: {
    maxTailRisk: number;
    regimePStress: number;
    volSpike: number;
    riskScore: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// SCENARIO ENGINE (with P12.0 Sanity Layer)
// ═══════════════════════════════════════════════════════════════

/**
 * Rolling TAIL rate tracker (simple in-memory)
 */
let tailRateHistory: boolean[] = [];
const TAIL_RATE_WINDOW = 12;

function updateTailRateHistory(isTail: boolean): number {
  tailRateHistory.push(isTail);
  if (tailRateHistory.length > TAIL_RATE_WINDOW) {
    tailRateHistory = tailRateHistory.slice(-TAIL_RATE_WINDOW);
  }
  return tailRateHistory.filter(Boolean).length / tailRateHistory.length;
}

export function getTailRateRolling(): number {
  if (tailRateHistory.length === 0) return 0;
  return tailRateHistory.filter(Boolean).length / tailRateHistory.length;
}

export function resetTailRateHistory(): void {
  tailRateHistory = [];
}

/**
 * Compute probabilistic scenario from forecast + world state
 * NOW WITH P12.0 Sanity Layer Integration
 */
export function computeForecastScenario(
  forecast: QuantileForecastResponse,
  world: WorldStatePack,
  options?: { skipSanity?: boolean }
): { scenario: ScenarioPack; reasoning: OverrideReasoning; diagnostics?: ScenarioDiagnostics } {
  const dxy = world.assets.dxy;
  const regimeProbs = dxy?.macroV2?.regime.probs || {};
  const guardLevel = dxy?.guard?.level || 'NONE';
  const crossAssetRegime = world.crossAsset?.regime?.label || undefined;
  
  // Get worst-case horizon metrics
  let maxTailRisk = 0;
  let worstQ05 = 0;
  let dominantHorizon: Horizon = '90D';
  let q05_90d = 0;
  let q50_90d = 0;
  let q95_90d = 0;
  
  for (const h of HORIZONS) {
    const hf = forecast.byHorizon[h];
    if (!hf) continue;
    
    if (hf.tailRisk > maxTailRisk) {
      maxTailRisk = hf.tailRisk;
      dominantHorizon = h;
    }
    if (hf.q05 < worstQ05) {
      worstQ05 = hf.q05;
    }
    
    // Get 90D for sanity input
    if (h === '90D') {
      q05_90d = hf.q05;
      q50_90d = hf.q50 ?? 0;
      q95_90d = hf.q95 ?? 0;
    }
  }
  
  // Fallback to 180D if 90D not available
  if (q05_90d === 0 && forecast.byHorizon['180D']) {
    q05_90d = forecast.byHorizon['180D'].q05;
    q50_90d = forecast.byHorizon['180D'].q50 ?? 0;
    q95_90d = forecast.byHorizon['180D'].q95 ?? 0;
  }
  
  // Extract stress/vol from world state
  const regimePStress = regimeProbs['STRESS'] || 0;
  
  // vol_spike: proxy from feature vector or world state
  const vol20d = dxy?.price?.realizedVol20d || 0;
  const volSpike = vol20d > 0.15 ? 1 : (vol20d > 0.10 ? 0.5 : 0);
  
  // Compute riskScore
  const riskScore = 0.5 * maxTailRisk + 0.3 * regimePStress + 0.2 * volSpike;
  
  // ─────────────────────────────────────────────────────────────
  // RAW Scenario Probabilities (before sanity)
  // P12.1 FIX: Calibrated rawScore to produce better distribution
  // Target: BASE 55-80%, RISK 15-40%, TAIL 2-15%
  // ─────────────────────────────────────────────────────────────
  
  // Calculate spread for uncertainty contribution
  const spread_90d = q95_90d - q05_90d;
  const spreadNorm = spread_90d / (Math.abs(q50_90d) + 0.04);
  
  // P12.1 FIX: Dampen tailRisk contribution when spreadNorm is extremely high
  // Very high spreadNorm indicates uncertain forecast, not necessarily tail risk
  let tailRiskDamped = maxTailRisk;
  if (spreadNorm > 2.0) {
    // Dampen tail risk by 30-50% when spread is very wide
    const dampFactor = Math.max(0.5, 1.0 - (spreadNorm - 2.0) * 0.15);
    tailRiskDamped = maxTailRisk * dampFactor;
  }
  
  // P12.1 FIX: Calculate pTail with dampened tailRisk
  let pTail = clamp01(tailRiskDamped * 0.6);  // Reduced from 0.8 to 0.6
  
  // P12.1 FIX: RISK should get contribution from spread (uncertainty = risk)
  // When spread is high but tail not extreme, this should increase RISK not TAIL
  const spreadRiskContrib = spreadNorm > 1.5 ? Math.min(0.3, (spreadNorm - 1.5) * 0.15) : 0;
  let pRisk = clamp01(regimePStress * 0.7 + volSpike * 0.3 + spreadRiskContrib);
  
  // P12.1 FIX: Transfer excess TAIL to RISK (cap TAIL at 25% raw)
  if (pTail > 0.25) {
    const excess = pTail - 0.25;
    pTail = 0.25;
    pRisk = Math.min(0.45, pRisk + excess * 0.7);  // 70% of excess goes to RISK
  }
  
  // P12.1 FIX: Ensure minimum RISK when uncertainty is high
  if (spreadNorm > 1.2 && pRisk < 0.15) {
    pRisk = 0.15;
  }
  
  let pBase = 1 - pRisk - pTail;
  
  // Guard overrides (guard has priority)
  if (guardLevel === 'BLOCK') {
    pTail = Math.max(pTail, 0.40);
    pRisk = Math.max(pRisk, 0.30);
    pBase = 1 - pRisk - pTail;
  } else if (guardLevel === 'CRISIS') {
    pTail = Math.max(pTail, 0.25);
    pRisk = Math.max(pRisk, 0.35);
    pBase = 1 - pRisk - pTail;
  } else if (guardLevel === 'WARN') {
    pRisk = Math.max(pRisk, 0.25);
    pBase = 1 - pRisk - pTail;
  }
  
  // Ensure pBase >= 0
  if (pBase < 0) {
    const total = pTail + pRisk;
    pTail /= total;
    pRisk /= total;
    pBase = 0;
  }
  
  // Normalize raw probabilities
  const rawSum = pBase + pRisk + pTail;
  if (rawSum > 0) {
    pBase /= rawSum;
    pRisk /= rawSum;
    pTail /= rawSum;
  }
  
  const rawProbs: Record<ScenarioName, number> = {
    BASE: Math.round(pBase * 10000) / 10000,
    RISK: Math.round(pRisk * 10000) / 10000,
    TAIL: Math.round(pTail * 10000) / 10000,
  };
  
  // ─────────────────────────────────────────────────────────────
  // P12.0 SANITY LAYER (if enabled)
  // ─────────────────────────────────────────────────────────────
  
  let finalProbs = rawProbs;
  let finalScenario: ScenarioName = 'BASE';
  let diagnostics: ScenarioDiagnostics | undefined;
  
  if (!options?.skipSanity) {
    const sanityService = getBrainScenarioSanityService();
    
    // Get mean from forecast for spreadNorm calculation
    const mean_90d = forecast.byHorizon['90D']?.mean ?? forecast.byHorizon['180D']?.mean ?? 0;
    
    const sanityInput: SanityInput = {
      q05: q05_90d,
      q50: q50_90d,
      q95: q95_90d,
      mean: mean_90d,
      realizedVol: vol20d,  // Use realized vol for better spreadNorm
      guardLevel,
      crossAssetRegime,
      tailRateRolling: getTailRateRolling(),
      rawProbs,
      riskScore,  // Pass riskScore for RISK gate
    };
    
    const sanityOutput = sanityService.applySanity(sanityInput);
    finalProbs = sanityOutput.finalProbs;
    finalScenario = sanityOutput.finalScenario;
    diagnostics = sanityOutput.diagnostics;
    
    // Update tail rate history
    updateTailRateHistory(finalScenario === 'TAIL');
  } else {
    // No sanity: use raw scenario
    if (rawProbs.TAIL >= 0.25) finalScenario = 'TAIL';
    else if (rawProbs.RISK >= 0.35) finalScenario = 'RISK';
    else finalScenario = 'BASE';
    
    // Still update history for consistency
    updateTailRateHistory(finalScenario === 'TAIL');
  }
  
  // Confidence from forecast model
  const confidence = forecast.model.isBaseline ? 0.4 : 0.7;
  
  const scenario: ScenarioPack = {
    name: finalScenario,
    probs: finalProbs,
    confidence,
    description: getScenarioDescription(finalScenario, forecast, world),
  };
  
  // Build initial reasoning (overrides will be added by computeOverrides)
  const reasoning: OverrideReasoning = {
    tailAmplified: false,
    bullExtension: false,
    neutralDampened: false,
    scenarioInputs: {
      maxTailRisk,
      regimePStress,
      volSpike,
      riskScore,
    },
  };
  
  return { scenario, reasoning, diagnostics };
}

// ═══════════════════════════════════════════════════════════════
// OVERRIDE LOGIC
// ═══════════════════════════════════════════════════════════════

/**
 * Compute forecast-driven overrides (haircuts, caps, scales)
 */
export function computeForecastOverrides(
  forecast: QuantileForecastResponse,
  world: WorldStatePack,
  scenario: ScenarioPack,
  reasoning: OverrideReasoning
): BrainDirectives {
  const directives: BrainDirectives = {
    caps: {},
    scales: {},
    haircuts: {},
    warnings: [],
  };
  
  const dxy = world.assets.dxy;
  const guardLevel = dxy?.guard?.level || 'NONE';
  const liquidityRegime = dxy?.liquidity?.regime || 'NEUTRAL';
  const macroScore = dxy?.macroV2?.scoreSigned || 0;
  
  // ─────────────────────────────────────────────────────────
  // GUARD HAS ABSOLUTE PRIORITY (preserved from v2)
  // ─────────────────────────────────────────────────────────
  
  if (guardLevel === 'BLOCK') {
    directives.caps = {
      spx: { maxSize: 0.05 },
      btc: { maxSize: 0.05 },
    };
    directives.riskMode = 'RISK_OFF';
    directives.warnings!.push('GUARD BLOCK: All risk assets capped to near-zero');
    return directives; // No further overrides needed
  }
  
  if (guardLevel === 'CRISIS') {
    directives.haircuts = {
      btc: 0.60,
      spx: 0.75,
    };
    directives.riskMode = 'RISK_OFF';
    directives.warnings!.push('GUARD CRISIS: Strong haircuts applied');
  }
  
  if (guardLevel === 'WARN') {
    directives.haircuts = {
      btc: 0.85,
      spx: 0.90,
    };
    directives.warnings!.push('GUARD WARN: Moderate risk reduction');
  }
  
  // ─────────────────────────────────────────────────────────
  // 1. TAIL AMPLIFICATION
  // If q05 < threshold → amplify haircut
  // ─────────────────────────────────────────────────────────
  
  for (const h of HORIZONS) {
    const hf = forecast.byHorizon[h];
    if (!hf) continue;
    
    const threshold = TAIL_Q05_THRESHOLDS[h];
    
    if (hf.q05 < threshold) {
      // haircutScale = 1 - clamp01(abs(q05) / thresholdMax)
      const thresholdMax = Math.abs(TAIL_Q05_MAX[h]);
      const absQ05 = Math.abs(hf.q05);
      const haircutScale = 1 - clamp01(absQ05 / thresholdMax);
      
      // Apply amplified haircuts
      const existingBtcHaircut = (directives.haircuts?.btc ?? 1);
      const existingSpxHaircut = (directives.haircuts?.spx ?? 1);
      
      directives.haircuts = {
        ...directives.haircuts,
        btc: Math.min(existingBtcHaircut, haircutScale),
        spx: Math.min(existingSpxHaircut, haircutScale * 1.1), // SPX less aggressive
      };
      
      reasoning.tailAmplified = true;
      reasoning.tailAmplificationDetails = {
        horizon: h,
        q05: hf.q05,
        threshold,
        haircutScale,
      };
      
      directives.warnings!.push(
        `TAIL AMP [${h}]: q05=${(hf.q05 * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}% → haircut ×${haircutScale.toFixed(2)}`
      );
      
      break; // Only apply once (worst horizon)
    }
  }
  
  // ─────────────────────────────────────────────────────────
  // 2. BULL EXTENSION
  // If mean > 0 AND tailRisk < 0.2 AND guard = NONE → sizeScale 1.1
  // ─────────────────────────────────────────────────────────
  
  const dominantForecast = forecast.byHorizon['90D'] || forecast.byHorizon['30D'];
  
  if (
    dominantForecast &&
    dominantForecast.mean > 0 &&
    dominantForecast.tailRisk < BULL_TAIL_RISK_MAX &&
    guardLevel === 'NONE' &&
    scenario.name === 'BASE'
  ) {
    const sizeScale = 1.1;
    directives.scales = {
      spx: { sizeScale },
      btc: { sizeScale },
    };
    
    reasoning.bullExtension = true;
    reasoning.bullExtensionDetails = {
      mean: dominantForecast.mean,
      tailRisk: dominantForecast.tailRisk,
      guardLevel,
      sizeScale,
    };
    
    directives.warnings!.push(
      `BULL EXT: mean=${(dominantForecast.mean * 100).toFixed(1)}%, tailRisk=${dominantForecast.tailRisk.toFixed(2)} → scale ×${sizeScale}`
    );
  }
  
  // ─────────────────────────────────────────────────────────
  // 3. NEUTRAL DAMPENING
  // If spread > threshold → allocations × 0.9
  // ─────────────────────────────────────────────────────────
  
  for (const h of HORIZONS) {
    const hf = forecast.byHorizon[h];
    if (!hf) continue;
    
    const spread = hf.q95 - hf.q05;
    const spreadThreshold = SPREAD_THRESHOLDS[h];
    
    if (spread > spreadThreshold) {
      // Only dampen if not already in tail/risk mode
      if (scenario.name === 'BASE' && !reasoning.tailAmplified) {
        const existingBtcScale = directives.scales?.btc?.sizeScale ?? 1;
        const existingSpxScale = directives.scales?.spx?.sizeScale ?? 1;
        
        directives.scales = {
          ...directives.scales,
          btc: { sizeScale: Math.min(existingBtcScale, DAMPENING_FACTOR) },
          spx: { sizeScale: Math.min(existingSpxScale, DAMPENING_FACTOR) },
        };
        
        reasoning.neutralDampened = true;
        reasoning.neutralDampeningDetails = {
          horizon: h,
          spread,
          threshold: spreadThreshold,
          factor: DAMPENING_FACTOR,
        };
        
        directives.warnings!.push(
          `DAMPEN [${h}]: spread=${(spread * 100).toFixed(1)}% > ${(spreadThreshold * 100).toFixed(0)}% → ×${DAMPENING_FACTOR}`
        );
      }
      
      break; // Only dampen once
    }
  }
  
  // ─────────────────────────────────────────────────────────
  // 4. RISK MODE (from scenario)
  // ─────────────────────────────────────────────────────────
  
  if (!directives.riskMode) {
    if (scenario.name === 'TAIL') {
      directives.riskMode = 'RISK_OFF';
    } else if (scenario.name === 'RISK') {
      directives.riskMode = 'RISK_OFF';
    } else if (reasoning.bullExtension) {
      directives.riskMode = 'RISK_ON';
    } else {
      directives.riskMode = 'NEUTRAL';
    }
  }
  
  // ─────────────────────────────────────────────────────────
  // 5. LIQUIDITY CONTRACTION + negative macro (preserved)
  // ─────────────────────────────────────────────────────────
  
  if (liquidityRegime === 'CONTRACTION' && macroScore < 0) {
    const existingBtcHaircut = directives.haircuts?.btc ?? 1;
    directives.haircuts = {
      ...directives.haircuts,
      btc: Math.min(existingBtcHaircut, 0.90),
    };
    directives.warnings!.push('Liquidity CONTRACTION + negative macro: Extra BTC haircut');
  }
  
  return directives;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function getScenarioDescription(
  name: ScenarioName,
  forecast: QuantileForecastResponse,
  world: WorldStatePack
): string {
  const regime = world.assets.dxy?.macroV2?.regime.name || 'UNKNOWN';
  const mean365 = forecast.byHorizon['365D']?.mean || 0;
  const direction = mean365 > 0 ? 'bullish' : 'bearish';
  
  switch (name) {
    case 'BASE':
      return `Normal conditions. ${regime} regime. MoE forecast: ${direction} bias at ${(mean365 * 100).toFixed(1)}% (365D).`;
    case 'RISK':
      return `Elevated stress. ${regime} regime with tail risks. Reducing risk exposure.`;
    case 'TAIL':
      return `Crisis mode. Severe tail risk detected. Capital preservation priority.`;
    default:
      return 'Unknown scenario';
  }
}
