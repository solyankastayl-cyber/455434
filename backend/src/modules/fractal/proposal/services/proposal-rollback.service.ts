/**
 * BLOCK 79 — Proposal Rollback Service
 * 
 * Reverts policy to previous state.
 * Creates audit trail entry with rollbackOf reference.
 */

import { v4 as uuid } from 'uuid';
import { PolicyApplicationModel } from '../models/policy-application.model.js';
import { policyStateService } from './policy-state.service.js';
import type { RollbackResult } from '../types/proposal.types.js';

interface RollbackInput {
  applicationId: string;
  actor: string;
  reason?: string;
}

class ProposalRollbackService {
  /**
   * Rollback a previously applied policy change
   */
  async rollback(input: RollbackInput): Promise<RollbackResult> {
    const { applicationId, actor, reason = 'Manual rollback' } = input;
    
    // 1. Find the application to rollback
    const application = await PolicyApplicationModel.findOne({ applicationId });
    
    if (!application) {
      throw new Error(`Application not found: ${applicationId}`);
    }
    
    // 2. Check if already rolled back
    const existingRollback = await PolicyApplicationModel.findOne({ 
      rollbackOf: applicationId 
    });
    
    if (existingRollback) {
      throw new Error(`Application already rolled back: ${existingRollback.applicationId}`);
    }
    
    // 3. Get previous policy hash to restore
    const hashToRestore = application.previousPolicyHash;
    const currentHash = policyStateService.getHash();
    
    // 4. Restore policy state
    const restored = policyStateService.restoreFromHash(hashToRestore);
    
    if (!restored) {
      throw new Error(`Cannot restore policy hash: ${hashToRestore}`);
    }
    
    // 5. Create rollback audit record
    const rollbackApplicationId = `app_${uuid().slice(0, 8)}`;
    
    await PolicyApplicationModel.create({
      applicationId: rollbackApplicationId,
      proposalId: application.proposalId,
      appliedAt: new Date(),
      appliedBy: actor,
      previousPolicyHash: currentHash,
      newPolicyHash: hashToRestore,
      reason,
      rollbackOf: applicationId,
      scope: application.scope,
    });
    
    console.log(`[ProposalRollback] Rolled back ${applicationId}: ${currentHash} → ${hashToRestore}`);
    
    return {
      applicationId: rollbackApplicationId,
      rollbackOf: applicationId,
      previousHash: currentHash,
      restoredHash: hashToRestore,
    };
  }

  /**
   * Get rollback history for an application
   */
  async getRollbackChain(applicationId: string): Promise<any[]> {
    const chain: any[] = [];
    let currentId = applicationId;
    
    while (currentId) {
      const app = await PolicyApplicationModel.findOne({ 
        $or: [
          { applicationId: currentId },
          { rollbackOf: currentId }
        ]
      }).sort({ appliedAt: 1 });
      
      if (app && !chain.find(a => a.applicationId === app.applicationId)) {
        chain.push({
          applicationId: app.applicationId,
          appliedAt: app.appliedAt,
          previousPolicyHash: app.previousPolicyHash,
          newPolicyHash: app.newPolicyHash,
          rollbackOf: app.rollbackOf,
        });
        
        // Check for rollback of this
        const nextRollback = await PolicyApplicationModel.findOne({ 
          rollbackOf: app.applicationId 
        });
        
        currentId = nextRollback?.applicationId || '';
      } else {
        break;
      }
    }
    
    return chain;
  }
}

export const proposalRollbackService = new ProposalRollbackService();

export default proposalRollbackService;
