/**
 * BLOCK 77.2 — Proposal Builder
 * 
 * Builds PolicyProposal from LearningVector using deterministic rules.
 * Includes guardrails validation and forward replay simulation.
 */

import { v4 as uuidv4 } from 'uuid';
import { LearningVector, TierName } from './learning.types.js';
import {
  PolicyProposal,
  ProposalInput,
  PolicyDelta,
  ProposalVerdict,
  ProposalRisk,
  GuardrailsResult,
  SimulationResult,
  ExpectedImpact,
  PROPOSAL_LIMITS,
} from './proposal.types.js';
import { generateAllDeltas, CurrentPolicy } from './proposal.rules.js';
import { learningAggregatorService } from './learning.aggregator.service.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULT POLICY (V2.1 BASELINE)
// ═══════════════════════════════════════════════════════════════

const DEFAULT_POLICY: CurrentPolicy = {
  tierWeights: {
    STRUCTURE: 0.52,
    TACTICAL: 0.36,
    TIMING: 0.12,
  },
  divergencePenalties: {
    A: 0.00,
    B: 0.02,
    C: 0.05,
    D: 0.10,
    F: 0.20,
  },
  phaseMultipliers: {
    MARKUP: 1.05,
    MARKDOWN: 0.95,
    ACCUMULATION: 1.00,
    DISTRIBUTION: 0.90,
    RECOVERY: 1.00,
    CAPITULATION: 0.80,
  },
  thresholds: {
    minConfidence: 0.55,
    maxEntropy: 0.75,
    maxTailRisk: 0.60,
  },
};

// ═══════════════════════════════════════════════════════════════
// GUARDRAILS CHECKER
// ═══════════════════════════════════════════════════════════════

function checkGuardrails(learning: LearningVector, deltas: PolicyDelta[]): GuardrailsResult {
  // BLOCK 77.4: Use LIVE samples only for governance decisions
  const liveSamples = learning.sourceCounts?.live || 0;
  
  const checks = {
    minSamples: {
      pass: liveSamples >= 30,
      value: liveSamples,
      required: 30,
    },
    crisisShare: {
      pass: (learning.regimeDistribution.CRISIS || 0) <= 0.50,
      value: learning.regimeDistribution.CRISIS || 0,
      max: 0.50,
    },
    calibrationError: {
      pass: learning.calibrationError <= 0.20,
      value: learning.calibrationError,
      max: 0.20,
    },
    equityDrift: {
      pass: learning.equityDrift.deltaSharpe >= -0.10,
      value: learning.equityDrift.deltaSharpe,
      min: -0.10,
    },
    maxDrift: {
      pass: calculateMaxDrift(deltas) <= PROPOSAL_LIMITS.maxTierWeightDelta,
      value: calculateMaxDrift(deltas),
      max: PROPOSAL_LIMITS.maxTierWeightDelta,
    },
  };
  
  const reasons: string[] = [];
  
  if (!checks.minSamples.pass) {
    reasons.push(`Insufficient LIVE samples: ${checks.minSamples.value} < ${checks.minSamples.required} (BOOTSTRAP: ${learning.sourceCounts?.bootstrap || 0})`);
  }
  if (!checks.crisisShare.pass) {
    reasons.push(`CRISIS regime dominance: ${(checks.crisisShare.value * 100).toFixed(0)}% > ${checks.crisisShare.max * 100}%`);
  }
  if (!checks.calibrationError.pass) {
    reasons.push(`High calibration error: ${(checks.calibrationError.value * 100).toFixed(0)}% > ${checks.calibrationError.max * 100}%`);
  }
  if (!checks.equityDrift.pass) {
    reasons.push(`Negative equity drift: ${checks.equityDrift.value.toFixed(2)} < ${checks.equityDrift.min}`);
  }
  if (!checks.maxDrift.pass) {
    reasons.push(`Drift too large: ${(checks.maxDrift.value * 100).toFixed(0)}% > ${checks.maxDrift.max * 100}%`);
  }
  
  return {
    eligible: reasons.length === 0,
    reasons,
    checks,
  };
}

function calculateMaxDrift(deltas: PolicyDelta[]): number {
  let maxDrift = 0;
  for (const d of deltas) {
    const drift = Math.abs(d.to - d.from);
    if (drift > maxDrift) maxDrift = drift;
  }
  return maxDrift;
}

// ═══════════════════════════════════════════════════════════════
// FORWARD REPLAY SIMULATION
// ═══════════════════════════════════════════════════════════════

async function runForwardReplay(
  learning: LearningVector,
  currentPolicy: CurrentPolicy,
  proposedPolicy: CurrentPolicy
): Promise<SimulationResult> {
  // Simplified simulation using learning vector stats
  // In production, this would replay actual snapshots
  
  const baseSharpe = learning.tier.TACTICAL.sharpe * 0.4 + 
                     learning.tier.STRUCTURE.sharpe * 0.4 +
                     learning.tier.TIMING.sharpe * 0.2;
  
  // Estimate impact of changes
  let expectedSharpeDelta = 0;
  const tierWeightChange = proposedPolicy.tierWeights.STRUCTURE - currentPolicy.tierWeights.STRUCTURE;
  if (tierWeightChange > 0 && learning.tier.STRUCTURE.sharpe > learning.tier.TIMING.sharpe) {
    expectedSharpeDelta += tierWeightChange * 0.3;
  }
  
  const candidateSharpe = baseSharpe + expectedSharpeDelta;
  
  const baseMaxDD = learning.equityDrift.deltaMaxDD + 0.15;
  const candidateMaxDD = baseMaxDD - Math.abs(expectedSharpeDelta) * 0.02;
  
  const baseHitRate = learning.tier.TACTICAL.hitRate;
  const candidateHitRate = baseHitRate + (expectedSharpeDelta > 0 ? 0.01 : -0.01);
  
  const baseTrades = learning.resolvedSamples;
  const candidateTrades = Math.round(baseTrades * (1 - 0.05)); // slight filter increase
  
  // Check simulation criteria
  const notes: string[] = [];
  let passed = true;
  
  if (candidateSharpe - baseSharpe < PROPOSAL_LIMITS.minSharpeDegrade) {
    notes.push(`Sharpe degradation: ${(candidateSharpe - baseSharpe).toFixed(3)}`);
    passed = false;
  } else {
    notes.push(`Sharpe improvement: +${(candidateSharpe - baseSharpe).toFixed(3)}`);
  }
  
  if (candidateMaxDD - baseMaxDD > PROPOSAL_LIMITS.maxDDIncrease) {
    notes.push(`MaxDD increase: ${((candidateMaxDD - baseMaxDD) * 100).toFixed(1)}pp`);
    passed = false;
  } else {
    notes.push(`MaxDD change: ${((candidateMaxDD - baseMaxDD) * 100).toFixed(1)}pp`);
  }
  
  if (candidateHitRate - baseHitRate < PROPOSAL_LIMITS.minHitRateDegrade) {
    notes.push(`HitRate degradation: ${((candidateHitRate - baseHitRate) * 100).toFixed(1)}pp`);
    passed = false;
  }
  
  if (candidateTrades / baseTrades < PROPOSAL_LIMITS.minTradesRatio) {
    notes.push(`Trades reduction: ${((1 - candidateTrades / baseTrades) * 100).toFixed(0)}%`);
    passed = false;
  }
  
  return {
    method: 'FORWARD_REPLAY',
    passed,
    notes,
    metrics: {
      baseSharpe,
      candidateSharpe,
      baseMaxDD,
      candidateMaxDD,
      baseHitRate,
      candidateHitRate,
      baseTrades,
      candidateTrades,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// APPLY DELTAS TO POLICY
// ═══════════════════════════════════════════════════════════════

function applyDeltas(base: CurrentPolicy, deltas: PolicyDelta[]): CurrentPolicy {
  const result = JSON.parse(JSON.stringify(base)) as CurrentPolicy;
  
  for (const delta of deltas) {
    const parts = delta.path.split('.');
    if (parts.length === 2) {
      const [category, key] = parts;
      if (category === 'tierWeights' && result.tierWeights[key as TierName] !== undefined) {
        result.tierWeights[key as TierName] = delta.to;
      } else if (category === 'divergencePenalties') {
        result.divergencePenalties[key] = delta.to;
      } else if (category === 'phaseMultipliers') {
        result.phaseMultipliers[key] = delta.to;
      } else if (category === 'thresholds') {
        result.thresholds[key] = delta.to;
      }
    }
  }
  
  // Normalize tier weights
  const totalWeight = Object.values(result.tierWeights).reduce((a, b) => a + b, 0);
  if (totalWeight > 0 && Math.abs(totalWeight - 1) > 0.01) {
    for (const key of Object.keys(result.tierWeights) as TierName[]) {
      result.tierWeights[key] /= totalWeight;
    }
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// DETERMINE VERDICT AND RISK
// ═══════════════════════════════════════════════════════════════

function determineVerdict(deltas: PolicyDelta[], guardrails: GuardrailsResult): ProposalVerdict {
  if (!guardrails.eligible) return 'HOLD';
  if (deltas.length === 0) return 'HOLD';
  
  const avgConfidence = deltas.reduce((sum, d) => sum + d.confidence, 0) / deltas.length;
  if (avgConfidence < 0.5) return 'HOLD';
  
  // Check for negative expected impact
  const hasNegativeEvidence = deltas.some(d => 
    d.evidence.some(e => e.includes('negative') || e.includes('poor'))
  );
  
  if (deltas.length <= 2 && avgConfidence > 0.7) return 'TUNE';
  if (hasNegativeEvidence && deltas.length > 3) return 'ROLLBACK';
  
  return 'TUNE';
}

function determineRisk(deltas: PolicyDelta[], simulation: SimulationResult): ProposalRisk {
  if (!simulation.passed) return 'HIGH';
  
  const totalDrift = deltas.reduce((sum, d) => sum + Math.abs(d.to - d.from), 0);
  if (totalDrift > 0.15) return 'HIGH';
  if (totalDrift > 0.08) return 'MED';
  
  const avgConfidence = deltas.reduce((sum, d) => sum + d.confidence, 0) / (deltas.length || 1);
  if (avgConfidence < 0.6) return 'MED';
  
  return 'LOW';
}

// ═══════════════════════════════════════════════════════════════
// CALCULATE EXPECTED IMPACT
// ═══════════════════════════════════════════════════════════════

function calculateExpectedImpact(simulation: SimulationResult): ExpectedImpact {
  const { metrics } = simulation;
  return {
    sharpeDelta: metrics.candidateSharpe - metrics.baseSharpe,
    maxDDDelta: metrics.candidateMaxDD - metrics.baseMaxDD,
    hitRateDelta: metrics.candidateHitRate - metrics.baseHitRate,
    expectancyDelta: (metrics.candidateSharpe - metrics.baseSharpe) * 0.01,
    tradesChange: ((metrics.candidateTrades - metrics.baseTrades) / metrics.baseTrades) * 100,
  };
}

// ═══════════════════════════════════════════════════════════════
// PROPOSAL BUILDER
// ═══════════════════════════════════════════════════════════════

export class ProposalBuilderService {
  
  /**
   * Build a dry-run proposal
   */
  async buildDryRunProposal(input: ProposalInput): Promise<PolicyProposal> {
    const { symbol, windowDays, preset = 'balanced', role = 'ACTIVE' } = input;
    
    // Get learning vector
    const learning = await learningAggregatorService.buildLearningVector({
      symbol,
      windowDays,
      preset,
      role,
    });
    
    // Get current policy (in production, fetch from DB)
    const currentPolicy = DEFAULT_POLICY;
    
    // Generate deltas from rules
    const deltas = generateAllDeltas(learning, currentPolicy);
    
    // Check guardrails
    const guardrails = checkGuardrails(learning, deltas);
    
    // Apply deltas to get proposed policy
    const proposedPolicy = applyDeltas(currentPolicy, deltas);
    
    // Run forward replay simulation
    const simulation = await runForwardReplay(learning, currentPolicy, proposedPolicy);
    
    // Determine verdict and risk
    const verdict = determineVerdict(deltas, guardrails);
    const risk = determineRisk(deltas, simulation);
    
    // Calculate expected impact
    const expectedImpact = calculateExpectedImpact(simulation);
    
    // Build summary
    const summary = this.buildSummary(deltas, verdict, expectedImpact);
    
    return {
      id: `prop_${uuidv4().slice(0, 8)}`,
      asof: new Date().toISOString().slice(0, 10),
      symbol,
      windowDays,
      status: 'DRY_RUN',
      
      headline: {
        verdict,
        risk,
        expectedImpact,
        summary,
      },
      
      deltas,
      guardrails,
      simulation,
      
      currentPolicy: {
        tierWeights: currentPolicy.tierWeights as Record<string, number>,
        divergencePenalties: currentPolicy.divergencePenalties,
        phaseMultipliers: currentPolicy.phaseMultipliers,
        thresholds: currentPolicy.thresholds,
      },
      
      proposedPolicy: {
        tierWeights: proposedPolicy.tierWeights as Record<string, number>,
        divergencePenalties: proposedPolicy.divergencePenalties,
        phaseMultipliers: proposedPolicy.phaseMultipliers,
        thresholds: proposedPolicy.thresholds,
      },
      
      audit: {
        createdBy: 'SYSTEM',
        createdAt: new Date().toISOString(),
      },
    };
  }
  
  private buildSummary(deltas: PolicyDelta[], verdict: ProposalVerdict, impact: ExpectedImpact): string {
    if (verdict === 'HOLD') {
      return 'No policy changes recommended at this time';
    }
    
    if (verdict === 'ROLLBACK') {
      return 'Consider reverting recent policy changes due to poor performance';
    }
    
    const changes = deltas.length;
    const categories = [...new Set(deltas.map(d => d.category))];
    const impactStr = impact.sharpeDelta >= 0 
      ? `+${impact.sharpeDelta.toFixed(2)} Sharpe` 
      : `${impact.sharpeDelta.toFixed(2)} Sharpe`;
    
    return `${changes} changes across ${categories.join(', ')} (expected: ${impactStr})`;
  }
}

export const proposalBuilderService = new ProposalBuilderService();

export default proposalBuilderService;
