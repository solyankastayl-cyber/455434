/**
 * Attribution Claims Service (Phase 15.5)
 * Business logic and validation
 * 
 * RULES:
 * 1. effectiveScore = confidence * STATUS_WEIGHT[status]
 * 2. Cannot downgrade confirmed → suspected/reference without reason + non-system createdBy
 * 3. One address can only have ONE confirmed claim per chain (no conflicts)
 */
import { 
  attributionClaimsRepository,
  CreateClaimDTO,
  UpdateClaimDTO,
  ClaimWithScore
} from './attribution_claims.repository.js';
import { 
  IAttributionClaim, 
  ClaimStatus, 
  SubjectType, 
  SupportedChain,
  STATUS_WEIGHTS,
  AttributionClaimModel
} from './attribution_claims.model.js';

// Status hierarchy for downgrade detection
const STATUS_HIERARCHY: Record<ClaimStatus, number> = {
  'confirmed': 3,
  'suspected': 2,
  'reference': 1,
  'rejected': 0,
};

export interface AttributionStatus {
  linked: boolean;
  status: 'linked_confirmed' | 'linked_suspected' | 'unlinked';
  subjects: Array<{
    type: SubjectType;
    id: string;
    name?: string;
    score: number;
    claimStatus: ClaimStatus;
  }>;
  claimsPreview: ClaimWithScore[];
}

export interface SubjectAddresses {
  subjectType: SubjectType;
  subjectId: string;
  addresses: Array<{
    chain: SupportedChain;
    address: string;
    status: ClaimStatus;
    confidence: number;
    reason: string;
    score: number;
    source: string;
  }>;
  totalCount: number;
  confirmedCount: number;
  suspectedCount: number;
}

/**
 * Calculate effective score for sorting and decisions
 */
export function calculateEffectiveScore(confidence: number, status: ClaimStatus): number {
  return confidence * STATUS_WEIGHTS[status];
}

class AttributionClaimsService {
  /**
   * Create a new claim with validation
   */
  async createClaim(dto: CreateClaimDTO): Promise<IAttributionClaim> {
    // Validate confidence range
    if (dto.confidence < 0 || dto.confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }

    // Validate confirmed status requires high confidence
    if (dto.status === 'confirmed' && dto.confidence < 0.6) {
      throw new Error('Confirmed status requires confidence >= 0.6');
    }

    // RULE 3: Check for conflicting confirmed claims
    if (dto.status === 'confirmed') {
      const existingConfirmed = await AttributionClaimModel.findOne({
        chain: dto.chain,
        address: dto.address.toLowerCase(),
        status: 'confirmed',
        // Different subject
        $or: [
          { subjectType: { $ne: dto.subjectType } },
          { subjectId: { $ne: dto.subjectId } }
        ]
      });

      if (existingConfirmed) {
        throw new Error(
          `Address already has a confirmed claim for ${existingConfirmed.subjectType}:${existingConfirmed.subjectId}. ` +
          `Cannot have two confirmed claims for the same address in chain ${dto.chain}.`
        );
      }
    }

    return attributionClaimsRepository.create(dto);
  }

  /**
   * Update claim with validation
   */
  async updateClaim(id: string, dto: UpdateClaimDTO, createdBy?: string): Promise<IAttributionClaim | null> {
    const existingClaim = await attributionClaimsRepository.findById(id);
    if (!existingClaim) return null;

    // RULE 2: Prevent silent downgrade from confirmed
    if (dto.status && existingClaim.status === 'confirmed') {
      const isDowngrade = STATUS_HIERARCHY[dto.status] < STATUS_HIERARCHY['confirmed'];
      
      if (isDowngrade) {
        // Must have reason and non-system createdBy
        if (!dto.reason) {
          throw new Error('Downgrading from confirmed status requires a reason');
        }
        if (createdBy === 'system') {
          throw new Error('System cannot downgrade confirmed claims. Manual intervention required.');
        }
      }
    }

    // Validate if trying to set confirmed with low confidence
    if (dto.status === 'confirmed') {
      const newConfidence = dto.confidence ?? existingClaim.confidence;
      if (newConfidence < 0.6) {
        throw new Error('Confirmed status requires confidence >= 0.6');
      }
    }

    return attributionClaimsRepository.update(id, dto);
  }

  /**
   * Confirm a claim (set status to confirmed)
   */
  async confirmClaim(id: string, reason?: string): Promise<IAttributionClaim | null> {
    const claim = await attributionClaimsRepository.findById(id);
    if (!claim) return null;

    // Check confidence threshold
    if (claim.confidence < 0.6) {
      throw new Error('Cannot confirm claim with confidence < 0.6');
    }

    // RULE 3: Check for conflicting confirmed claims
    const existingConfirmed = await AttributionClaimModel.findOne({
      chain: claim.chain,
      address: claim.address,
      status: 'confirmed',
      _id: { $ne: id },
    });

    if (existingConfirmed) {
      throw new Error(
        `Address already has a confirmed claim for ${existingConfirmed.subjectType}:${existingConfirmed.subjectId}. ` +
        `Reject that claim first before confirming this one.`
      );
    }

    return attributionClaimsRepository.setStatus(id, 'confirmed', reason);
  }

  /**
   * Reject a claim
   */
  async rejectClaim(id: string, reason?: string): Promise<IAttributionClaim | null> {
    if (!reason) {
      throw new Error('Reason is required to reject a claim');
    }
    return attributionClaimsRepository.setStatus(id, 'rejected', reason);
  }

  /**
   * Get all addresses for a subject (actor/entity)
   */
  async getSubjectAddresses(
    subjectType: SubjectType, 
    subjectId: string
  ): Promise<SubjectAddresses> {
    const claims = await attributionClaimsRepository.listClaimsForSubject(subjectType, subjectId);
    
    return {
      subjectType,
      subjectId,
      addresses: claims.map(c => ({
        chain: c.chain,
        address: c.address,
        status: c.status,
        confidence: c.confidence,
        reason: c.reason,
        score: c.score,
        source: c.source,
      })),
      totalCount: claims.length,
      confirmedCount: claims.filter(c => c.status === 'confirmed').length,
      suspectedCount: claims.filter(c => c.status === 'suspected').length,
    };
  }

  /**
   * Get attribution status for an address (for Resolver integration)
   */
  async getAttributionStatus(
    chain: SupportedChain, 
    address: string
  ): Promise<AttributionStatus> {
    const claims = await attributionClaimsRepository.findSubjectsByAddress(chain, address);
    
    if (claims.length === 0) {
      return {
        linked: false,
        status: 'unlinked',
        subjects: [],
        claimsPreview: [],
      };
    }

    // Check for confirmed claims
    const hasConfirmed = claims.some(c => c.status === 'confirmed');
    const hasSuspected = claims.some(c => c.status === 'suspected');

    return {
      linked: true,
      status: hasConfirmed ? 'linked_confirmed' : hasSuspected ? 'linked_suspected' : 'unlinked',
      subjects: claims.map(c => ({
        type: c.subjectType,
        id: c.subjectId,
        score: c.score,
        claimStatus: c.status,
      })),
      claimsPreview: claims.slice(0, 3), // Top 3 claims
    };
  }

  /**
   * Bulk import claims (for seeding)
   */
  async bulkImport(claims: CreateClaimDTO[]): Promise<{ imported: number; errors: string[] }> {
    return attributionClaimsRepository.bulkImport(claims);
  }

  /**
   * Get claim by ID
   */
  async getClaimById(id: string): Promise<IAttributionClaim | null> {
    return attributionClaimsRepository.findById(id);
  }

  /**
   * Delete claim
   */
  async deleteClaim(id: string): Promise<boolean> {
    return attributionClaimsRepository.delete(id);
  }

  /**
   * Get all subjects with claims
   */
  async getAllSubjectsWithClaims(): Promise<Array<{ subjectType: SubjectType; subjectId: string; claimCount: number }>> {
    return attributionClaimsRepository.getAllSubjects();
  }

  /**
   * Add evidence to claim
   */
  async addEvidence(
    id: string, 
    evidence: { type: 'note' | 'url' | 'tx' | 'cluster' | 'pattern'; value: string; weight?: number }
  ): Promise<IAttributionClaim | null> {
    const claim = await attributionClaimsRepository.findById(id);
    if (!claim) return null;

    claim.evidence.push({
      ...evidence,
      weight: evidence.weight || 0.5,
      addedAt: new Date(),
    });

    return claim.save();
  }
}

export const attributionClaimsService = new AttributionClaimsService();
