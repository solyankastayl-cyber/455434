/**
 * S10.8 — Meta-Brain Service
 * 
 * Orchestrates the three intelligences:
 * - Sentiment → Intent (what they say)
 * - On-chain → Reality (what they do)
 * - Exchange → Market State (environment)
 * 
 * Exchange is READ-ONLY: explains environment, doesn't predict.
 * 
 * P0.2 — Meta-Brain Hardening: Formal invariants enforced
 * P0.3 — Market Regime → Decision Contract Lock
 */

import {
  ExchangeContext,
  MetaBrainVerdict,
  VerdictStrength,
  ImpactRules,
  DEFAULT_IMPACT_RULES,
  DowngradeLogEntry,
  ExchangeImpactMetrics,
  WhaleRiskContext,
} from './meta-brain.types.js';
import {
  applyExchangeImpact,
  getDowngradeLog,
  getImpactMetrics,
  resetMetrics,
} from './exchange-impact.js';
import {
  validateInvariants,
  InvariantContext,
  MacroRegimeRisk,
} from './meta-brain.guard.js';
// P0.2 — Formal Invariants
import {
  enforceInvariants,
  buildInvariantContext,
  canDoStrongAction,
  getConfidenceCap,
  type EnforcerResult,
  type VerdictSnapshot,
} from './invariants/index.js';
// P0.2 — Guards
import { guardMacroContext, type GuardedMacroContext } from './guards/macro.guard.js';
import { guardMLResult, type GuardedMLResult } from './guards/ml.guard.js';
import { guardLabs, hasLabsConflict, type GuardedLabsResult } from './guards/labs.guard.js';
// P0.3 — Decision Context Contract
import {
  validateDecisionContext,
  createDecisionContextFromMacro,
  createDefaultDecisionContext,
  type DecisionContext,
  type DecisionMacroContext,
} from './contracts/decision.context.js';
import * as patternService from '../exchange/patterns/pattern.service.js';
import * as mlService from '../exchange-ml/ml.service.js';
import { getRegimeState } from '../exchange/regimes/regime.service.js';
import { detectWhalePatterns } from '../exchange/whales/patterns/whale-pattern.detector.js';
import { getCachedWhaleState, getCachedWhaleIndicators } from '../exchange/indicators/calculators/whale.calculators.js';
import { getMacroSignal, calculateMacroImpact, MacroSignal, MacroImpact } from '../macro/index.js';
import { getMacroIntelContext } from '../macro-intel/services/macro-intel.snapshot.service.js';
import { mlModifierService } from '../exchange-ml/ml.modifier.service.js';
// P1.3/P1.4 imports commented out for now - will be enabled after fixing path issues
// import { calculateAttribution } from '../exchange/labs/labs-attribution.service.js';
// import { generateExplainability } from '../exchange/labs/labs-explainability.service.js';
import { mlPromotionService } from '../exchange-ml/ml.promotion.service.js';
import type { RegimeId, MacroContextLite } from '../exchange-ml/contracts/mlops.promotion.types.js';

// ═══════════════════════════════════════════════════════════════
// BUILD EXCHANGE CONTEXT
// ═══════════════════════════════════════════════════════════════

export async function buildExchangeContext(symbol: string): Promise<ExchangeContext> {
  const now = Date.now();
  
  // Get regime state
  const regimeState = getRegimeState(symbol);
  
  // Get pattern state
  const patternState = patternService.getPatternState(symbol);
  
  // Get ML registry
  const registry = mlService.getMLRegistryState();
  
  // Calculate market stress from various sources
  const marketStress = calculateMarketStress(regimeState, patternState);
  
  // Determine liquidity state
  const liquidityState = determineLiquidityState(regimeState);
  
  // Get ML verdict - use rules-based for now
  const mlVerdict = registry.status === 'FROZEN' ? 
    (registry.healthStatus === 'STABLE' ? 'USE' : registry.healthStatus === 'WATCH' ? 'IGNORE' : 'WARNING') as 'USE' | 'IGNORE' | 'WARNING' :
    'IGNORE';
  
  // S10.W Step 7: Build Whale Risk Context
  const whaleRisk = buildWhaleRiskContext(symbol);
  
  return {
    regime: regimeState?.regime || 'NEUTRAL',
    regimeConfidence: regimeState?.confidence || 0,
    marketStress,
    flowBias: determineFlowBias(regimeState),
    flowDominance: regimeState?.drivers?.volumeDelta ? Math.abs(regimeState.drivers.volumeDelta / 30) : 0.5,
    liquidityState,
    patternSummary: {
      count: patternState.patterns.length,
      bullish: patternState.bullishCount,
      bearish: patternState.bearishCount,
      neutral: patternState.neutralCount,
      hasConflict: patternState.hasConflict,
      topPatterns: patternState.patterns.slice(0, 3).map(p => p.name),
    },
    mlVerdict,
    mlConfidence: registry.agreementRate || 0.5,
    whaleRisk,
    timestamp: now,
  };
}

// ═══════════════════════════════════════════════════════════════
// S10.W Step 7: BUILD WHALE RISK CONTEXT
// ═══════════════════════════════════════════════════════════════

function buildWhaleRiskContext(symbol: string): WhaleRiskContext | undefined {
  // Get whale pattern snapshot
  const patternSnapshot = detectWhalePatterns(symbol);
  
  // Get cached whale state
  const whaleState = getCachedWhaleState(symbol);
  const whaleIndicators = getCachedWhaleIndicators(symbol);
  
  // If no whale data, return undefined
  if (!whaleIndicators && patternSnapshot.patterns.length === 0) {
    return undefined;
  }
  
  // Find highest risk active pattern
  const activePatterns = patternSnapshot.patterns.filter(p => p.active);
  const highestRisk = activePatterns.length > 0
    ? activePatterns.reduce((a, b) => a.riskScore > b.riskScore ? a : b)
    : null;
  
  // Determine risk bucket
  const maxRiskScore = Math.max(
    highestRisk?.riskScore ?? 0,
    whaleIndicators?.contrarian_pressure_index ?? 0
  );
  
  let riskBucket: 'LOW' | 'MID' | 'HIGH' = 'LOW';
  if (maxRiskScore >= 0.7) riskBucket = 'HIGH';
  else if (maxRiskScore >= 0.4) riskBucket = 'MID';
  
  // Estimate lift (simplified - in production would come from LABS-05)
  // For now, use a heuristic: high CPI + high SHPI = high lift
  let lift = 1.0;
  if (whaleIndicators) {
    const cpi = whaleIndicators.contrarian_pressure_index;
    const shpi = whaleIndicators.stop_hunt_probability;
    lift = 1.0 + (cpi * 0.5) + (shpi * 0.3);
  }
  
  // Data freshness
  const dataAgeSec = whaleState
    ? Math.floor((Date.now() - whaleState.timestamp) / 1000)
    : 3600; // 1 hour default if no data
  
  return {
    activePattern: highestRisk?.patternId ?? null,
    riskBucket,
    riskScore: maxRiskScore,
    lift,
    horizon: '15m', // Default horizon
    confidence: whaleState?.confidence ?? 0,
    dataAgeSec,
  };
}

// ═══════════════════════════════════════════════════════════════
// PROCESS VERDICT WITH EXCHANGE CONTEXT
// ═══════════════════════════════════════════════════════════════

export async function processVerdict(
  symbol: string,
  inputVerdict: {
    direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
    strength: VerdictStrength;
    sentimentSource?: { confidence: number; direction: string };
    onchainSource?: { confidence: number; validation: string };
  },
  rules?: ImpactRules
): Promise<MetaBrainVerdict> {
  // Build current exchange context
  const exchangeContext = await buildExchangeContext(symbol);
  
  // Apply exchange impact first
  let verdict = applyExchangeImpact(inputVerdict, exchangeContext, rules);
  
  // Get Macro Intel Context for ML integration
  let macroIntelContext: MacroContextLite | null = null;
  try {
    const macroIntel = await getMacroIntelContext();
    macroIntelContext = {
      regimeId: macroIntel.regime as RegimeId,
      risk: macroIntel.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH',
      fearGreed: macroIntel.fearGreed,
      btcDom: macroIntel.btcDominance,
      stableDom: macroIntel.stableDominance,
      macroModifier: macroIntel.confidenceMultiplier,
      blocks: {
        codes: Object.entries(macroIntel.flags)
          .filter(([, v]) => v)
          .map(([k]) => k),
        blocked: macroIntel.blockStrongActions,
      },
    };
  } catch (error: any) {
    console.warn('[Meta-Brain] Macro Intel unavailable:', error.message);
  }
  
  // Apply Macro Context Layer
  try {
    const macroSignal = await getMacroSignal();
    const macroImpact = calculateMacroImpact(macroSignal);
    
    if (macroImpact.applied) {
      // Apply confidence multiplier from macro
      verdict.finalConfidence = verdict.finalConfidence * macroImpact.confidenceMultiplier;
      
      // Block STRONG if macro says so
      if (macroImpact.blockedStrong && verdict.finalStrength === 'STRONG') {
        verdict.finalStrength = 'WEAK';
        verdict.downgraded = true;
      }
      
      // Add macro context to verdict
      verdict.macroContext = {
        flags: macroSignal.flags,
        confidenceMultiplier: macroImpact.confidenceMultiplier,
        blockedStrong: macroImpact.blockedStrong,
        reason: macroImpact.reason,
      };
    }
  } catch (error: any) {
    console.warn('[Meta-Brain] Macro context unavailable:', error.message);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ML CALIBRATION (ACTIVE_SAFE mode)
  // ═══════════════════════════════════════════════════════════════
  
  try {
    const promotionState = await mlPromotionService.getState();
    
    // Only apply ML if we have macro context
    if (macroIntelContext && promotionState.mode !== 'OFF') {
      // Map direction to action
      const baseAction = inputVerdict.direction === 'BULLISH' ? 'BUY' :
                         inputVerdict.direction === 'BEARISH' ? 'SELL' : 'AVOID';
      
      // Apply ML modifier
      const mlResult = mlModifierService.apply(
        {
          dataMode: 'LIVE', // TODO: get actual dataMode from observability
          symbol,
          baseAction,
          baseConfidence: verdict.finalConfidence,
          macro: macroIntelContext,
          // ML calibration output would come from actual ML model
          ml: {
            pCalibrated: 0.5, // Neutral for now until model is trained
            drift: { state: 'HEALTHY', score: 0.1 },
            modelId: promotionState.activeModelId,
          },
        },
        promotionState
      );
      
      // Apply ML result to verdict
      if (mlResult.applied) {
        verdict.finalConfidence = mlResult.finalConfidence;
      }
      
      // Add ML calibration to verdict
      verdict.mlCalibration = {
        applied: mlResult.applied,
        modelId: mlResult.modelId,
        mlModifier: mlResult.mlModifier,
        macroModifier: mlResult.macroModifier,
        capApplied: mlResult.capApplied,
        reasonCodes: mlResult.reasonCodes,
        mode: promotionState.mode,
      };
    }
  } catch (error: any) {
    console.warn('[Meta-Brain] ML calibration unavailable:', error.message);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // P0.3 — ASSET TRUTH LAYER INTEGRATION
  // ═══════════════════════════════════════════════════════════════
  
  let venueAgreementModifier = 1.0;
  try {
    const { getVenueMLFeatures } = await import('../assets/services/truth.resolver.js');
    const mlFeatures = await getVenueMLFeatures(symbol);
    
    if (mlFeatures) {
      // P0.3: Apply venue agreement score to confidence
      // Low agreement (< 0.5) = max 0.85 confidence modifier
      // High dispersion (> 0.3%) = additional penalty
      
      const agreementScore = mlFeatures.venueAgreementScore;
      const dispersion = mlFeatures.venueDispersion;
      
      if (agreementScore < 0.5) {
        // Low venue agreement = reduce confidence
        venueAgreementModifier = 0.7 + (agreementScore * 0.3); // 0.7 to 0.85
        console.log(`[Meta-Brain] P0.3: Low venue agreement (${(agreementScore * 100).toFixed(1)}%), confidence modifier: ${venueAgreementModifier.toFixed(2)}`);
      } else if (agreementScore < 0.8) {
        // Medium agreement
        venueAgreementModifier = 0.85 + ((agreementScore - 0.5) / 0.3 * 0.15); // 0.85 to 1.0
      }
      
      // High dispersion penalty
      if (dispersion > 0.3) {
        const dispersionPenalty = Math.max(0.9, 1 - (dispersion - 0.3) * 0.1);
        venueAgreementModifier *= dispersionPenalty;
        console.log(`[Meta-Brain] P0.3: High venue dispersion (${dispersion.toFixed(2)}%), penalty: ${dispersionPenalty.toFixed(2)}`);
      }
      
      // Apply modifier to confidence
      verdict.finalConfidence = verdict.finalConfidence * venueAgreementModifier;
      
      // Add asset truth context to verdict
      verdict.assetTruth = {
        venueAgreementScore: agreementScore,
        venueDispersion: dispersion,
        dominantVenue: mlFeatures.dominantVenue,
        activeVenueCount: mlFeatures.activeVenueCount,
        confidenceModifier: venueAgreementModifier,
        applied: venueAgreementModifier < 1,
      };
    }
  } catch (error: any) {
    console.warn('[Meta-Brain] P0.3: Asset truth unavailable:', error.message);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // P0.2 — FORMAL INVARIANT ENFORCEMENT (FINAL CHECK)
  // ═══════════════════════════════════════════════════════════════
  
  try {
    // Map regime to risk level
    const riskMapping: Record<string, MacroRegimeRisk> = {
      'PANIC_SELL_OFF': 'EXTREME',
      'CAPITAL_EXIT': 'EXTREME',
      'FULL_RISK_OFF': 'HIGH',
      'BTC_MAX_PRESSURE': 'HIGH',
      'BTC_FLIGHT_TO_SAFETY': 'MEDIUM',
      'ALT_ROTATION': 'MEDIUM',
      'BTC_LEADS_ALT_FOLLOW': 'LOW',
      'ALT_SEASON': 'LOW',
    };
    
    const riskLevel = riskMapping[macroIntelContext?.regime || ''] || 'MEDIUM';
    const macroFlags = verdict.macroContext?.flags || [];
    
    // Legacy invariant check (for backwards compatibility)
    const invariantCtx: InvariantContext = {
      regime: macroIntelContext?.regime || 'NEUTRAL',
      riskLevel,
      macroFlags,
      baseAction: inputVerdict.direction === 'BULLISH' ? 'BUY' : 
                  inputVerdict.direction === 'BEARISH' ? 'SELL' : 'AVOID',
      baseStrength: verdict.finalStrength,
      baseConfidence: verdict.finalConfidence,
    };
    
    const invariantResult = validateInvariants(invariantCtx);
    
    // P0.2 — NEW: Formal invariant enforcement via registry
    const baseAction = inputVerdict.direction === 'BULLISH' ? 'BUY' :
                       inputVerdict.direction === 'BEARISH' ? 'SELL' : 'AVOID' as const;
    
    const verdictSnapshot: VerdictSnapshot = {
      baseAction,
      baseConfidence: inputVerdict.confidence,
      baseStrength: inputVerdict.strength,
      finalAction: baseAction, // Will be same unless blocked
      finalConfidence: verdict.finalConfidence,
      finalStrength: verdict.finalStrength,
      macroRegime: macroIntelContext?.regime || 'NEUTRAL',
      macroRisk: riskLevel as 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME',
      macroConfidenceMultiplier: verdict.macroContext?.confidenceMultiplier || 1,
      macroFlags,
      mlApplied: verdict.mlCalibration?.applied || false,
      mlModifier: verdict.mlCalibration?.mlModifier || 1,
      mlRequestedAction: undefined,
      hasConflict: false,
    };
    
    const formalContext = buildInvariantContext(verdictSnapshot);
    const formalResult: EnforcerResult = enforceInvariants(formalContext);
    
    // Apply corrections from BOTH legacy and formal checks
    const allViolations = [
      ...invariantResult.violations,
      ...formalResult.violations.map(v => v.reason),
    ];
    
    const hasHardViolation = !invariantResult.passed || formalResult.hasHardViolation;
    
    if (hasHardViolation) {
      // Force AVOID for hard violations
      if (formalResult.forceDecision === 'AVOID') {
        verdict.finalConfidence = Math.min(verdict.finalConfidence, 0.25);
      }
      verdict.finalStrength = invariantResult.finalStrength;
      verdict.finalConfidence = Math.min(verdict.finalConfidence, invariantResult.finalConfidence);
      verdict.downgraded = true;
    } else if (formalResult.confidencePenalty < 1) {
      // Apply soft penalties
      verdict.finalConfidence = verdict.finalConfidence * formalResult.confidencePenalty;
    }
    
    // Add invariant check to verdict (merged)
    verdict.invariantCheck = {
      passed: !hasHardViolation && allViolations.length === 0,
      violations: [...new Set(allViolations)], // Dedupe
      blocked: invariantResult.blocked || formalResult.hasHardViolation,
      blockReason: invariantResult.blockReason || 
        (formalResult.hasHardViolation ? formalResult.violations[0]?.reason : undefined),
    };
    
    // Log for audit
    if (formalResult.violations.length > 0) {
      console.log('[Meta-Brain] Invariant violations:', formalResult.audit);
    }
  } catch (error: any) {
    console.warn('[Meta-Brain] Invariant validation error:', error.message);
  }
  
  // P1.3/P1.4 — Attribution and Explainability (will be added inline)
  // For now, add basic explainability
  try {
    const action = inputVerdict.direction === 'BULLISH' ? 'BUY' : 
                   inputVerdict.direction === 'BEARISH' ? 'SELL' : 'AVOID';
    
    verdict.explain = {
      decision: {
        title: action === 'BUY' ? 'WHY BUY' : action === 'SELL' ? 'WHY SELL' : 'WHY AVOID',
        summary: action === 'AVOID' 
          ? 'Insufficient conviction or macro blocks aggressive actions.'
          : `${inputVerdict.direction} signal detected with ${verdict.finalStrength.toLowerCase()} strength.`,
        bullets: [
          `Final confidence: ${Math.round(verdict.finalConfidence * 100)}%`,
          macroIntelContext?.regime ? `Macro regime: ${macroIntelContext.regime}` : 'Macro: Normal',
          verdict.invariantCheck?.blocked ? 'Strong actions blocked by macro' : 'Macro allows action',
        ],
      },
      macroContext: {
        title: 'MACRO CONTEXT',
        summary: macroIntelContext?.regime 
          ? `Market in ${macroIntelContext.regime}. Risk level: ${macroIntelContext.riskLevel}.`
          : 'No macro context available.',
        bullets: [
          `Risk: ${macroIntelContext?.riskLevel || 'MEDIUM'}`,
          `Confidence cap: ${Math.round((verdict.macroContext?.confidenceMultiplier || 1) * 100)}%`,
        ],
      },
      risks: {
        title: 'RISKS',
        summary: verdict.invariantCheck?.blocked 
          ? 'Elevated risk environment - caution advised.'
          : 'Standard market risk applies.',
        bullets: verdict.invariantCheck?.violations || ['No specific risks identified'],
      },
      confidence: {
        title: 'CONFIDENCE',
        summary: verdict.finalConfidence >= 0.7 
          ? 'High confidence in this analysis.'
          : verdict.finalConfidence >= 0.5 
            ? 'Moderate confidence - some uncertainty remains.'
            : 'Low confidence - proceed with caution.',
        bullets: [`Final: ${Math.round(verdict.finalConfidence * 100)}%`],
      },
    };
    
    // Basic attribution
    verdict.attribution = {
      supporting: [],
      opposing: [],
      neutral: [],
      ignored: [],
      summary: {
        totalLabs: 0,
        supportingCount: 0,
        opposingCount: 0,
        neutralCount: 0,
        confidenceAdjustment: 0,
      },
    };
  } catch (error: any) {
    console.warn('[Meta-Brain] Explainability error:', error.message);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // P0.4 — CREATE DECISION SNAPSHOT (IMMUTABLE AUDIT)
  // ═══════════════════════════════════════════════════════════════
  
  try {
    const { createSnapshot } = await import('./snapshots/index.js');
    
    const baseAction = inputVerdict.direction === 'BULLISH' ? 'BUY' :
                       inputVerdict.direction === 'BEARISH' ? 'SELL' : 'AVOID' as const;
    
    await createSnapshot({
      asset: symbol,
      input: {
        direction: inputVerdict.direction,
        confidence: inputVerdict.confidence,
        strength: inputVerdict.strength,
      },
      macroContext: {
        regime: macroIntelContext?.regime || 'NEUTRAL',
        riskLevel: (macroIntelContext?.riskLevel || 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME',
        fearGreed: macroIntelContext?.fearGreed || 50,
        btcDominance: macroIntelContext?.btcDom || 50,
        stableDominance: macroIntelContext?.stableDom || 10,
        flags: verdict.macroContext?.flags || [],
        confidenceMultiplier: verdict.macroContext?.confidenceMultiplier || 1,
        blockedStrong: verdict.macroContext?.blockedStrong || false,
      },
      assetTruth: verdict.assetTruth ? {
        venueAgreementScore: verdict.assetTruth.venueAgreementScore,
        venueDispersion: verdict.assetTruth.venueDispersion,
        dominantVenue: verdict.assetTruth.dominantVenue,
        activeVenueCount: verdict.assetTruth.activeVenueCount,
      } : undefined,
      mlCalibration: verdict.mlCalibration ? {
        applied: verdict.mlCalibration.applied,
        modelId: verdict.mlCalibration.modelId || null,
        mlModifier: verdict.mlCalibration.mlModifier,
        mode: verdict.mlCalibration.mode,
      } : undefined,
      labsSignals: {
        supporting: verdict.attribution?.supporting?.map(s => s.labId) || [],
        opposing: verdict.attribution?.opposing?.map(o => o.labId) || [],
        ignored: verdict.attribution?.ignored?.map(i => i.labId) || [],
      },
      invariantCheck: {
        passed: verdict.invariantCheck?.passed || true,
        violations: verdict.invariantCheck?.violations || [],
        hardViolations: verdict.invariantCheck?.violations?.filter(v => v.includes('HARD')).length || 0,
        softViolations: verdict.invariantCheck?.violations?.filter(v => v.includes('SOFT')).length || 0,
      },
      finalDecision: {
        action: baseAction,
        confidence: verdict.finalConfidence,
        strength: verdict.finalStrength,
        downgraded: verdict.downgraded,
        downgradeReasons: verdict.downgradeReason ? [verdict.downgradeReason] : [],
      },
    });
  } catch (error: any) {
    console.warn('[Meta-Brain] P0.4: Snapshot creation error:', error.message);
  }
  
  return verdict;
}

// ═══════════════════════════════════════════════════════════════
// SIMULATE VERDICT (for testing)
// ═══════════════════════════════════════════════════════════════

export async function simulateVerdict(
  symbol: string,
  simulatedInput?: {
    direction?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence?: number;
    strength?: VerdictStrength;
  }
): Promise<MetaBrainVerdict> {
  // Use simulated or default input
  const input = {
    direction: simulatedInput?.direction || 'BULLISH',
    confidence: simulatedInput?.confidence || 0.8,
    strength: simulatedInput?.strength || 'STRONG' as VerdictStrength,
    sentimentSource: { confidence: 0.75, direction: 'BULLISH' },
    onchainSource: { confidence: 0.7, validation: 'CONFIRMED' },
  };
  
  return processVerdict(symbol, input);
}

// ═══════════════════════════════════════════════════════════════
// ADMIN API
// ═══════════════════════════════════════════════════════════════

export function getExchangeImpactMetrics(): ExchangeImpactMetrics {
  return getImpactMetrics();
}

export function getRecentDowngrades(limit: number = 20): DowngradeLogEntry[] {
  return getDowngradeLog(limit);
}

export function resetExchangeImpactMetrics(): void {
  resetMetrics();
}

export function getImpactRules(): ImpactRules {
  return { ...DEFAULT_IMPACT_RULES };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function calculateMarketStress(regimeState: any, patternState: any): number {
  let stress = 0;
  
  // Regime contribution
  const stressfulRegimes = ['LONG_SQUEEZE', 'SHORT_SQUEEZE', 'EXHAUSTION', 'DISTRIBUTION'];
  if (stressfulRegimes.includes(regimeState?.regime)) {
    stress += 0.4 * (regimeState?.confidence || 0.5);
  }
  
  // Pattern conflict contribution
  if (patternState.hasConflict) {
    const conflictCount = Math.min(patternState.bullishCount, patternState.bearishCount);
    stress += 0.15 * conflictCount;
  }
  
  // High pattern count = noise
  if (patternState.patterns.length > 5) {
    stress += 0.1;
  }
  
  return Math.min(1, stress);
}

function determineLiquidityState(regimeState: any): 'THIN' | 'NORMAL' | 'HEAVY' {
  const volumeDelta = regimeState?.drivers?.volumeDelta || 0;
  
  if (volumeDelta < -20) return 'THIN';
  if (volumeDelta > 30) return 'HEAVY';
  return 'NORMAL';
}

function determineFlowBias(regimeState: any): 'BUY' | 'SELL' | 'NEUTRAL' {
  const regime = regimeState?.regime;
  
  if (regime === 'LONG_SQUEEZE' || regime === 'DISTRIBUTION') return 'SELL';
  if (regime === 'SHORT_SQUEEZE' || regime === 'ACCUMULATION') return 'BUY';
  if (regime === 'EXPANSION') {
    // Check price direction
    const priceDelta = regimeState?.drivers?.priceDelta || 0;
    if (priceDelta > 1) return 'BUY';
    if (priceDelta < -1) return 'SELL';
  }
  return 'NEUTRAL';
}

console.log('[S10.8] Meta-Brain Service initialized');
