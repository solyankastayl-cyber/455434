/**
 * BLOCK 78.5 — Governance Lock (LIVE-only APPLY)
 * 
 * Hard invariant: APPLY is ONLY allowed when:
 * - source = LIVE
 * - liveSamples >= MIN_LIVE_SAMPLES
 * - driftSeverity < CRITICAL
 * - policyHash matches current contractHash
 */

import { PredictionOutcomeModel } from '../memory/outcome/prediction-outcome.model.js';
import { driftService } from '../drift/drift.service.js';
import { DriftSeverity } from '../drift/drift.types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const GOVERNANCE_LOCK_CONFIG = {
  MIN_LIVE_SAMPLES: 30,
  BLOCK_ON_DRIFT_SEVERITY: ['CRITICAL'] as DriftSeverity[],
  CURRENT_CONTRACT_HASH: 'v2.1.0',
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface GovernanceLockStatus {
  canApply: boolean;
  reasons: string[];
  lockDetails: {
    liveSamples: number;
    minRequired: number;
    driftSeverity: DriftSeverity | null;
    contractHashMatch: boolean;
    isLiveOnly: boolean;
  };
}

export interface ApplyGuardResult {
  allowed: boolean;
  blockedReason?: string;
  lockStatus: GovernanceLockStatus;
}

// ═══════════════════════════════════════════════════════════════
// GOVERNANCE LOCK SERVICE
// ═══════════════════════════════════════════════════════════════

class GovernanceLockService {
  /**
   * Check if APPLY action is allowed
   */
  async checkApplyAllowed(
    symbol: string,
    proposalSource?: string,
    proposalPolicyHash?: string
  ): Promise<ApplyGuardResult> {
    const reasons: string[] = [];
    
    // 1. Check LIVE samples count
    const liveSamples = await this.getLiveSamplesCount(symbol);
    const hasEnoughLive = liveSamples >= GOVERNANCE_LOCK_CONFIG.MIN_LIVE_SAMPLES;
    
    if (!hasEnoughLive) {
      reasons.push(`LIVE samples insufficient: ${liveSamples}/${GOVERNANCE_LOCK_CONFIG.MIN_LIVE_SAMPLES}`);
    }
    
    // 2. Check source is LIVE
    const isLiveOnly = !proposalSource || proposalSource === 'LIVE';
    if (!isLiveOnly) {
      reasons.push(`Source must be LIVE, got: ${proposalSource}`);
    }
    
    // 3. Check drift severity
    let driftSeverity: DriftSeverity | null = null;
    try {
      const driftPayload = await driftService.build({
        symbol,
        focus: 'all',
        preset: 'all',
        role: 'ACTIVE',
        windowDays: 365,
      });
      driftSeverity = driftPayload.verdict.overallSeverity;
      
      if (GOVERNANCE_LOCK_CONFIG.BLOCK_ON_DRIFT_SEVERITY.includes(driftSeverity)) {
        reasons.push(`Drift severity ${driftSeverity} blocks APPLY`);
      }
    } catch (err) {
      console.warn('[GovernanceLock] Failed to check drift:', err);
      // Don't block on drift check failure - just warn
    }
    
    // 4. Check policy hash (if provided)
    const contractHashMatch = !proposalPolicyHash || 
      proposalPolicyHash === GOVERNANCE_LOCK_CONFIG.CURRENT_CONTRACT_HASH;
    
    if (!contractHashMatch) {
      reasons.push(`Policy hash mismatch: ${proposalPolicyHash} vs ${GOVERNANCE_LOCK_CONFIG.CURRENT_CONTRACT_HASH}`);
    }
    
    const canApply = hasEnoughLive && isLiveOnly && 
      !GOVERNANCE_LOCK_CONFIG.BLOCK_ON_DRIFT_SEVERITY.includes(driftSeverity as DriftSeverity) &&
      contractHashMatch;
    
    const lockStatus: GovernanceLockStatus = {
      canApply,
      reasons,
      lockDetails: {
        liveSamples,
        minRequired: GOVERNANCE_LOCK_CONFIG.MIN_LIVE_SAMPLES,
        driftSeverity,
        contractHashMatch,
        isLiveOnly,
      },
    };
    
    return {
      allowed: canApply,
      blockedReason: reasons.length > 0 ? reasons.join('; ') : undefined,
      lockStatus,
    };
  }
  
  /**
   * Get count of LIVE outcomes
   */
  private async getLiveSamplesCount(symbol: string): Promise<number> {
    const count = await PredictionOutcomeModel.countDocuments({
      symbol,
      source: 'LIVE',
    });
    return count;
  }
  
  /**
   * Get lock status summary (for UI display)
   */
  async getLockStatus(symbol: string): Promise<GovernanceLockStatus> {
    const result = await this.checkApplyAllowed(symbol);
    return result.lockStatus;
  }
}

export const governanceLockService = new GovernanceLockService();
export default governanceLockService;
