/**
 * BLOCK 79 — Proposal Apply Service
 * 
 * Applies proposals with governance lock enforcement.
 * Creates audit trail in policy_applications.
 */

import { v4 as uuid } from 'uuid';
import { PolicyApplicationModel } from '../models/policy-application.model.js';
import { proposalStoreService } from './proposal-store.service.js';
import { policyStateService } from './policy-state.service.js';
import { governanceLockService } from '../../governance/governance-lock.service.js';
import type { ApplyResult, PolicyApplication } from '../types/proposal.types.js';

interface ApplyInput {
  proposalId: string;
  actor: string;
  reason?: string;
}

class ProposalApplyService {
  /**
   * Apply a proposal (LIVE-only, governance lock enforced)
   */
  async apply(input: ApplyInput): Promise<ApplyResult> {
    const { proposalId, actor, reason = '' } = input;
    
    // 1. Load proposal
    const proposal = await proposalStoreService.getById(proposalId);
    
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }
    
    if (proposal.status !== 'PROPOSED') {
      throw new Error(`Proposal is not in PROPOSED status: ${proposal.status}`);
    }
    
    // 2. Check source is LIVE
    if (proposal.source !== 'LIVE') {
      throw new Error(`APPLY blocked: source must be LIVE, got ${proposal.source}`);
    }
    
    // 3. Check governance lock
    const lockCheck = await governanceLockService.checkApplyAllowed(
      proposal.scope.symbol,
      proposal.source
    );
    
    if (!lockCheck.allowed) {
      throw new Error(`Governance Lock blocked APPLY: ${lockCheck.blockedReason}`);
    }
    
    // 4. Apply deltas to policy state
    const { previousHash, newHash } = policyStateService.applyDeltas(proposal.deltas);
    
    // 5. Create audit record
    const applicationId = `app_${uuid().slice(0, 8)}`;
    
    await PolicyApplicationModel.create({
      applicationId,
      proposalId,
      appliedAt: new Date(),
      appliedBy: actor,
      previousPolicyHash: previousHash,
      newPolicyHash: newHash,
      reason,
      deltasApplied: proposal.deltas,
      scope: proposal.scope,
    });
    
    // 6. Update proposal status
    const updatedProposal = await proposalStoreService.markApplied(
      proposalId,
      previousHash,
      newHash
    );
    
    console.log(`[ProposalApply] Applied ${proposalId}: ${previousHash} → ${newHash}`);
    
    return {
      applicationId,
      previousHash,
      newHash,
      proposal: updatedProposal!,
    };
  }

  /**
   * Get application by ID
   */
  async getApplication(applicationId: string): Promise<PolicyApplication | null> {
    const doc = await PolicyApplicationModel.findOne({ applicationId });
    return doc ? this.toApplication(doc) : null;
  }

  /**
   * List applications (audit trail)
   */
  async listApplications(filters: {
    proposalId?: string;
    limit?: number;
    skip?: number;
  } = {}): Promise<{ applications: PolicyApplication[]; total: number }> {
    const query: any = {};
    if (filters.proposalId) query.proposalId = filters.proposalId;
    
    const limit = filters.limit || 50;
    const skip = filters.skip || 0;
    
    const [docs, total] = await Promise.all([
      PolicyApplicationModel.find(query)
        .sort({ appliedAt: -1 })
        .skip(skip)
        .limit(limit),
      PolicyApplicationModel.countDocuments(query),
    ]);
    
    return {
      applications: docs.map(d => this.toApplication(d)),
      total,
    };
  }

  private toApplication(doc: any): PolicyApplication {
    return {
      applicationId: doc.applicationId,
      proposalId: doc.proposalId,
      appliedAt: doc.appliedAt,
      appliedBy: doc.appliedBy,
      previousPolicyHash: doc.previousPolicyHash,
      newPolicyHash: doc.newPolicyHash,
      reason: doc.reason || '',
      rollbackOf: doc.rollbackOf,
    };
  }
}

export const proposalApplyService = new ProposalApplyService();

export default proposalApplyService;
