/**
 * Wallet Cluster Engine (B3)
 * 
 * Purpose: "Это один актор или несколько независимых кошельков?"
 * 
 * CRITICAL RULES:
 * - NO ML, только deterministic rules
 * - NO auto-merge, только suggestion + explain
 * - ALL clustering is explainable
 * - confidence < threshold → don't cluster
 * 
 * Algorithm (simplified):
 * For wallet A:
 *   find wallets B where:
 *     tokenOverlap > 60%
 *     AND timingCorrelation > 0.7
 *     AND rolePattern matches
 *   → propose cluster with status: 'suggested'
 */
import { v4 as uuidv4 } from 'uuid';
import type { 
  WalletCluster, 
  ClusterEvidence,
  BehaviorOverlap,
  ClusterSuggestion,
  ClusterReview,
  EvidenceType,
  ClusterStatus,
} from './wallet_cluster.schema.js';
import { WalletClusterModel } from './wallet_cluster.model.js';
import { WalletProfileModel } from './wallet_profile.model.js';
import { WalletTokenCorrelationModel } from './wallet_token_correlation.model.js';
import { TransferModel } from '../transfers/transfers.model.js';

/**
 * Clustering thresholds (conservative for MVP)
 */
const THRESHOLDS = {
  tokenOverlapMin: 0.6,      // 60% shared tokens
  timingCorrelationMin: 0.7, // 70% timing similarity
  roleSimilarityMin: 0.5,    // 50% role match
  confidenceMin: 0.5,        // Minimum to create cluster
  analysisWindowDays: 30,    // Analysis period
};

/**
 * Weights for confidence calculation
 */
const WEIGHTS = {
  tokenOverlap: 0.4,
  timingCorrelation: 0.35,
  roleSimilarity: 0.25,
};

export class WalletClusterEngine {
  
  /**
   * Find potential clusters for a wallet address
   */
  async findRelatedWallets(
    walletAddress: string,
    chain: string = 'Ethereum'
  ): Promise<WalletCluster | null> {
    const addr = walletAddress.toLowerCase();
    
    // Check if already in a cluster
    const existingCluster = await WalletClusterModel.findOne({
      addresses: addr,
      status: { $ne: 'rejected' },
    }).lean();
    
    if (existingCluster) {
      return existingCluster as WalletCluster;
    }
    
    // Get wallet's tokens from correlations
    const walletCorrelations = await WalletTokenCorrelationModel.find({
      walletAddress: addr,
    }).lean();
    
    if (walletCorrelations.length < 2) {
      // Not enough data to cluster
      return null;
    }
    
    const walletTokens = new Set(walletCorrelations.map(c => c.tokenAddress));
    const walletRoles = new Map(walletCorrelations.map(c => [c.tokenAddress, c.role]));
    
    // Find candidate wallets (those who share tokens)
    const candidates = await this.findCandidates(addr, walletTokens, chain);
    
    if (candidates.length === 0) {
      return null;
    }
    
    // Evaluate each candidate
    const relatedWallets: Array<{
      address: string;
      overlap: BehaviorOverlap;
      evidence: ClusterEvidence[];
    }> = [];
    
    for (const candidate of candidates) {
      const evaluation = await this.evaluateRelationship(
        addr,
        candidate,
        walletTokens,
        walletRoles,
        chain
      );
      
      if (evaluation && evaluation.confidence >= THRESHOLDS.confidenceMin) {
        relatedWallets.push({
          address: candidate,
          overlap: evaluation.overlap,
          evidence: evaluation.evidence,
        });
      }
    }
    
    if (relatedWallets.length === 0) {
      return null;
    }
    
    // Create cluster suggestion
    const addresses = [addr, ...relatedWallets.map(w => w.address)];
    const avgOverlap = this.calculateAverageOverlap(relatedWallets.map(w => w.overlap));
    const allEvidence = this.mergeEvidence(relatedWallets.flatMap(w => w.evidence));
    const confidence = this.calculateClusterConfidence(avgOverlap, allEvidence);
    
    const cluster: WalletCluster = {
      clusterId: uuidv4(),
      addresses,
      primaryAddress: addr,
      confidence,
      evidence: allEvidence,
      behaviorOverlap: avgOverlap,
      status: 'suggested',  // NEVER auto-confirm
      chain,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    // Save cluster
    await WalletClusterModel.create(cluster);
    
    return cluster;
  }
  
  /**
   * Find candidate wallets that share tokens
   */
  private async findCandidates(
    walletAddress: string,
    walletTokens: Set<string>,
    chain: string
  ): Promise<string[]> {
    // Find wallets that have correlations with same tokens
    const tokenAddresses = Array.from(walletTokens);
    
    const candidates = await WalletTokenCorrelationModel.aggregate([
      {
        $match: {
          tokenAddress: { $in: tokenAddresses },
          walletAddress: { $ne: walletAddress },
          chain,
        },
      },
      {
        $group: {
          _id: '$walletAddress',
          sharedTokenCount: { $sum: 1 },
          tokens: { $addToSet: '$tokenAddress' },
        },
      },
      {
        $match: {
          sharedTokenCount: { $gte: 2 },  // At least 2 shared tokens
        },
      },
      {
        $sort: { sharedTokenCount: -1 },
      },
      {
        $limit: 20,  // Limit candidates for performance
      },
    ]);
    
    return candidates.map((c: any) => c._id);
  }
  
  /**
   * Evaluate relationship between two wallets
   */
  private async evaluateRelationship(
    walletA: string,
    walletB: string,
    walletATokens: Set<string>,
    walletARoles: Map<string, string>,
    chain: string
  ): Promise<{
    confidence: number;
    overlap: BehaviorOverlap;
    evidence: ClusterEvidence[];
  } | null> {
    // Get wallet B's correlations
    const walletBCorrelations = await WalletTokenCorrelationModel.find({
      walletAddress: walletB,
      chain,
    }).lean();
    
    if (walletBCorrelations.length < 2) {
      return null;
    }
    
    const walletBTokens = new Set(walletBCorrelations.map(c => c.tokenAddress));
    const walletBRoles = new Map(walletBCorrelations.map(c => [c.tokenAddress, c.role]));
    
    // Calculate token overlap
    const sharedTokens = new Set([...walletATokens].filter(t => walletBTokens.has(t)));
    const unionTokens = new Set([...walletATokens, ...walletBTokens]);
    const tokenOverlap = sharedTokens.size / unionTokens.size;
    
    if (tokenOverlap < THRESHOLDS.tokenOverlapMin) {
      return null;
    }
    
    // Calculate role similarity (for shared tokens)
    let roleMatches = 0;
    for (const token of sharedTokens) {
      if (walletARoles.get(token) === walletBRoles.get(token)) {
        roleMatches++;
      }
    }
    const roleSimilarity = sharedTokens.size > 0 ? roleMatches / sharedTokens.size : 0;
    
    // Calculate timing correlation
    const timingCorrelation = await this.calculateTimingCorrelation(walletA, walletB, chain);
    
    // Build overlap metrics
    const overlap: BehaviorOverlap = {
      tokenOverlap,
      timingCorrelation,
      roleSimilarity,
    };
    
    // Check if meets threshold
    if (
      tokenOverlap < THRESHOLDS.tokenOverlapMin ||
      timingCorrelation < THRESHOLDS.timingCorrelationMin
    ) {
      return null;
    }
    
    // Build evidence (explainable)
    const evidence: ClusterEvidence[] = [];
    
    // Token overlap evidence
    evidence.push({
      type: 'token_overlap',
      description: `${sharedTokens.size} shared tokens (${Math.round(tokenOverlap * 100)}% overlap)`,
      score: tokenOverlap,
      details: { sharedCount: sharedTokens.size, tokens: Array.from(sharedTokens).slice(0, 5) },
    });
    
    // Timing evidence
    if (timingCorrelation >= THRESHOLDS.timingCorrelationMin) {
      evidence.push({
        type: 'timing',
        description: `Transaction timing correlation: ${Math.round(timingCorrelation * 100)}%`,
        score: timingCorrelation,
      });
    }
    
    // Role pattern evidence
    if (roleSimilarity >= THRESHOLDS.roleSimilarityMin) {
      evidence.push({
        type: 'role_pattern',
        description: `Similar trading behavior in ${Math.round(roleSimilarity * 100)}% of shared tokens`,
        score: roleSimilarity,
      });
    }
    
    // Calculate confidence
    const confidence = 
      WEIGHTS.tokenOverlap * tokenOverlap +
      WEIGHTS.timingCorrelation * timingCorrelation +
      WEIGHTS.roleSimilarity * roleSimilarity;
    
    return { confidence, overlap, evidence };
  }
  
  /**
   * Calculate timing correlation between two wallets
   */
  private async calculateTimingCorrelation(
    walletA: string,
    walletB: string,
    chain: string
  ): Promise<number> {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - THRESHOLDS.analysisWindowDays);
    
    // Get transaction timestamps for both wallets
    const [txA, txB] = await Promise.all([
      TransferModel.find({
        $or: [{ fromAddress: walletA }, { toAddress: walletA }],
        timestamp: { $gte: windowStart },
      }).select('timestamp').lean(),
      TransferModel.find({
        $or: [{ fromAddress: walletB }, { toAddress: walletB }],
        timestamp: { $gte: windowStart },
      }).select('timestamp').lean(),
    ]);
    
    if (txA.length < 3 || txB.length < 3) {
      return 0;
    }
    
    // Simple timing correlation: check if transactions happen in similar time windows
    // Group by hour and compare patterns
    const hourBuckets = new Map<string, { a: number; b: number }>();
    
    for (const tx of txA) {
      const hour = new Date(tx.timestamp).toISOString().slice(0, 13);
      const bucket = hourBuckets.get(hour) || { a: 0, b: 0 };
      bucket.a++;
      hourBuckets.set(hour, bucket);
    }
    
    for (const tx of txB) {
      const hour = new Date(tx.timestamp).toISOString().slice(0, 13);
      const bucket = hourBuckets.get(hour) || { a: 0, b: 0 };
      bucket.b++;
      hourBuckets.set(hour, bucket);
    }
    
    // Count overlapping hours (both wallets active)
    let overlappingHours = 0;
    let totalHours = 0;
    
    for (const [, bucket] of hourBuckets) {
      totalHours++;
      if (bucket.a > 0 && bucket.b > 0) {
        overlappingHours++;
      }
    }
    
    return totalHours > 0 ? overlappingHours / totalHours : 0;
  }
  
  /**
   * Calculate average overlap from multiple relationships
   */
  private calculateAverageOverlap(overlaps: BehaviorOverlap[]): BehaviorOverlap {
    if (overlaps.length === 0) {
      return { tokenOverlap: 0, timingCorrelation: 0, roleSimilarity: 0 };
    }
    
    return {
      tokenOverlap: overlaps.reduce((sum, o) => sum + o.tokenOverlap, 0) / overlaps.length,
      timingCorrelation: overlaps.reduce((sum, o) => sum + o.timingCorrelation, 0) / overlaps.length,
      roleSimilarity: overlaps.reduce((sum, o) => sum + o.roleSimilarity, 0) / overlaps.length,
    };
  }
  
  /**
   * Merge and deduplicate evidence
   */
  private mergeEvidence(evidence: ClusterEvidence[]): ClusterEvidence[] {
    const byType = new Map<string, ClusterEvidence>();
    
    for (const e of evidence) {
      const existing = byType.get(e.type);
      if (!existing || e.score > existing.score) {
        byType.set(e.type, e);
      }
    }
    
    return Array.from(byType.values());
  }
  
  /**
   * Calculate overall cluster confidence
   */
  private calculateClusterConfidence(
    overlap: BehaviorOverlap,
    evidence: ClusterEvidence[]
  ): number {
    const overlapScore = 
      WEIGHTS.tokenOverlap * overlap.tokenOverlap +
      WEIGHTS.timingCorrelation * overlap.timingCorrelation +
      WEIGHTS.roleSimilarity * overlap.roleSimilarity;
    
    // Boost confidence if multiple evidence types
    const evidenceBonus = Math.min(0.1, evidence.length * 0.03);
    
    return Math.min(1, overlapScore + evidenceBonus);
  }
  
  /**
   * Get clusters for a wallet
   */
  async getWalletClusters(walletAddress: string): Promise<ClusterSuggestion[]> {
    const addr = walletAddress.toLowerCase();
    
    const clusters = await WalletClusterModel.find({
      addresses: addr,
    }).lean();
    
    return clusters.map(cluster => this.toClusterSuggestion(cluster as WalletCluster, addr));
  }
  
  /**
   * Convert cluster to suggestion format for UI
   */
  private toClusterSuggestion(cluster: WalletCluster, forAddress: string): ClusterSuggestion {
    const otherAddresses = cluster.addresses.filter(a => a !== forAddress);
    
    return {
      clusterId: cluster.clusterId,
      relatedAddresses: otherAddresses.map(addr => ({
        address: addr,
        evidenceCount: cluster.evidence.length,
        topEvidence: cluster.evidence[0]?.description || 'Behavioral similarity detected',
      })),
      confidence: cluster.confidence,
      status: cluster.status,
      summary: this.generateSummary(cluster),
    };
  }
  
  /**
   * Generate human-readable summary
   */
  private generateSummary(cluster: WalletCluster): string {
    const count = cluster.addresses.length;
    const evidenceTypes = cluster.evidence.map(e => e.type);
    
    const reasons: string[] = [];
    if (evidenceTypes.includes('token_overlap')) reasons.push('shared tokens');
    if (evidenceTypes.includes('timing')) reasons.push('correlated timing');
    if (evidenceTypes.includes('role_pattern')) reasons.push('similar behavior');
    
    const reasonText = reasons.length > 0 
      ? `based on ${reasons.join(' and ')}`
      : 'based on behavioral analysis';
    
    return `${count} addresses may be related ${reasonText}`;
  }
  
  /**
   * Get cluster by ID for review
   */
  async getClusterForReview(clusterId: string): Promise<ClusterReview | null> {
    const cluster = await WalletClusterModel.findOne({ clusterId }).lean();
    
    if (!cluster) {
      return null;
    }
    
    const typedCluster = cluster as WalletCluster;
    
    return {
      cluster: typedCluster,
      evidenceDetails: typedCluster.evidence.map(e => ({
        type: e.type,
        title: this.getEvidenceTitle(e.type),
        description: e.description,
        score: e.score,
        supporting: this.getEvidenceSupporting(e),
      })),
      confidenceExplanation: this.explainConfidence(typedCluster),
    };
  }
  
  /**
   * Get human-readable evidence title
   */
  private getEvidenceTitle(type: EvidenceType): string {
    switch (type) {
      case 'token_overlap': return 'Shared Token Portfolio';
      case 'timing': return 'Transaction Timing';
      case 'role_pattern': return 'Trading Behavior';
      case 'flow_pattern': return 'Fund Flow Pattern';
      default: return 'Behavioral Evidence';
    }
  }
  
  /**
   * Get supporting facts for evidence
   */
  private getEvidenceSupporting(evidence: ClusterEvidence): string[] {
    const facts: string[] = [];
    
    if (evidence.details?.sharedCount) {
      facts.push(`${evidence.details.sharedCount} tokens in common`);
    }
    if (evidence.details?.tokens) {
      facts.push(`Including: ${evidence.details.tokens.slice(0, 3).join(', ')}`);
    }
    if (evidence.score >= 0.8) {
      facts.push('Strong correlation detected');
    }
    
    return facts.length > 0 ? facts : ['Analysis based on on-chain activity'];
  }
  
  /**
   * Explain confidence score
   */
  private explainConfidence(cluster: WalletCluster): string {
    const { tokenOverlap, timingCorrelation, roleSimilarity } = cluster.behaviorOverlap;
    
    const parts: string[] = [];
    
    if (tokenOverlap >= 0.7) {
      parts.push('high token overlap');
    } else if (tokenOverlap >= 0.5) {
      parts.push('moderate token overlap');
    }
    
    if (timingCorrelation >= 0.8) {
      parts.push('strong timing correlation');
    } else if (timingCorrelation >= 0.6) {
      parts.push('moderate timing correlation');
    }
    
    if (roleSimilarity >= 0.7) {
      parts.push('similar trading patterns');
    }
    
    if (parts.length === 0) {
      return 'Confidence based on aggregate behavioral signals';
    }
    
    return `Confidence is ${cluster.confidence >= 0.7 ? 'high' : 'moderate'} due to ${parts.join(', ')}`;
  }
  
  /**
   * Confirm a cluster (user action)
   */
  async confirmCluster(clusterId: string, notes?: string): Promise<WalletCluster | null> {
    const cluster = await WalletClusterModel.findOneAndUpdate(
      { clusterId },
      { 
        $set: { 
          status: 'confirmed',
          notes,
          updatedAt: new Date(),
        } 
      },
      { new: true }
    ).lean();
    
    return cluster as WalletCluster | null;
  }
  
  /**
   * Reject a cluster (user action)
   */
  async rejectCluster(clusterId: string, notes?: string): Promise<WalletCluster | null> {
    const cluster = await WalletClusterModel.findOneAndUpdate(
      { clusterId },
      { 
        $set: { 
          status: 'rejected',
          notes,
          updatedAt: new Date(),
        } 
      },
      { new: true }
    ).lean();
    
    return cluster as WalletCluster | null;
  }
  
  /**
   * Get cluster by ID
   */
  async getCluster(clusterId: string): Promise<WalletCluster | null> {
    const cluster = await WalletClusterModel.findOne({ clusterId }).lean();
    return cluster as WalletCluster | null;
  }
}

// Export singleton
export const walletClusterEngine = new WalletClusterEngine();
