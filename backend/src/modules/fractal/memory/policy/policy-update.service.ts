/**
 * BLOCK 75.4 — Policy Update Service
 * 
 * Generates policy proposals based on forward truth attribution.
 * 
 * Modes:
 * - DRY_RUN: Calculate changes, don't persist
 * - PROPOSE: Calculate and persist proposal (awaiting approval)
 * - APPLY: Apply approved proposal (manual confirmation required)
 * 
 * Guardrails:
 * - Min resolved samples per tier
 * - Max daily drift ±5%
 * - Weight sum must equal 1.0
 * - Frozen contracts block APPLY
 */

import { PolicyProposalModel, type PolicyProposalDocument, type PolicyConfig, type PolicyDiff, type PolicyStatus } from './policy.model.js';
import { attributionService, type AttributionSummary } from '../attribution/attribution.service.js';
import type { TierType } from '../snapshot/prediction-snapshot.model.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS & GUARDRAILS
// ═══════════════════════════════════════════════════════════════

// Minimum samples required per tier for weight adjustment
const MIN_SAMPLES_TIMING = 40;
const MIN_SAMPLES_TACTICAL = 30;
const MIN_SAMPLES_STRUCTURE = 45;

// Max daily drift per weight
const MAX_DRIFT_PERCENT = 5;

// Learning rate for weight adjustments
const LEARNING_RATE = 0.15;

// Default config (current production values)
const DEFAULT_CONFIG: PolicyConfig = {
  tierWeights: {
    TIMING: 0.12,
    TACTICAL: 0.36,
    STRUCTURE: 0.52
  },
  horizonWeights: {
    '7d': 0.08,
    '14d': 0.04,
    '30d': 0.18,
    '90d': 0.18,
    '180d': 0.26,
    '365d': 0.26
  },
  regimeMultipliers: {
    CRISIS: { structureBoost: 1.3, timingPenalty: 0.6 },
    HIGH: { structureBoost: 1.2, timingPenalty: 0.7 },
    NORMAL: { structureBoost: 1.0, timingPenalty: 1.0 },
    LOW: { structureBoost: 0.9, timingPenalty: 1.1 }
  },
  divergencePenalties: {
    A: 0,
    B: 0.02,
    C: 0.05,
    D: 0.10,
    F: 0.20
  },
  phaseGradeMultipliers: {
    A: 1.2,
    B: 1.1,
    C: 1.0,
    D: 0.9,
    F: 0.7
  }
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type PolicyUpdateMode = 'DRY_RUN' | 'PROPOSE' | 'APPLY';

export interface PolicyUpdateResult {
  mode: PolicyUpdateMode;
  success: boolean;
  message: string;
  
  currentConfig?: PolicyConfig;
  proposedConfig?: PolicyConfig;
  diffs?: PolicyDiff[];
  
  guardrailsPass: boolean;
  guardrailViolations: string[];
  
  evidenceSummary?: {
    totalOutcomes: number;
    tierAccuracy: Record<TierType, number>;
    dominantTier: TierType;
    insights: string[];
  };
  
  proposalId?: string;
  version?: string;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class PolicyUpdateService {
  
  /**
   * Get current active config
   */
  async getCurrentConfig(): Promise<PolicyConfig> {
    // Try to find latest applied policy
    const latestApplied = await PolicyProposalModel.findOne({
      symbol: 'BTC',
      status: 'APPLIED'
    }).sort({ appliedAt: -1 }).lean();
    
    if (latestApplied) {
      return latestApplied.proposedConfig;
    }
    
    return { ...DEFAULT_CONFIG };
  }
  
  /**
   * Generate next version string
   */
  async getNextVersion(): Promise<string> {
    const latest = await PolicyProposalModel.findOne({ symbol: 'BTC' })
      .sort({ createdAt: -1 }).lean();
    
    if (!latest) {
      return 'v2.1.1';
    }
    
    // Parse version and increment
    const match = latest.version.match(/v(\d+)\.(\d+)\.(\d+)/);
    if (match) {
      const patch = parseInt(match[3], 10) + 1;
      return `v${match[1]}.${match[2]}.${patch}`;
    }
    
    return `v2.1.${Date.now()}`;
  }
  
  /**
   * Check guardrails
   */
  checkGuardrails(
    current: PolicyConfig,
    proposed: PolicyConfig,
    attribution: AttributionSummary
  ): { pass: boolean; violations: string[] } {
    const violations: string[] = [];
    
    // Check min samples per tier
    for (const ta of attribution.tierAccuracy) {
      if (ta.tier === 'TIMING' && ta.total < MIN_SAMPLES_TIMING) {
        violations.push(`TIMING tier has only ${ta.total} samples (min: ${MIN_SAMPLES_TIMING})`);
      }
      if (ta.tier === 'TACTICAL' && ta.total < MIN_SAMPLES_TACTICAL) {
        violations.push(`TACTICAL tier has only ${ta.total} samples (min: ${MIN_SAMPLES_TACTICAL})`);
      }
      if (ta.tier === 'STRUCTURE' && ta.total < MIN_SAMPLES_STRUCTURE) {
        violations.push(`STRUCTURE tier has only ${ta.total} samples (min: ${MIN_SAMPLES_STRUCTURE})`);
      }
    }
    
    // Check max drift
    const checkDrift = (field: string, oldVal: number, newVal: number) => {
      const drift = Math.abs((newVal - oldVal) / oldVal) * 100;
      if (drift > MAX_DRIFT_PERCENT) {
        violations.push(`${field} drift ${drift.toFixed(1)}% exceeds max ${MAX_DRIFT_PERCENT}%`);
      }
    };
    
    checkDrift('tierWeights.TIMING', current.tierWeights.TIMING, proposed.tierWeights.TIMING);
    checkDrift('tierWeights.TACTICAL', current.tierWeights.TACTICAL, proposed.tierWeights.TACTICAL);
    checkDrift('tierWeights.STRUCTURE', current.tierWeights.STRUCTURE, proposed.tierWeights.STRUCTURE);
    
    // Check weight sum = 1.0
    const tierSum = proposed.tierWeights.TIMING + proposed.tierWeights.TACTICAL + proposed.tierWeights.STRUCTURE;
    if (Math.abs(tierSum - 1.0) > 0.001) {
      violations.push(`Tier weights sum to ${tierSum.toFixed(3)}, must be 1.0`);
    }
    
    const horizonSum = Object.values(proposed.horizonWeights).reduce((a, b) => a + b, 0);
    if (Math.abs(horizonSum - 1.0) > 0.001) {
      violations.push(`Horizon weights sum to ${horizonSum.toFixed(3)}, must be 1.0`);
    }
    
    return {
      pass: violations.length === 0,
      violations
    };
  }
  
  /**
   * Calculate proposed tier weights based on attribution
   */
  calculateProposedTierWeights(
    current: PolicyConfig,
    attribution: AttributionSummary
  ): PolicyConfig['tierWeights'] {
    const weights = { ...current.tierWeights };
    
    // Calculate z-scores for tier hit rates
    const hitRates = attribution.tierAccuracy.map(t => t.hitRate);
    const mean = hitRates.reduce((a, b) => a + b, 0) / hitRates.length;
    const std = Math.sqrt(
      hitRates.reduce((sum, hr) => sum + Math.pow(hr - mean, 2), 0) / hitRates.length
    ) || 0.01;
    
    for (const ta of attribution.tierAccuracy) {
      const z = (ta.hitRate - mean) / std;
      const adjustment = Math.exp(LEARNING_RATE * z);
      
      // Apply adjustment with clamp
      const newWeight = weights[ta.tier] * adjustment;
      const maxWeight = weights[ta.tier] * (1 + MAX_DRIFT_PERCENT / 100);
      const minWeight = weights[ta.tier] * (1 - MAX_DRIFT_PERCENT / 100);
      
      weights[ta.tier] = Math.max(minWeight, Math.min(maxWeight, newWeight));
    }
    
    // Normalize to sum = 1.0
    const sum = weights.TIMING + weights.TACTICAL + weights.STRUCTURE;
    weights.TIMING /= sum;
    weights.TACTICAL /= sum;
    weights.STRUCTURE /= sum;
    
    return weights;
  }
  
  /**
   * Generate diffs between current and proposed
   */
  generateDiffs(current: PolicyConfig, proposed: PolicyConfig, attribution: AttributionSummary): PolicyDiff[] {
    const diffs: PolicyDiff[] = [];
    
    const addDiff = (field: string, oldVal: number, newVal: number, reason: string) => {
      if (Math.abs(newVal - oldVal) > 0.001) {
        diffs.push({
          field,
          oldValue: oldVal,
          newValue: newVal,
          changePercent: ((newVal - oldVal) / oldVal) * 100,
          reason
        });
      }
    };
    
    // Tier weights
    for (const tier of ['TIMING', 'TACTICAL', 'STRUCTURE'] as const) {
      const ta = attribution.tierAccuracy.find(t => t.tier === tier);
      const reason = ta ? `Hit rate: ${(ta.hitRate * 100).toFixed(1)}%` : 'Based on forward truth';
      addDiff(`tierWeights.${tier}`, current.tierWeights[tier], proposed.tierWeights[tier], reason);
    }
    
    return diffs;
  }
  
  /**
   * Run policy update (main entry point)
   */
  async runUpdate(
    symbol: string = 'BTC',
    mode: PolicyUpdateMode = 'DRY_RUN',
    from?: string,
    to?: string
  ): Promise<PolicyUpdateResult> {
    console.log(`[PolicyUpdate] Running ${mode} for ${symbol}`);
    
    // Get attribution
    const attribution = await attributionService.buildAttributionSummary(symbol, from, to);
    
    if (attribution.totalOutcomes === 0) {
      return {
        mode,
        success: false,
        message: 'No outcomes available for policy update',
        guardrailsPass: false,
        guardrailViolations: ['No data']
      };
    }
    
    // Get current config
    const currentConfig = await this.getCurrentConfig();
    
    // Calculate proposed config
    const proposedConfig: PolicyConfig = {
      ...currentConfig,
      tierWeights: this.calculateProposedTierWeights(currentConfig, attribution)
    };
    
    // Check guardrails
    const guardrails = this.checkGuardrails(currentConfig, proposedConfig, attribution);
    
    // Generate diffs
    const diffs = this.generateDiffs(currentConfig, proposedConfig, attribution);
    
    // Build evidence summary
    const evidenceSummary = {
      totalOutcomes: attribution.totalOutcomes,
      tierAccuracy: Object.fromEntries(
        attribution.tierAccuracy.map(t => [t.tier, t.hitRate])
      ) as Record<TierType, number>,
      dominantTier: attribution.dominantTier,
      insights: attribution.insights
    };
    
    // DRY_RUN: just return the analysis
    if (mode === 'DRY_RUN') {
      return {
        mode,
        success: true,
        message: 'Dry run completed',
        currentConfig,
        proposedConfig,
        diffs,
        guardrailsPass: guardrails.pass,
        guardrailViolations: guardrails.violations,
        evidenceSummary
      };
    }
    
    // PROPOSE: persist proposal
    if (mode === 'PROPOSE') {
      const version = await this.getNextVersion();
      
      const proposal = await PolicyProposalModel.create({
        symbol: 'BTC',
        version,
        status: 'PROPOSED' as PolicyStatus,
        windowRange: {
          from: attribution.period.from,
          to: attribution.period.to,
          resolvedCount: attribution.totalOutcomes,
          regimesCovered: attribution.regimeAccuracy.map(r => r.regime)
        },
        currentConfig,
        proposedConfig,
        diffs,
        guardrailsPass: guardrails.pass,
        guardrailViolations: guardrails.violations,
        evidenceSummary,
        proposedAt: new Date(),
        proposedBy: 'system'
      });
      
      return {
        mode,
        success: true,
        message: `Proposal ${version} created`,
        currentConfig,
        proposedConfig,
        diffs,
        guardrailsPass: guardrails.pass,
        guardrailViolations: guardrails.violations,
        evidenceSummary,
        proposalId: (proposal as any)._id.toString(),
        version
      };
    }
    
    return {
      mode,
      success: false,
      message: 'APPLY mode requires explicit proposal ID',
      guardrailsPass: false,
      guardrailViolations: ['APPLY mode not implemented in auto-update']
    };
  }
  
  /**
   * Apply a specific proposal (manual confirmation)
   */
  async applyProposal(
    proposalId: string,
    appliedBy: string = 'admin'
  ): Promise<{ success: boolean; message: string }> {
    const proposal = await PolicyProposalModel.findById(proposalId);
    
    if (!proposal) {
      return { success: false, message: 'Proposal not found' };
    }
    
    if (proposal.status !== 'PROPOSED') {
      return { success: false, message: `Proposal status is ${proposal.status}, not PROPOSED` };
    }
    
    if (!proposal.guardrailsPass) {
      return { success: false, message: 'Proposal does not pass guardrails' };
    }
    
    // Check if contract is frozen
    const isFrozen = process.env.FRACTAL_CONTRACT_FROZEN === 'true';
    if (isFrozen) {
      return { success: false, message: 'Contract is FROZEN, cannot apply policy changes' };
    }
    
    // Apply
    proposal.status = 'APPLIED';
    proposal.appliedAt = new Date();
    proposal.appliedBy = appliedBy;
    await proposal.save();
    
    console.log(`[PolicyUpdate] Applied proposal ${proposal.version}`);
    
    return { success: true, message: `Proposal ${proposal.version} applied` };
  }
  
  /**
   * Get policy history
   */
  async getHistory(symbol: string = 'BTC', limit: number = 10): Promise<PolicyProposalDocument[]> {
    return PolicyProposalModel.find({ symbol })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
  
  /**
   * Get pending proposals
   */
  async getPendingProposals(symbol: string = 'BTC'): Promise<PolicyProposalDocument[]> {
    return PolicyProposalModel.find({ symbol, status: 'PROPOSED' })
      .sort({ createdAt: -1 })
      .lean();
  }
}

export const policyUpdateService = new PolicyUpdateService();
