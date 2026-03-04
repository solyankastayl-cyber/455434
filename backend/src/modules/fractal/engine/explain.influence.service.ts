/**
 * BLOCK 40.4 — Influence Attribution Service
 * 
 * Shapley-style attribution showing:
 * - Each horizon's contribution to final confidence/exposure
 * - Layer influence (which layer has most impact)
 * - Signal stability across scenarios
 * - "Why NOT trade" reasons
 */

import {
  HorizonInfluence,
  LayerInfluence,
  InfluenceAttribution,
  NoTradeReason,
  NoTradeExplain,
  FractalSide,
  CounterfactualScenario,
} from '../contracts/explain.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface HorizonData {
  horizonDays: number;
  rawScore: number;
  weight: number;
  contribution: number;
  side: FractalSide;
  confidence: number;
}

export interface InfluenceInputs {
  horizons: HorizonData[];
  finalSide: FractalSide;
  finalConfidence: number;
  finalExposure: number;
  entropy: number;
  reliability: number;
  effectiveN: number;
  phase: string;
  calibrationStatus: string;
  driftStatus: string;
  counterfactuals?: CounterfactualScenario[];
}

export interface NoTradeThresholds {
  minEffectiveN: number;
  maxEntropy: number;
  minConfidence: number;
  minReliability: number;
}

export const DEFAULT_NO_TRADE_THRESHOLDS: NoTradeThresholds = {
  minEffectiveN: 10,
  maxEntropy: 0.75,
  minConfidence: 0.35,
  minReliability: 0.30,
};

// ═══════════════════════════════════════════════════════════════
// Influence Attribution
// ═══════════════════════════════════════════════════════════════

/**
 * Compute influence attribution for horizons
 * Shows each horizon's % contribution to the final signal
 */
export function computeHorizonInfluence(
  horizons: HorizonData[],
  finalSide: FractalSide,
  finalConfidence: number,
  finalExposure: number
): HorizonInfluence[] {
  if (horizons.length === 0) return [];

  // Total weighted contribution
  const totalContribution = horizons.reduce((sum, h) => sum + Math.abs(h.contribution), 0);
  const totalWeight = horizons.reduce((sum, h) => sum + h.weight, 0);

  return horizons.map(h => {
    // Confidence contribution = weight × horizon_confidence / total
    const confidenceContribution = totalWeight > 0 
      ? (h.weight * h.confidence) / horizons.reduce((s, hh) => s + hh.weight * hh.confidence, 0)
      : 0;

    // Exposure contribution = abs(contribution) / total
    const exposureContribution = totalContribution > 0 
      ? Math.abs(h.contribution) / totalContribution
      : 0;

    // Signal alignment: 1 if agrees with final, -1 if opposite, 0 if neutral
    let signalAlignment = 0;
    if (finalSide !== 'NEUTRAL' && h.side !== 'NEUTRAL') {
      signalAlignment = h.side === finalSide ? 1 : -1;
    } else if (h.side === 'NEUTRAL') {
      signalAlignment = 0;
    }

    // Marginality: how close to flip (based on raw score magnitude)
    // Lower rawScore = more marginal
    const marginality = 1 - Math.min(1, Math.abs(h.rawScore) / 0.3);

    return {
      horizonDays: h.horizonDays,
      confidenceContribution: clamp01(confidenceContribution),
      exposureContribution: clamp01(exposureContribution),
      signalAlignment,
      marginality: clamp01(marginality),
    };
  });
}

/**
 * Compute layer influence from counterfactual scenarios
 * Shows which layers are essential (flipping them changes the signal)
 */
export function computeLayerInfluence(
  baseSide: FractalSide,
  counterfactuals: CounterfactualScenario[]
): LayerInfluence[] {
  if (!counterfactuals || counterfactuals.length === 0) return [];

  const layers: LayerInfluence[] = [];

  for (const cf of counterfactuals) {
    // Determine which toggle this scenario represents
    let layerName = cf.name;
    let description = '';

    if (cf.toggles.disableAgeDecay) {
      layerName = 'Age Decay';
      description = 'Weights recent patterns higher than old patterns';
    } else if (cf.toggles.disablePhaseDiversity) {
      layerName = 'Phase Diversity';
      description = 'Ensures matches come from different market phases';
    } else if (cf.toggles.disableEntropyGuard) {
      layerName = 'Entropy Guard';
      description = 'Reduces exposure when horizons disagree';
    } else if (cf.toggles.disableHorizonBudget) {
      layerName = 'Horizon Budget';
      description = 'Prevents single horizon from dominating';
    } else if (cf.toggles.disableReliabilityModifier) {
      layerName = 'Reliability Modifier';
      description = 'Adjusts confidence based on system health';
    }

    // Impact = how much confidence/exposure changed
    const impact = cf.deltaVsBase.confidenceDelta + cf.deltaVsBase.exposureDelta * 0.5;
    
    // Essential = removing this layer flips the signal
    const essential = cf.deltaVsBase.sideChanged;

    layers.push({
      layer: layerName,
      impact: clamp(impact, -1, 1),
      essential,
      description,
    });
  }

  // Sort by absolute impact
  layers.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  return layers;
}

/**
 * Compute full influence attribution
 */
export function computeInfluenceAttribution(inputs: InfluenceInputs): InfluenceAttribution {
  const horizons = computeHorizonInfluence(
    inputs.horizons,
    inputs.finalSide,
    inputs.finalConfidence,
    inputs.finalExposure
  );

  const layers = computeLayerInfluence(
    inputs.finalSide,
    inputs.counterfactuals ?? []
  );

  // Determine dominant factor
  let dominantFactor = 'Unknown';
  
  if (horizons.length > 0) {
    // Find horizon with highest exposure contribution
    const topHorizon = [...horizons].sort((a, b) => b.exposureContribution - a.exposureContribution)[0];
    dominantFactor = `Horizon ${topHorizon.horizonDays}d`;
  }

  if (layers.length > 0 && layers[0].essential) {
    dominantFactor = `${layers[0].layer} (essential)`;
  }

  // Stability score: 1 if no layers are essential, decreases with essential layers
  const essentialCount = layers.filter(l => l.essential).length;
  const stabilityScore = 1 - (essentialCount * 0.25);

  return {
    horizons,
    layers,
    dominantFactor,
    stabilityScore: clamp01(stabilityScore),
  };
}

// ═══════════════════════════════════════════════════════════════
// BLOCK 40.4 — No Trade Reasons
// ═══════════════════════════════════════════════════════════════

/**
 * Determine why the system is NOT trading
 * Critical institutional element for audit trails
 */
export function computeNoTradeReasons(
  inputs: {
    signal: FractalSide;
    action: string;
    effectiveN: number;
    entropy: number;
    confidence: number;
    reliability: number;
    calibrationStatus: string;
    driftStatus: string;
    phase: string;
    freezeActive?: boolean;
  },
  thresholds: NoTradeThresholds = DEFAULT_NO_TRADE_THRESHOLDS
): NoTradeExplain {
  const reasons: NoTradeReason[] = [];
  const details: Record<NoTradeReason, string> = {} as any;

  // Check all no-trade conditions
  if (inputs.effectiveN < thresholds.minEffectiveN) {
    reasons.push('LOW_EFFECTIVE_N');
    details['LOW_EFFECTIVE_N'] = `Effective N (${inputs.effectiveN.toFixed(1)}) below minimum (${thresholds.minEffectiveN})`;
  }

  if (inputs.entropy > thresholds.maxEntropy) {
    reasons.push('HIGH_ENTROPY');
    details['HIGH_ENTROPY'] = `Entropy (${inputs.entropy.toFixed(2)}) exceeds maximum (${thresholds.maxEntropy})`;
  }

  if (inputs.calibrationStatus === 'DEGRADED' || inputs.calibrationStatus === 'CRITICAL') {
    reasons.push('CALIBRATION_DEGRADED');
    details['CALIBRATION_DEGRADED'] = `Calibration status is ${inputs.calibrationStatus}`;
  }

  if (inputs.driftStatus === 'DEGRADED' || inputs.driftStatus === 'CRITICAL') {
    reasons.push('DRIFT_DETECTED');
    details['DRIFT_DETECTED'] = `Drift status is ${inputs.driftStatus}`;
  }

  if (inputs.reliability < thresholds.minReliability) {
    reasons.push('RELIABILITY_CRITICAL');
    details['RELIABILITY_CRITICAL'] = `Reliability (${inputs.reliability.toFixed(2)}) below critical threshold (${thresholds.minReliability})`;
  }

  if (inputs.freezeActive) {
    reasons.push('FREEZE_ACTIVE');
    details['FREEZE_ACTIVE'] = 'Trading is frozen by reliability policy';
  }

  if (inputs.phase === 'CAPITULATION') {
    reasons.push('PHASE_CAPITULATION');
    details['PHASE_CAPITULATION'] = 'Market phase is CAPITULATION - high uncertainty';
  }

  if (inputs.confidence < thresholds.minConfidence && inputs.signal !== 'NEUTRAL') {
    reasons.push('LOW_CONFIDENCE');
    details['LOW_CONFIDENCE'] = `Confidence (${inputs.confidence.toFixed(2)}) below minimum (${thresholds.minConfidence})`;
  }

  // Check for consensus split (if we have horizon data)
  // This would need additional data passed in

  const active = reasons.length > 0 || inputs.signal === 'NEUTRAL' || inputs.action === 'SKIP';

  return {
    active,
    reasons,
    details,
    threshold: thresholds,
  };
}

// ═══════════════════════════════════════════════════════════════
// BLOCK 40.5 — Institutional Badge Breakdown
// ═══════════════════════════════════════════════════════════════

export interface InstitutionalBadgeBreakdown {
  score: number;
  label: string;
  components: {
    robustness: number;      // From reliability + effectiveN
    tailRisk: number;        // From MC/risk metrics
    stability: number;       // From PSS + entropy
    calibration: number;     // From calibration quality
    consensus: number;       // From horizon agreement
  };
  maxExposureAllowed: number;
  recommendations: string[];
}

/**
 * Break down institutional score into components
 * Shows exactly why the badge is what it is
 */
export function computeInstitutionalBreakdown(inputs: {
  reliability: number;
  effectiveN: number;
  stability: number;       // PSS
  entropy: number;
  calibrationQuality: number;
  tailRiskScore: number;
  consensusScore: number;
  institutionalScore: number;
  institutionalLabel: string;
}): InstitutionalBadgeBreakdown {
  // Robustness = reliability + effectiveN contribution
  const effectiveNCap = Math.min(1, inputs.effectiveN / 30);
  const robustness = inputs.reliability * 0.6 + effectiveNCap * 0.4;

  // Tail risk health (inverted - higher is better)
  const tailRisk = 1 - inputs.tailRiskScore;

  // Stability = PSS combined with entropy penalty
  const entropyPenalty = 1 - inputs.entropy;
  const stability = inputs.stability * 0.7 + entropyPenalty * 0.3;

  // Calibration (direct pass-through)
  const calibration = inputs.calibrationQuality;

  // Consensus (from horizon agreement)
  const consensus = inputs.consensusScore;

  // Determine max exposure based on institutional score
  let maxExposureAllowed = 1.0;
  if (inputs.institutionalScore >= 0.75) {
    maxExposureAllowed = 1.0;  // CONSERVATIVE
  } else if (inputs.institutionalScore >= 0.55) {
    maxExposureAllowed = 0.70; // MODERATE
  } else if (inputs.institutionalScore >= 0.35) {
    maxExposureAllowed = 0.40; // AGGRESSIVE
  } else {
    maxExposureAllowed = 0.0;  // DEGRADED - pause trading
  }

  // Generate recommendations
  const recommendations: string[] = [];
  
  if (robustness < 0.5) {
    recommendations.push('Improve reliability by monitoring drift and calibration');
  }
  if (tailRisk < 0.5) {
    recommendations.push('Elevated tail risk - consider reducing position sizes');
  }
  if (stability < 0.5) {
    recommendations.push('Low pattern stability - signal may be fragile');
  }
  if (calibration < 0.5) {
    recommendations.push('Calibration quality low - confidence estimates may be unreliable');
  }
  if (consensus < 0.5) {
    recommendations.push('Horizons disagree - wait for clearer consensus');
  }

  return {
    score: inputs.institutionalScore,
    label: inputs.institutionalLabel,
    components: {
      robustness: clamp01(robustness),
      tailRisk: clamp01(tailRisk),
      stability: clamp01(stability),
      calibration: clamp01(calibration),
      consensus: clamp01(consensus),
    },
    maxExposureAllowed,
    recommendations,
  };
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function clamp(x: number, min: number, max: number): number {
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}
