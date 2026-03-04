/**
 * Wallet Cluster Schema (B3)
 * 
 * Purpose: "Это один актор или несколько независимых кошельков?"
 * 
 * IMPORTANT:
 * - B3 НЕ говорит "это Binance"
 * - B3 говорит "эти адреса ведут себя как один актор"
 * - NO auto-merge, только suggestion + explain
 * - NO ML, только deterministic rules
 * 
 * UI rule: никогда не говорит "это точно один актор" —
 * только "system suggests these addresses may be related"
 */
import { z } from 'zod';

/**
 * Cluster status
 */
export const ClusterStatusEnum = z.enum([
  'suggested',   // System proposed, awaiting review
  'confirmed',   // User confirmed relationship
  'rejected',    // User rejected relationship
]);

/**
 * Evidence type - explainable reasons
 */
export const EvidenceTypeEnum = z.enum([
  'token_overlap',    // Same tokens in portfolio
  'timing',           // Correlated transaction timing
  'role_pattern',     // Similar buyer/seller patterns
  'flow_pattern',     // Connected fund flows
]);

/**
 * Cluster Evidence - MUST be explainable
 */
export const ClusterEvidenceSchema = z.object({
  type: EvidenceTypeEnum,
  description: z.string(),    // Human-readable explanation
  score: z.number().min(0).max(1),
  details: z.record(z.any()).optional(),  // Additional data
});

/**
 * Behavior Overlap metrics
 */
export const BehaviorOverlapSchema = z.object({
  tokenOverlap: z.number().min(0).max(1),       // % of shared tokens
  timingCorrelation: z.number().min(0).max(1),  // Timing similarity
  roleSimilarity: z.number().min(0).max(1),     // Role pattern match
});

/**
 * Main Wallet Cluster Schema
 */
export const WalletClusterSchema = z.object({
  clusterId: z.string(),
  
  // Addresses in this cluster
  addresses: z.array(z.string()).min(2),
  
  // Primary address (usually first detected)
  primaryAddress: z.string(),
  
  // Confidence score (0-1)
  confidence: z.number().min(0).max(1),
  
  // Evidence array - explainable reasons
  evidence: z.array(ClusterEvidenceSchema),
  
  // Behavior overlap metrics
  behaviorOverlap: BehaviorOverlapSchema,
  
  // Status
  status: ClusterStatusEnum,
  
  // User notes (for confirmed/rejected)
  notes: z.string().optional(),
  
  // Metadata
  chain: z.string().default('Ethereum'),
  
  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * Cluster suggestion for UI
 */
export const ClusterSuggestionSchema = z.object({
  clusterId: z.string(),
  
  // Related addresses
  relatedAddresses: z.array(z.object({
    address: z.string(),
    evidenceCount: z.number(),
    topEvidence: z.string(),  // Human-readable
  })),
  
  // Overall confidence
  confidence: z.number(),
  
  // Status
  status: ClusterStatusEnum,
  
  // Summary for UI
  summary: z.string(),  // "2 addresses may be related based on shared tokens and timing"
});

/**
 * API response for cluster review
 */
export const ClusterReviewSchema = z.object({
  cluster: WalletClusterSchema,
  
  // Detailed evidence for modal
  evidenceDetails: z.array(z.object({
    type: EvidenceTypeEnum,
    title: z.string(),
    description: z.string(),
    score: z.number(),
    supporting: z.array(z.string()),  // Supporting facts
  })),
  
  // Confidence explanation
  confidenceExplanation: z.string(),
});

// Type exports
export type ClusterStatus = z.infer<typeof ClusterStatusEnum>;
export type EvidenceType = z.infer<typeof EvidenceTypeEnum>;
export type ClusterEvidence = z.infer<typeof ClusterEvidenceSchema>;
export type BehaviorOverlap = z.infer<typeof BehaviorOverlapSchema>;
export type WalletCluster = z.infer<typeof WalletClusterSchema>;
export type ClusterSuggestion = z.infer<typeof ClusterSuggestionSchema>;
export type ClusterReview = z.infer<typeof ClusterReviewSchema>;
