/**
 * BLOCK 79 — Proposal Store Service
 * 
 * CRUD operations for policy proposals.
 */

import { v4 as uuid } from 'uuid';
import { PolicyProposalModel } from '../models/policy-proposal.model.js';
import type { 
  PolicyProposal, 
  ProposalStatus, 
  CohortSource, 
  ProposalScope,
  ProposalDeltas,
  ProposalSimulation,
  ProposalGuardrails,
  ProposalVerdict
} from '../types/proposal.types.js';

interface CreateProposalInput {
  source: CohortSource;
  scope: ProposalScope;
  learningVectorSnapshot: any;
  deltas: ProposalDeltas;
  simulation: ProposalSimulation;
  guardrails: ProposalGuardrails;
  verdict: ProposalVerdict;
  createdBy?: string;
}

interface ListFilters {
  status?: ProposalStatus;
  source?: CohortSource;
  symbol?: string;
  preset?: string;
  limit?: number;
  skip?: number;
}

class ProposalStoreService {
  /**
   * Create new proposal with status PROPOSED
   */
  async create(input: CreateProposalInput): Promise<PolicyProposal> {
    const proposalId = `prop_${uuid().slice(0, 8)}`;
    
    const doc = await PolicyProposalModel.create({
      proposalId,
      status: 'PROPOSED',
      verdict: input.verdict,
      source: input.source,
      scope: input.scope,
      learningVectorSnapshot: input.learningVectorSnapshot,
      deltas: input.deltas,
      simulation: input.simulation,
      guardrails: input.guardrails,
      createdBy: input.createdBy || 'SYSTEM',
    });

    console.log(`[ProposalStore] Created proposal: ${proposalId}`);
    
    return this.toProposal(doc);
  }

  /**
   * Get proposal by ID
   */
  async getById(proposalId: string): Promise<PolicyProposal | null> {
    const doc = await PolicyProposalModel.findOne({ proposalId });
    return doc ? this.toProposal(doc) : null;
  }

  /**
   * Get latest proposal
   */
  async getLatest(filters?: { status?: ProposalStatus; source?: CohortSource }): Promise<PolicyProposal | null> {
    const query: any = {};
    if (filters?.status) query.status = filters.status;
    if (filters?.source) query.source = filters.source;
    
    const doc = await PolicyProposalModel.findOne(query).sort({ createdAt: -1 });
    return doc ? this.toProposal(doc) : null;
  }

  /**
   * List proposals with filters
   */
  async list(filters: ListFilters = {}): Promise<{ proposals: PolicyProposal[]; total: number }> {
    const query: any = {};
    
    if (filters.status) query.status = filters.status;
    if (filters.source) query.source = filters.source;
    if (filters.symbol) query['scope.symbol'] = filters.symbol;
    if (filters.preset) query['scope.preset'] = filters.preset;
    
    const limit = filters.limit || 50;
    const skip = filters.skip || 0;
    
    const [docs, total] = await Promise.all([
      PolicyProposalModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      PolicyProposalModel.countDocuments(query),
    ]);
    
    return {
      proposals: docs.map(d => this.toProposal(d)),
      total,
    };
  }

  /**
   * Mark proposal as applied
   */
  async markApplied(
    proposalId: string, 
    previousPolicyHash: string, 
    appliedPolicyHash: string
  ): Promise<PolicyProposal | null> {
    const doc = await PolicyProposalModel.findOneAndUpdate(
      { proposalId },
      {
        status: 'APPLIED',
        appliedAt: new Date(),
        previousPolicyHash,
        appliedPolicyHash,
      },
      { new: true }
    );
    
    console.log(`[ProposalStore] Marked as APPLIED: ${proposalId}`);
    return doc ? this.toProposal(doc) : null;
  }

  /**
   * Mark proposal as rejected
   */
  async markRejected(
    proposalId: string, 
    reason: string, 
    rejectedBy: string = 'ADMIN'
  ): Promise<PolicyProposal | null> {
    const doc = await PolicyProposalModel.findOneAndUpdate(
      { proposalId },
      {
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectedBy,
        rejectedReason: reason,
      },
      { new: true }
    );
    
    console.log(`[ProposalStore] Marked as REJECTED: ${proposalId}`);
    return doc ? this.toProposal(doc) : null;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<any> {
    const [total, byStatus, bySource] = await Promise.all([
      PolicyProposalModel.countDocuments(),
      PolicyProposalModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      PolicyProposalModel.aggregate([
        { $group: { _id: '$source', count: { $sum: 1 } } }
      ]),
    ]);
    
    return {
      total,
      byStatus: Object.fromEntries(byStatus.map(s => [s._id, s.count])),
      bySource: Object.fromEntries(bySource.map(s => [s._id, s.count])),
    };
  }

  private toProposal(doc: any): PolicyProposal {
    return {
      proposalId: doc.proposalId,
      status: doc.status,
      verdict: doc.verdict,
      source: doc.source,
      scope: doc.scope,
      learningVectorSnapshot: doc.learningVectorSnapshot,
      deltas: doc.deltas,
      simulation: doc.simulation,
      guardrails: doc.guardrails,
      createdAt: doc.createdAt,
      createdBy: doc.createdBy,
      appliedAt: doc.appliedAt,
      previousPolicyHash: doc.previousPolicyHash,
      appliedPolicyHash: doc.appliedPolicyHash,
      rejectedAt: doc.rejectedAt,
      rejectedBy: doc.rejectedBy,
      rejectedReason: doc.rejectedReason,
    };
  }
}

export const proposalStoreService = new ProposalStoreService();

export default proposalStoreService;
