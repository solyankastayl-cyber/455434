/**
 * Wallet Profile Engine (B1)
 * 
 * Purpose: Build and maintain wallet profiles
 * 
 * "Кто это? Трейдер? Фонд? Мост? Degen?"
 * 
 * Key principles:
 * - Profiles are snapshots, not real-time
 * - Tags are derived from behavior, not asserted
 * - Confidence reflects data quality
 * - Summary is human-readable explanation
 */
import { v4 as uuidv4 } from 'uuid';
import type { 
  WalletProfile, 
  WalletTag, 
  DominantAction,
  TokenInteraction,
} from './wallet_profile.schema.js';
import { WalletProfileModel, ProfileUpdateEventModel } from './wallet_profile.model.js';

/**
 * Thresholds for tag assignment
 */
const TAG_THRESHOLDS = {
  // Activity
  activeDaysForActive: 30,      // Active in last 30 days
  dormantDays: 90,              // Inactive for 90+ days
  newWalletDays: 7,             // Created within 7 days
  
  // Volume (in USD)
  highVolumeThreshold: 1000000,  // $1M+ total volume
  whaleThreshold: 10000000,      // $10M+ holdings
  lowVolumeThreshold: 1000,      // Under $1k
  
  // Trading
  traderTxPerDay: 2,            // 2+ tx/day = trader
  flipperHoldingDays: 1,        // Holds less than 1 day = flipper
  
  // Confidence
  minTxForHighConfidence: 50,
  minDaysForHighConfidence: 30,
};

/**
 * Raw wallet data input (from blockchain data source)
 */
export interface RawWalletData {
  address: string;
  chain?: string;
  
  // Transaction history
  transactions: Array<{
    hash: string;
    timestamp: Date;
    type: 'in' | 'out';
    value: number;          // In USD
    token?: {
      address: string;
      symbol?: string;
      name?: string;
    };
  }>;
  
  // Optional enrichment
  isContract?: boolean;
  labels?: string[];
}

export class WalletProfileEngine {
  /**
   * Build or refresh a wallet profile
   */
  async buildProfile(rawData: RawWalletData): Promise<WalletProfile> {
    const { address, chain = 'Ethereum', transactions } = rawData;
    
    // Check for existing profile
    const existing = await this.getProfileByAddress(address, chain);
    const isNew = !existing;
    
    // Calculate metrics
    const activity = this.calculateActivityMetrics(transactions);
    const flows = this.calculateFlowMetrics(transactions);
    const tokens = this.calculateTokenInteractions(transactions);
    const behavior = this.calculateBehaviorMetrics(transactions, activity, flows);
    
    // Derive tags
    const tags = this.deriveTags(activity, flows, behavior, rawData);
    
    // Calculate confidence
    const confidence = this.calculateConfidence(activity, transactions.length);
    
    // Generate summary
    const summary = this.generateSummary(tags, behavior, flows, activity);
    
    // Build profile
    const profile: WalletProfile = {
      address,
      chain,
      profileId: existing?.profileId || uuidv4(),
      updatedAt: new Date(),
      snapshotVersion: (existing?.snapshotVersion || 0) + 1,
      
      activity,
      flows,
      behavior,
      tokens,
      tags,
      confidence,
      summary,
    };
    
    // Save profile
    await this.saveProfile(profile, isNew);
    
    // Record update event
    await this.recordUpdateEvent(profile, isNew, existing?.tags);
    
    return profile;
  }

  /**
   * Calculate activity metrics
   */
  private calculateActivityMetrics(
    transactions: RawWalletData['transactions']
  ): WalletProfile['activity'] {
    if (transactions.length === 0) {
      const now = new Date();
      return {
        firstSeen: now,
        lastSeen: now,
        activeDays: 0,
        txCount: 0,
        avgTxPerDay: 0,
      };
    }
    
    // Sort by timestamp
    const sorted = [...transactions].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    
    const firstSeen = sorted[0].timestamp;
    const lastSeen = sorted[sorted.length - 1].timestamp;
    
    // Count unique active days
    const activeDaysSet = new Set(
      transactions.map(tx => tx.timestamp.toISOString().split('T')[0])
    );
    const activeDays = activeDaysSet.size;
    
    // Calculate average
    const daySpan = Math.max(1, 
      (lastSeen.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24)
    );
    const avgTxPerDay = transactions.length / daySpan;
    
    return {
      firstSeen,
      lastSeen,
      activeDays,
      txCount: transactions.length,
      avgTxPerDay,
    };
  }

  /**
   * Calculate flow metrics
   */
  private calculateFlowMetrics(
    transactions: RawWalletData['transactions']
  ): WalletProfile['flows'] {
    let totalIn = 0;
    let totalOut = 0;
    let maxTxSize = 0;
    
    for (const tx of transactions) {
      if (tx.type === 'in') {
        totalIn += tx.value;
      } else {
        totalOut += tx.value;
      }
      maxTxSize = Math.max(maxTxSize, tx.value);
    }
    
    const avgTxSize = transactions.length > 0
      ? (totalIn + totalOut) / transactions.length
      : 0;
    
    return {
      totalIn,
      totalOut,
      netFlow: totalIn - totalOut,
      avgTxSize,
      maxTxSize,
    };
  }

  /**
   * Calculate token interactions
   */
  private calculateTokenInteractions(
    transactions: RawWalletData['transactions']
  ): WalletProfile['tokens'] {
    // Group by token
    const tokenMap = new Map<string, {
      address: string;
      symbol?: string;
      name?: string;
      buyVolume: number;
      sellVolume: number;
      txCount: number;
      firstInteraction: Date;
      lastInteraction: Date;
    }>();
    
    for (const tx of transactions) {
      const tokenAddr = tx.token?.address || 'native';
      
      if (!tokenMap.has(tokenAddr)) {
        tokenMap.set(tokenAddr, {
          address: tokenAddr,
          symbol: tx.token?.symbol,
          name: tx.token?.name,
          buyVolume: 0,
          sellVolume: 0,
          txCount: 0,
          firstInteraction: tx.timestamp,
          lastInteraction: tx.timestamp,
        });
      }
      
      const token = tokenMap.get(tokenAddr)!;
      token.txCount++;
      
      if (tx.type === 'in') {
        token.buyVolume += tx.value;
      } else {
        token.sellVolume += tx.value;
      }
      
      if (tx.timestamp < token.firstInteraction) {
        token.firstInteraction = tx.timestamp;
      }
      if (tx.timestamp > token.lastInteraction) {
        token.lastInteraction = tx.timestamp;
      }
    }
    
    // Convert to array and sort by total volume
    const tokenInteractions: TokenInteraction[] = Array.from(tokenMap.values())
      .map(t => ({
        ...t,
        netVolume: t.buyVolume - t.sellVolume,
      }))
      .sort((a, b) => (b.buyVolume + b.sellVolume) - (a.buyVolume + a.sellVolume))
      .slice(0, 10); // Top 10
    
    return {
      interactedCount: tokenMap.size,
      topTokens: tokenInteractions,
    };
  }

  /**
   * Calculate behavior metrics
   */
  private calculateBehaviorMetrics(
    transactions: RawWalletData['transactions'],
    activity: WalletProfile['activity'],
    flows: WalletProfile['flows']
  ): WalletProfile['behavior'] {
    // Determine dominant action
    const buyTx = transactions.filter(tx => tx.type === 'in').length;
    const sellTx = transactions.filter(tx => tx.type === 'out').length;
    
    let dominantAction: DominantAction = 'mixed';
    
    if (buyTx > sellTx * 2) {
      dominantAction = 'buy';
    } else if (sellTx > buyTx * 2) {
      dominantAction = 'sell';
    }
    
    // Calculate burstiness (variance in daily activity)
    const burstinessScore = this.calculateBurstiness(transactions);
    
    // Calculate diversification (how spread across tokens)
    const diversificationScore = this.calculateDiversification(transactions);
    
    return {
      dominantAction,
      burstinessScore,
      diversificationScore,
    };
  }

  /**
   * Calculate burstiness score (0 = uniform, 1 = very bursty)
   */
  private calculateBurstiness(transactions: RawWalletData['transactions']): number {
    if (transactions.length < 5) return 0.5; // Not enough data
    
    // Group by day
    const dailyCounts = new Map<string, number>();
    for (const tx of transactions) {
      const day = tx.timestamp.toISOString().split('T')[0];
      dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
    }
    
    const counts = Array.from(dailyCounts.values());
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
    const stdDev = Math.sqrt(variance);
    
    // Coefficient of variation (normalized)
    const cv = mean > 0 ? stdDev / mean : 0;
    
    // Normalize to 0-1 (cap at 2.0 CV)
    return Math.min(1, cv / 2);
  }

  /**
   * Calculate diversification score (0 = concentrated, 1 = diversified)
   */
  private calculateDiversification(transactions: RawWalletData['transactions']): number {
    const tokenVolumes = new Map<string, number>();
    let totalVolume = 0;
    
    for (const tx of transactions) {
      const token = tx.token?.address || 'native';
      tokenVolumes.set(token, (tokenVolumes.get(token) || 0) + tx.value);
      totalVolume += tx.value;
    }
    
    if (totalVolume === 0) return 0.5;
    
    // Calculate Herfindahl index (concentration)
    let herfindahl = 0;
    for (const volume of tokenVolumes.values()) {
      const share = volume / totalVolume;
      herfindahl += share * share;
    }
    
    // Convert to diversification (1 - normalized HHI)
    return 1 - Math.min(1, herfindahl);
  }

  /**
   * Derive tags from metrics
   */
  private deriveTags(
    activity: WalletProfile['activity'],
    flows: WalletProfile['flows'],
    behavior: WalletProfile['behavior'],
    rawData: RawWalletData
  ): WalletTag[] {
    const tags: WalletTag[] = [];
    const now = new Date();
    
    // Activity tags
    const daysSinceActive = (now.getTime() - activity.lastSeen.getTime()) / (1000 * 60 * 60 * 24);
    const walletAge = (now.getTime() - activity.firstSeen.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSinceActive < TAG_THRESHOLDS.activeDaysForActive) {
      tags.push('active');
    } else if (daysSinceActive > TAG_THRESHOLDS.dormantDays) {
      tags.push('dormant');
    }
    
    if (walletAge < TAG_THRESHOLDS.newWalletDays) {
      tags.push('new');
    }
    
    // Volume tags
    const totalVolume = flows.totalIn + flows.totalOut;
    
    if (totalVolume > TAG_THRESHOLDS.whaleThreshold) {
      tags.push('whale');
      tags.push('high-volume');
    } else if (totalVolume > TAG_THRESHOLDS.highVolumeThreshold) {
      tags.push('high-volume');
    } else if (totalVolume < TAG_THRESHOLDS.lowVolumeThreshold) {
      tags.push('low-volume');
    }
    
    // Behavior tags
    if ((activity.avgTxPerDay || 0) >= TAG_THRESHOLDS.traderTxPerDay) {
      tags.push('trader');
    }
    
    if (behavior.dominantAction === 'buy' && flows.netFlow > 0) {
      tags.push('holder');
    }
    
    if (behavior.burstinessScore > 0.7) {
      tags.push('degen'); // High burstiness = potentially risky behavior
    }
    
    // Technical tags
    if (rawData.isContract) {
      tags.push('contract');
    }
    
    // Check for bridge patterns (simplified)
    if (rawData.labels?.includes('bridge')) {
      tags.push('bridge-user');
    }
    
    return tags;
  }

  /**
   * Calculate profile confidence
   */
  private calculateConfidence(
    activity: WalletProfile['activity'],
    txCount: number
  ): number {
    let confidence = 0.3; // Base confidence
    
    // More transactions = higher confidence
    if (txCount >= TAG_THRESHOLDS.minTxForHighConfidence) {
      confidence += 0.3;
    } else if (txCount >= 20) {
      confidence += 0.2;
    } else if (txCount >= 10) {
      confidence += 0.1;
    }
    
    // More active days = higher confidence
    if (activity.activeDays >= TAG_THRESHOLDS.minDaysForHighConfidence) {
      confidence += 0.3;
    } else if (activity.activeDays >= 14) {
      confidence += 0.2;
    } else if (activity.activeDays >= 7) {
      confidence += 0.1;
    }
    
    // Recent activity boosts confidence
    const now = new Date();
    const daysSinceActive = (now.getTime() - activity.lastSeen.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSinceActive < 7) {
      confidence += 0.1;
    }
    
    return Math.min(1, confidence);
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    tags: WalletTag[],
    behavior: WalletProfile['behavior'],
    flows: WalletProfile['flows'],
    activity: WalletProfile['activity']
  ): WalletProfile['summary'] {
    const parts: string[] = [];
    
    // Activity level
    if (tags.includes('active')) {
      parts.push('Active');
    } else if (tags.includes('dormant')) {
      parts.push('Dormant');
    } else if (tags.includes('new')) {
      parts.push('New');
    }
    
    // Volume level
    if (tags.includes('whale')) {
      parts.push('whale');
    } else if (tags.includes('high-volume')) {
      parts.push('high-volume');
    }
    
    // Behavior type
    if (tags.includes('trader')) {
      parts.push('trader');
    } else if (tags.includes('holder')) {
      parts.push('holder');
    } else if (behavior.dominantAction === 'buy') {
      parts.push('accumulator');
    } else if (behavior.dominantAction === 'sell') {
      parts.push('distributor');
    }
    
    const headline = parts.length > 0 
      ? parts.join(' ') 
      : 'Mixed activity wallet';
    
    // Build description
    const descParts: string[] = [];
    
    descParts.push(`${activity.txCount} transactions over ${activity.activeDays} active days`);
    
    if (flows.netFlow > 0) {
      descParts.push(`Net accumulation of $${this.formatNumber(flows.netFlow)}`);
    } else if (flows.netFlow < 0) {
      descParts.push(`Net distribution of $${this.formatNumber(Math.abs(flows.netFlow))}`);
    }
    
    if (tags.includes('bridge-user')) {
      descParts.push('Uses cross-chain bridges');
    }
    
    return {
      headline: headline.charAt(0).toUpperCase() + headline.slice(1),
      description: descParts.join('. ') + '.',
    };
  }

  /**
   * Format large numbers
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toFixed(0);
  }

  /**
   * Save profile to database
   */
  private async saveProfile(profile: WalletProfile, isNew: boolean): Promise<void> {
    if (isNew) {
      await WalletProfileModel.create(profile);
    } else {
      await WalletProfileModel.findOneAndUpdate(
        { profileId: profile.profileId },
        { $set: profile },
        { upsert: true }
      );
    }
  }

  /**
   * Record profile update event
   */
  private async recordUpdateEvent(
    profile: WalletProfile,
    isNew: boolean,
    previousTags?: WalletTag[]
  ): Promise<void> {
    await ProfileUpdateEventModel.create({
      profileId: profile.profileId,
      address: profile.address,
      updateType: isNew ? 'created' : 'refreshed',
      previousTags,
      newTags: profile.tags,
      timestamp: new Date(),
    });
  }

  /**
   * Get profile by address
   */
  async getProfileByAddress(
    address: string,
    chain: string = 'Ethereum'
  ): Promise<WalletProfile | null> {
    const profile = await WalletProfileModel.findOne({ 
      address: address.toLowerCase(), 
      chain 
    }).lean();
    
    return profile as WalletProfile | null;
  }

  /**
   * Get profile by ID
   */
  async getProfileById(profileId: string): Promise<WalletProfile | null> {
    const profile = await WalletProfileModel.findOne({ profileId }).lean();
    return profile as WalletProfile | null;
  }

  /**
   * Search profiles by tags
   */
  async searchByTags(
    tags: WalletTag[],
    limit: number = 50
  ): Promise<WalletProfile[]> {
    return WalletProfileModel
      .find({ tags: { $all: tags } })
      .sort({ 'flows.totalIn': -1 })
      .limit(limit)
      .lean() as Promise<WalletProfile[]>;
  }

  /**
   * Get high-volume wallets
   */
  async getHighVolumeWallets(limit: number = 20): Promise<WalletProfile[]> {
    return WalletProfileModel
      .find({ tags: 'high-volume' })
      .sort({ 'flows.totalIn': -1 })
      .limit(limit)
      .lean() as Promise<WalletProfile[]>;
  }

  /**
   * Get profiles needing refresh
   */
  async getStaleProfiles(maxAge: number = 60): Promise<WalletProfile[]> {
    const cutoff = new Date();
    cutoff.setMinutes(cutoff.getMinutes() - maxAge);
    
    return WalletProfileModel
      .find({ updatedAt: { $lt: cutoff } })
      .sort({ updatedAt: 1 })
      .limit(100)
      .lean() as Promise<WalletProfile[]>;
  }
}

// Export singleton instance
export const walletProfileEngine = new WalletProfileEngine();
