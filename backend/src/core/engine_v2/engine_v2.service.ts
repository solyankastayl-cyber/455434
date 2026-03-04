/**
 * Engine V2: Main Service
 * 
 * Orchestrates all V2 components into a single decision API
 */
import { resolveSubject, ResolvedSubject } from './subject_resolver.js';
import { fetchSignalsBySubject, fetchAllSignals, EngineWindow } from './signals_fetcher.js';
import { buildCoverageFeatures } from './coverage_features.builder.js';
import { computeCoverageScore, CoverageScoreResult } from './coverage_score.js';
import { buildRiskNotes } from './risk_notes.js';
import { computeEvidenceAndDirection, EvidenceDirectionResult, TopSignal } from './evidence_direction.js';
import { computeDriftFlags } from './drift_flags.js';
import { computeRiskScore, RiskScoreResult } from './risk_score.js';
import { computeEngineStatus, EngineStatus } from './engine_status.js';
import { applyDecisionPolicy, PolicyResult, PolicyConfig } from './decision_policy.js';
import type { CoverageFeatures } from './coverage_features.js';

// Re-export types
export type { EngineWindow, ResolvedSubject, TopSignal, EngineStatus };

const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  minCoverageToTrade: 60,
  minEvidenceToTrade: 65,
  maxRiskToTrade: 60,
  minDirectionStrength: 20,
};

export interface EngineV2Decision {
  subject: ResolvedSubject | null;
  window: EngineWindow;
  computedAt: string;
  
  decision: 'BUY' | 'SELL' | 'NEUTRAL';
  confidenceBand: 'LOW' | 'MEDIUM' | 'HIGH';
  
  scores: {
    evidence: number;
    direction: number;
    risk: number;
    coverage: number;
  };
  
  gating: {
    enabled: boolean;
    minCoverageToTrade: number;
    blocked: boolean;
    reasons: string[];
  };
  
  notes: {
    coverageNotes: string[];
    evidenceNotes: string[];
    riskNotes: string[];
  };
  
  attribution: {
    topSignals: TopSignal[];
    summary: {
      totalSignals: number;
      activeSignals: number;
      avgDominance: number;
      clusterPassRate: number;
      clustersCountAvg: number;
      sourceGroupsAvg: number;
      penaltyRate: number;
      contextsAvailable: number;
    };
  };
  
  health: {
    engineStatus: EngineStatus;
    driftFlags: string[];
  };
}

/**
 * Make Engine V2 decision for a subject
 */
export async function decideV2(params: {
  actor?: string;
  asset?: string;
  window?: EngineWindow;
  config?: Partial<PolicyConfig>;
}): Promise<EngineV2Decision> {
  const window = params.window ?? '24h';
  const input = params.actor ?? params.asset;
  const inputType = params.actor ? 'actor' : params.asset ? 'asset' : undefined;
  
  // Unknown subject response
  const unknownResponse = (reason: string): EngineV2Decision => ({
    subject: null,
    window,
    computedAt: new Date().toISOString(),
    decision: 'NEUTRAL',
    confidenceBand: 'LOW',
    scores: { evidence: 0, direction: 0, risk: 100, coverage: 0 },
    gating: {
      enabled: true,
      minCoverageToTrade: DEFAULT_POLICY_CONFIG.minCoverageToTrade,
      blocked: true,
      reasons: [reason],
    },
    notes: {
      coverageNotes: ['no_signals'],
      evidenceNotes: ['no_signals'],
      riskNotes: [reason === 'unknown_subject' ? 'Unknown subject' : 'No input provided'],
    },
    attribution: {
      topSignals: [],
      summary: {
        totalSignals: 0,
        activeSignals: 0,
        avgDominance: 1,
        clusterPassRate: 0,
        clustersCountAvg: 0,
        sourceGroupsAvg: 0,
        penaltyRate: 0,
        contextsAvailable: 0,
      },
    },
    health: {
      engineStatus: 'DATA_COLLECTION_MODE',
      driftFlags: [reason],
    },
  });
  
  if (!input) {
    return unknownResponse('no_input');
  }
  
  // Resolve subject
  const subject = await resolveSubject(input, inputType);
  if (!subject) {
    return unknownResponse('unknown_subject');
  }
  
  // Fetch signals
  const signals = await fetchSignalsBySubject(subject.type, subject.normalizedId, window);
  
  // Step 1: Coverage
  const features = buildCoverageFeatures(signals);
  const coverageRes = computeCoverageScore(features);
  
  // Step 2: Evidence & Direction
  const ed = computeEvidenceAndDirection(signals, window);
  
  // Step 3: Drift, Risk, Status, Policy
  const driftFlags = computeDriftFlags(features, window);
  const riskRes = computeRiskScore(coverageRes.score, features, driftFlags);
  
  const minCoverageToTrade = params.config?.minCoverageToTrade ?? DEFAULT_POLICY_CONFIG.minCoverageToTrade;
  const status = computeEngineStatus(coverageRes.score, riskRes.risk, driftFlags, minCoverageToTrade);
  
  const policy = applyDecisionPolicy({
    evidence: ed.evidence,
    direction: ed.direction,
    coverage: coverageRes.score,
    risk: riskRes.risk,
    driftFlags,
    status,
    config: params.config,
  });
  
  const riskNotes = buildRiskNotes(features, coverageRes.notes);
  
  return {
    subject,
    window,
    computedAt: new Date().toISOString(),
    decision: policy.decision,
    confidenceBand: policy.confidenceBand,
    scores: {
      evidence: ed.evidence,
      direction: ed.direction,
      risk: riskRes.risk,
      coverage: coverageRes.score,
    },
    gating: {
      enabled: true,
      minCoverageToTrade,
      blocked: policy.gating.blocked,
      reasons: policy.gating.reasons,
    },
    notes: {
      coverageNotes: coverageRes.notes,
      evidenceNotes: ed.notes.evidenceNotes,
      riskNotes,
    },
    attribution: {
      topSignals: ed.topSignals,
      summary: {
        totalSignals: features.totalSignals,
        activeSignals: features.activeSignals,
        avgDominance: Number(features.avgDominance.toFixed(3)),
        clusterPassRate: Number(features.clusterPassRate.toFixed(3)),
        clustersCountAvg: Number(features.clustersCountAvg.toFixed(3)),
        sourceGroupsAvg: Number(features.sourceGroupsAvg.toFixed(3)),
        penaltyRate: Number(features.penaltyRate.toFixed(3)),
        contextsAvailable: features.contextsAvailable,
      },
    },
    health: {
      engineStatus: status,
      driftFlags,
    },
  };
}

/**
 * Get global engine health status
 */
export async function getEngineHealth(window: EngineWindow = '24h'): Promise<{
  status: EngineStatus;
  signalsCount: number;
  avgCoverage: number;
  avgRisk: number;
  driftFlags: string[];
}> {
  const signals = await fetchAllSignals(window);
  const features = buildCoverageFeatures(signals);
  const coverage = computeCoverageScore(features);
  const driftFlags = computeDriftFlags(features, window);
  const riskRes = computeRiskScore(coverage.score, features, driftFlags);
  const status = computeEngineStatus(coverage.score, riskRes.risk, driftFlags, 60);
  
  return {
    status,
    signalsCount: signals.length,
    avgCoverage: coverage.score,
    avgRisk: riskRes.risk,
    driftFlags,
  };
}
