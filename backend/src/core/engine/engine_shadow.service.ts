/**
 * Engine Shadow Mode Service
 * 
 * Compares v1.1 (production) vs v2 (ML-assisted) decisions
 * v2 results are stored but do NOT affect UI/alerts/Telegram
 * 
 * Architecture:
 * DecisionRequest
 *    ├── Engine v1.1 → FINAL decision (production)
 *    └── Engine v2 (ML-assisted) → shadowDecision (logged only)
 */
import { EngineInput } from './engine_decision_v1_1.service.js';
import { extractFeatures, EngineFeatureVector } from './engine_feature_extractor.js';
import { calculateMLScoring, MLScoringOutput, ML_CONFIG } from './engine_ml_scoring.js';
import { EngineShadowDecisionModel } from './engine_shadow.model.js';
import { ENGINE_CONFIG } from './engine_decision_v1_1.service.js';

// ============ SHADOW MODE CONFIGURATION ============

export const SHADOW_CONFIG = {
  enabled: true,  // Shadow mode enabled by default
  v2Active: false, // v2 is NOT active for production
  
  // Kill conditions (v2 cannot go to production if these fail)
  killConditions: {
    maxBuySellIncrease: 0.10,    // v2 BUY/SELL cannot be >10% more than v1.1
    maxFlipRate: 0.15,           // 15%
    minCoverageForBuySell: 60,   // No BUY/SELL below 60% coverage
    minAgreementRate: 0.70,      // 70% agreement minimum
  },
};

// ============ SHADOW DECISION TYPES ============

export interface ShadowDecision {
  v1Decision: {
    decision: 'BUY' | 'SELL' | 'NEUTRAL';
    confidenceBand: string;
    evidence: number;
    risk: number;
    direction: number;
    coverage: number;
  };
  v2Decision: {
    decision: 'BUY' | 'SELL' | 'NEUTRAL';
    confidenceBand: string;
    evidence: number;
    risk: number;
    direction: number;
    coverage: number;
  };
  mlAdjustments: MLScoringOutput;
  comparison: {
    agreement: boolean;
    v2MoreAggressive: boolean;
    v2LessAggressive: boolean;
    evidenceDiff: number;
    riskDiff: number;
  };
}

export interface ShadowKPIs {
  period: string;
  totalComparisons: number;
  agreementRate: number;
  v2MoreAggressiveRate: number;
  v2LessAggressiveRate: number;
  avgEvidenceDiff: number;
  avgRiskDiff: number;
  v2BuySellAtLowCoverage: number;
  killConditionsPassed: boolean;
  killConditionsDetails: {
    buySellIncrease: { value: number; passed: boolean };
    agreementRate: { value: number; passed: boolean };
  };
}

// ============ V2 DECISION SIMULATION ============

/**
 * Simulate v2 decision with ML adjustments
 * This does NOT change the actual decision - just calculates what v2 would decide
 */
function simulateV2Decision(
  v1Evidence: number,
  v1Risk: number,
  v1Direction: number,
  v1Coverage: number,
  mlScoring: MLScoringOutput
): { decision: 'BUY' | 'SELL' | 'NEUTRAL'; evidence: number; risk: number; confidenceBand: string } {
  
  // Apply ML adjustments
  const effectiveEvidence = Math.max(0, Math.min(100, v1Evidence + mlScoring.confidenceDelta));
  const effectiveRisk = Math.max(0, Math.min(100, v1Risk + mlScoring.riskAdjustment));
  
  // v2 uses same thresholds as v1.1
  const config = ENGINE_CONFIG;
  
  // Coverage gate (same as v1.1)
  if (v1Coverage < config.coverage.hardMinimum) {
    return { decision: 'NEUTRAL', evidence: effectiveEvidence, risk: effectiveRisk, confidenceBand: 'LOW' };
  }
  
  // Evidence gate (same as v1.1)
  if (effectiveEvidence < config.evidence.minForAnyDecision) {
    return { decision: 'NEUTRAL', evidence: effectiveEvidence, risk: effectiveRisk, confidenceBand: 'LOW' };
  }
  
  // Risk gate (same as v1.1)
  if (effectiveRisk >= config.risk.hardCap) {
    return { decision: 'NEUTRAL', evidence: effectiveEvidence, risk: effectiveRisk, confidenceBand: 'LOW' };
  }
  
  // Direction check (same as v1.1)
  const isWeakDirection = Math.abs(v1Direction) < config.direction.weakThreshold;
  if (isWeakDirection) {
    return { decision: 'NEUTRAL', evidence: effectiveEvidence, risk: effectiveRisk, confidenceBand: 'LOW' };
  }
  
  // Soft zone check
  if (effectiveEvidence < config.evidence.softZoneMax) {
    return { decision: 'NEUTRAL', evidence: effectiveEvidence, risk: effectiveRisk, confidenceBand: 'LOW' };
  }
  
  // High risk zone check
  if (effectiveRisk >= config.risk.highRiskZone && effectiveEvidence < config.risk.highRiskRequirements.minEvidence) {
    return { decision: 'NEUTRAL', evidence: effectiveEvidence, risk: effectiveRisk, confidenceBand: 'MEDIUM' };
  }
  
  // Confidence band
  let confidenceBand = 'LOW';
  if (effectiveEvidence >= 80 && effectiveRisk <= 30) confidenceBand = 'HIGH';
  else if (effectiveEvidence >= 65 && effectiveRisk <= 50) confidenceBand = 'MEDIUM';
  
  // BUY logic
  if (v1Direction >= 25) {
    return { decision: 'BUY', evidence: effectiveEvidence, risk: effectiveRisk, confidenceBand };
  }
  
  // SELL logic
  if (v1Direction <= -25) {
    return { decision: 'SELL', evidence: effectiveEvidence, risk: effectiveRisk, confidenceBand };
  }
  
  return { decision: 'NEUTRAL', evidence: effectiveEvidence, risk: effectiveRisk, confidenceBand };
}

// ============ SHADOW COMPARISON ============

/**
 * Run shadow comparison between v1.1 and v2
 */
export async function runShadowComparison(
  input: EngineInput,
  v1Decision: {
    id: string;
    decision: 'BUY' | 'SELL' | 'NEUTRAL';
    confidenceBand: string;
    scores: { evidence: number; risk: number; direction: number };
  }
): Promise<ShadowDecision | null> {
  
  if (!SHADOW_CONFIG.enabled) {
    return null;
  }
  
  try {
    // Extract features
    const features = extractFeatures(input);
    
    // Calculate ML scoring
    const mlScoring = calculateMLScoring(features);
    
    // Simulate v2 decision
    const v2Result = simulateV2Decision(
      v1Decision.scores.evidence,
      v1Decision.scores.risk,
      v1Decision.scores.direction,
      input.coverage.overall,
      mlScoring
    );
    
    // Build shadow decision
    const shadowDecision: ShadowDecision = {
      v1Decision: {
        decision: v1Decision.decision,
        confidenceBand: v1Decision.confidenceBand,
        evidence: v1Decision.scores.evidence,
        risk: v1Decision.scores.risk,
        direction: v1Decision.scores.direction,
        coverage: input.coverage.overall,
      },
      v2Decision: {
        decision: v2Result.decision,
        confidenceBand: v2Result.confidenceBand,
        evidence: v2Result.evidence,
        risk: v2Result.risk,
        direction: v1Decision.scores.direction,
        coverage: input.coverage.overall,
      },
      mlAdjustments: mlScoring,
      comparison: {
        agreement: v1Decision.decision === v2Result.decision,
        v2MoreAggressive: v1Decision.decision === 'NEUTRAL' && v2Result.decision !== 'NEUTRAL',
        v2LessAggressive: v1Decision.decision !== 'NEUTRAL' && v2Result.decision === 'NEUTRAL',
        evidenceDiff: v2Result.evidence - v1Decision.scores.evidence,
        riskDiff: v2Result.risk - v1Decision.scores.risk,
      },
    };
    
    // Store in database
    const shadowId = `shadow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    await EngineShadowDecisionModel.create({
      shadowId,
      originalDecisionId: v1Decision.id,
      asset: input.asset,
      window: input.window,
      v1Decision: shadowDecision.v1Decision,
      v2Decision: shadowDecision.v2Decision,
      mlAdjustments: shadowDecision.mlAdjustments,
      comparison: shadowDecision.comparison,
      features: {
        coverage: features.coverage,
        distinctSources: features.distinctSources,
        conflictsCount: features.conflictsCount,
        actorCount: features.actorCount,
        contextCount: features.contextCount,
      },
    });
    
    return shadowDecision;
    
  } catch (error) {
    console.error('[Shadow Mode] Error:', error);
    return null;
  }
}

// ============ SHADOW KPIs ============

/**
 * Calculate Shadow Mode KPIs
 */
export async function calculateShadowKPIs(days: number = 7): Promise<ShadowKPIs> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const shadowDecisions = await EngineShadowDecisionModel.find(
    { createdAt: { $gte: cutoff } }
  ).lean();
  
  if (shadowDecisions.length === 0) {
    return {
      period: `${days}d`,
      totalComparisons: 0,
      agreementRate: 100,
      v2MoreAggressiveRate: 0,
      v2LessAggressiveRate: 0,
      avgEvidenceDiff: 0,
      avgRiskDiff: 0,
      v2BuySellAtLowCoverage: 0,
      killConditionsPassed: true,
      killConditionsDetails: {
        buySellIncrease: { value: 0, passed: true },
        agreementRate: { value: 100, passed: true },
      },
    };
  }
  
  let agreements = 0;
  let v2MoreAggressive = 0;
  let v2LessAggressive = 0;
  let totalEvidenceDiff = 0;
  let totalRiskDiff = 0;
  let v2BuySellAtLowCoverage = 0;
  let v1BuySellCount = 0;
  let v2BuySellCount = 0;
  
  for (const d of shadowDecisions as any[]) {
    if (d.comparison?.agreement) agreements++;
    if (d.comparison?.v2MoreAggressive) v2MoreAggressive++;
    if (d.comparison?.v2LessAggressive) v2LessAggressive++;
    totalEvidenceDiff += d.comparison?.evidenceDiff || 0;
    totalRiskDiff += d.comparison?.riskDiff || 0;
    
    if (d.v1Decision?.decision !== 'NEUTRAL') v1BuySellCount++;
    if (d.v2Decision?.decision !== 'NEUTRAL') {
      v2BuySellCount++;
      if (d.v2Decision?.coverage < 60) v2BuySellAtLowCoverage++;
    }
  }
  
  const total = shadowDecisions.length;
  const agreementRate = (agreements / total) * 100;
  const buySellIncrease = v1BuySellCount > 0 
    ? ((v2BuySellCount - v1BuySellCount) / v1BuySellCount)
    : (v2BuySellCount > 0 ? 1 : 0);
  
  const killConditions = SHADOW_CONFIG.killConditions;
  
  return {
    period: `${days}d`,
    totalComparisons: total,
    agreementRate,
    v2MoreAggressiveRate: (v2MoreAggressive / total) * 100,
    v2LessAggressiveRate: (v2LessAggressive / total) * 100,
    avgEvidenceDiff: totalEvidenceDiff / total,
    avgRiskDiff: totalRiskDiff / total,
    v2BuySellAtLowCoverage,
    killConditionsPassed: 
      buySellIncrease <= killConditions.maxBuySellIncrease &&
      agreementRate >= killConditions.minAgreementRate * 100 &&
      v2BuySellAtLowCoverage === 0,
    killConditionsDetails: {
      buySellIncrease: {
        value: buySellIncrease * 100,
        passed: buySellIncrease <= killConditions.maxBuySellIncrease,
      },
      agreementRate: {
        value: agreementRate,
        passed: agreementRate >= killConditions.minAgreementRate * 100,
      },
    },
  };
}

// ============ CONFIG API ============

export function getShadowConfig() {
  return {
    ...SHADOW_CONFIG,
    status: SHADOW_CONFIG.enabled ? 'active' : 'disabled',
  };
}

export function setShadowEnabled(enabled: boolean): void {
  SHADOW_CONFIG.enabled = enabled;
  console.log(`[Shadow Mode] ${enabled ? 'ENABLED' : 'DISABLED'}`);
}
