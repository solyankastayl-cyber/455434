/**
 * Attribution Claims Repository (Phase 15.5)
 */
import { 
  AttributionClaimModel, 
  IAttributionClaim, 
  ClaimStatus, 
  SubjectType, 
  SupportedChain,
  IEvidence,
  STATUS_WEIGHTS
} from './attribution_claims.model.js';

export interface CreateClaimDTO {
  subjectType: SubjectType;
  subjectId: string;
  chain: SupportedChain;
  address: string;
  status?: ClaimStatus;
  confidence: number;
  source: 'manual' | 'import' | 'heuristic' | 'external';
  reason: string;
  evidence?: IEvidence[];
  createdBy?: string;
}

export interface UpdateClaimDTO {
  status?: ClaimStatus;
  confidence?: number;
  reason?: string;
  evidence?: IEvidence[];
}

export interface ClaimWithScore extends IAttributionClaim {
  score: number; // statusWeight * confidence
}

export class AttributionClaimsRepository {
  /**
   * Create a new claim
   */
  async create(dto: CreateClaimDTO): Promise<IAttributionClaim> {
    const claim = new AttributionClaimModel({
      subjectType: dto.subjectType,
      subjectId: dto.subjectId,
      chain: dto.chain,
      address: dto.address.toLowerCase(),
      status: dto.status || 'reference',
      confidence: dto.confidence,
      source: dto.source,
      reason: dto.reason,
      evidence: dto.evidence || [],
      createdBy: dto.createdBy || 'system',
    });
    return claim.save();
  }

  /**
   * Find claim by ID
   */
  async findById(id: string): Promise<IAttributionClaim | null> {
    return AttributionClaimModel.findById(id);
  }

  /**
   * Update claim
   */
  async update(id: string, dto: UpdateClaimDTO): Promise<IAttributionClaim | null> {
    return AttributionClaimModel.findByIdAndUpdate(
      id,
      { $set: dto },
      { new: true }
    );
  }

  /**
   * Set claim status with validation
   */
  async setStatus(id: string, status: ClaimStatus, reason?: string): Promise<IAttributionClaim | null> {
    const claim = await AttributionClaimModel.findById(id);
    if (!claim) return null;

    // Validation: confirmed requires reason and confidence >= 0.6
    if (status === 'confirmed') {
      if (!reason && !claim.reason) {
        throw new Error('Confirmed status requires a reason');
      }
      if (claim.confidence < 0.6) {
        throw new Error('Confirmed status requires confidence >= 0.6');
      }
    }

    const update: any = { status };
    if (reason) update.reason = reason;

    return AttributionClaimModel.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    );
  }

  /**
   * List all claims for a subject (actor/entity)
   */
  async listClaimsForSubject(
    subjectType: SubjectType, 
    subjectId: string,
    includeRejected = false
  ): Promise<ClaimWithScore[]> {
    const query: any = { subjectType, subjectId };
    if (!includeRejected) {
      query.status = { $ne: 'rejected' };
    }

    const claims = await AttributionClaimModel.find(query).sort({ confidence: -1 });
    
    // Add score for sorting
    return claims.map(claim => {
      const doc = claim.toObject() as any;
      const score = STATUS_WEIGHTS[claim.status] * claim.confidence;
      return { ...doc, score } as ClaimWithScore;
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Reverse lookup: find subjects by address
   */
  async findSubjectsByAddress(
    chain: SupportedChain, 
    address: string,
    includeRejected = false
  ): Promise<ClaimWithScore[]> {
    const query: any = { 
      chain, 
      address: address.toLowerCase() 
    };
    if (!includeRejected) {
      query.status = { $ne: 'rejected' };
    }

    const claims = await AttributionClaimModel.find(query);
    
    return claims.map(claim => {
      const doc = claim.toObject() as any;
      const score = STATUS_WEIGHTS[claim.status] * claim.confidence;
      return { ...doc, score } as ClaimWithScore;
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Check if address is linked to any subject
   */
  async isAddressLinked(chain: SupportedChain, address: string): Promise<boolean> {
    const count = await AttributionClaimModel.countDocuments({
      chain,
      address: address.toLowerCase(),
      status: { $in: ['confirmed', 'suspected'] }
    });
    return count > 0;
  }

  /**
   * Get best claim for address (highest score)
   */
  async getBestClaimForAddress(
    chain: SupportedChain, 
    address: string
  ): Promise<ClaimWithScore | null> {
    const claims = await this.findSubjectsByAddress(chain, address);
    return claims.length > 0 ? claims[0] : null;
  }

  /**
   * Bulk import claims (for seeding)
   */
  async bulkImport(claims: CreateClaimDTO[]): Promise<{ imported: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;

    for (const dto of claims) {
      try {
        await AttributionClaimModel.findOneAndUpdate(
          { 
            subjectType: dto.subjectType, 
            subjectId: dto.subjectId, 
            chain: dto.chain, 
            address: dto.address.toLowerCase() 
          },
          {
            $set: {
              status: dto.status || 'reference',
              confidence: dto.confidence,
              source: dto.source,
              reason: dto.reason,
              evidence: dto.evidence || [],
              createdBy: dto.createdBy || 'import',
            }
          },
          { upsert: true, new: true }
        );
        imported++;
      } catch (err: any) {
        errors.push(`${dto.address}: ${err.message}`);
      }
    }

    return { imported, errors };
  }

  /**
   * Delete claim
   */
  async delete(id: string): Promise<boolean> {
    const result = await AttributionClaimModel.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  /**
   * Count claims for subject
   */
  async countClaimsForSubject(
    subjectType: SubjectType, 
    subjectId: string,
    statusFilter?: ClaimStatus[]
  ): Promise<number> {
    const query: any = { subjectType, subjectId };
    if (statusFilter && statusFilter.length > 0) {
      query.status = { $in: statusFilter };
    }
    return AttributionClaimModel.countDocuments(query);
  }

  /**
   * Get all unique subjects with claims
   */
  async getAllSubjects(): Promise<Array<{ subjectType: SubjectType; subjectId: string; claimCount: number }>> {
    return AttributionClaimModel.aggregate([
      { $match: { status: { $ne: 'rejected' } } },
      { $group: { 
        _id: { subjectType: '$subjectType', subjectId: '$subjectId' },
        claimCount: { $sum: 1 }
      }},
      { $project: {
        _id: 0,
        subjectType: '$_id.subjectType',
        subjectId: '$_id.subjectId',
        claimCount: 1
      }}
    ]);
  }
}

export const attributionClaimsRepository = new AttributionClaimsRepository();
