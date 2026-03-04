/**
 * Wallet Token Correlation Engine (B2)
 * 
 * Purpose: "Этот токен движется из-за кого?"
 * 
 * ARCHITECTURAL RULES:
 * 1. UI never guesses, backend always explains (scoreComponents)
 * 2. Role is contextual, not absolute (roleContext)
 * 3. A4 Dispatcher does NOT form drivers - drivers come ONLY from B2
 * 4. Empty driver ≠ error (crowd behavior)
 * 
 * Calculates influence score using:
 * - Volume share (доля кошелька в общем потоке)
 * - Activity frequency (как часто участвовал)
 * - Timing weight (до/во время сигнала)
 * 
 * Formula (MVP):
 * influenceScore = 0.4 * volume_share + 0.3 * activity_freq + 0.3 * timing_weight
 */
import { v4 as uuidv4 } from 'uuid';
import type { 
  WalletTokenCorrelation, 
  TokenActivityDrivers,
  WalletRole,
  RoleContext,
  TimeRelation,
  AlertGroupDrivers,
  ScoreComponents,
} from './wallet_token_correlation.schema.js';
import { WalletTokenCorrelationModel, AlertGroupDriversModel } from './wallet_token_correlation.model.js';
import { WalletProfileModel } from './wallet_profile.model.js';
import { SignalModel } from '../signals/signals.model.js';
import { TransferModel } from '../transfers/transfers.model.js';

/**
 * Weights for influence score calculation
 * Transparent and documented
 */
const INFLUENCE_WEIGHTS = {
  volumeShare: 0.4,       // 40% - доля в объеме
  activityFrequency: 0.3, // 30% - частота активности  
  timingWeight: 0.3,      // 30% - время относительно сигнала
};

/**
 * Thresholds
 */
const THRESHOLDS = {
  minTxCount: 2,             // Minimum transactions to be considered
  minVolumeShare: 0.01,      // Minimum 1% volume share
  topDriversLimit: 10,       // Max drivers for storage
  uiDriversLimit: 3,         // Max drivers for UI (product rule)
  analysisWindowHours: 24,   // Default analysis window
};

export class WalletTokenCorrelationEngine {
  /**
   * Calculate correlations for a token
   */
  async calculateTokenCorrelations(
    tokenAddress: string,
    chain: string = 'Ethereum',
    windowHours: number = THRESHOLDS.analysisWindowHours
  ): Promise<WalletTokenCorrelation[]> {
    const tokenAddr = tokenAddress.toLowerCase();
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - windowHours * 60 * 60 * 1000);
    
    // Get transfers for this token in the window
    const transfers = await TransferModel.find({
      tokenAddress: tokenAddr,
      timestamp: { $gte: periodStart, $lte: periodEnd },
    }).lean();
    
    if (transfers.length === 0) {
      return [];
    }
    
    // Aggregate by wallet
    const walletStats = new Map<string, {
      inVolume: number;
      outVolume: number;
      txCount: number;
      firstTx: Date;
      lastTx: Date;
    }>();
    
    let totalVolume = 0;
    
    for (const tx of transfers) {
      const from = (tx.fromAddress || '').toLowerCase();
      const to = (tx.toAddress || '').toLowerCase();
      const value = tx.valueUsd || 0;
      
      totalVolume += value;
      
      // From wallet (outflow)
      if (from && from !== '0x0000000000000000000000000000000000000000') {
        const stats = walletStats.get(from) || {
          inVolume: 0, outVolume: 0, txCount: 0,
          firstTx: tx.timestamp, lastTx: tx.timestamp,
        };
        stats.outVolume += value;
        stats.txCount++;
        if (tx.timestamp < stats.firstTx) stats.firstTx = tx.timestamp;
        if (tx.timestamp > stats.lastTx) stats.lastTx = tx.timestamp;
        walletStats.set(from, stats);
      }
      
      // To wallet (inflow)
      if (to && to !== '0x0000000000000000000000000000000000000000') {
        const stats = walletStats.get(to) || {
          inVolume: 0, outVolume: 0, txCount: 0,
          firstTx: tx.timestamp, lastTx: tx.timestamp,
        };
        stats.inVolume += value;
        stats.txCount++;
        if (tx.timestamp < stats.firstTx) stats.firstTx = tx.timestamp;
        if (tx.timestamp > stats.lastTx) stats.lastTx = tx.timestamp;
        walletStats.set(to, stats);
      }
    }
    
    // Get signals for timing analysis
    const signals = await SignalModel.find({
      assetAddress: tokenAddr,
      timestamp: { $gte: periodStart, $lte: periodEnd },
    }).sort({ timestamp: 1 }).lean();
    
    const firstSignalTime = signals.length > 0 ? signals[0].timestamp : periodEnd;
    
    // Determine overall roleContext based on net flow
    const overallRoleContext = this.determineRoleContext(walletStats, totalVolume);
    
    // Calculate correlations
    const correlations: WalletTokenCorrelation[] = [];
    
    for (const [walletAddress, stats] of walletStats) {
      // Filter by minimum thresholds
      const walletVolume = stats.inVolume + stats.outVolume;
      const volumeShare = totalVolume > 0 ? walletVolume / totalVolume : 0;
      
      if (stats.txCount < THRESHOLDS.minTxCount) continue;
      if (volumeShare < THRESHOLDS.minVolumeShare) continue;
      
      // Determine role (contextual, not absolute)
      const netFlow = stats.inVolume - stats.outVolume;
      let role: WalletRole = 'mixed';
      if (netFlow > walletVolume * 0.3) role = 'buyer';
      else if (netFlow < -walletVolume * 0.3) role = 'seller';
      
      // Calculate timing weight
      const { timeRelation, timingWeight } = this.calculateTimingMetrics(
        stats.firstTx,
        firstSignalTime,
        periodStart
      );
      
      // Calculate activity frequency (tx per day)
      const daySpan = Math.max(1, 
        (stats.lastTx.getTime() - stats.firstTx.getTime()) / (1000 * 60 * 60 * 24)
      );
      const activityFrequency = stats.txCount / daySpan;
      const normalizedFrequency = Math.min(1, activityFrequency / 10); // Cap at 10 tx/day
      
      // Build scoreComponents (transparent breakdown)
      const scoreComponents: ScoreComponents = {
        volumeShare: volumeShare,
        activityFrequency: normalizedFrequency,
        timingWeight: timingWeight,
      };
      
      // Calculate influence score
      const influenceScore = 
        INFLUENCE_WEIGHTS.volumeShare * scoreComponents.volumeShare +
        INFLUENCE_WEIGHTS.activityFrequency * scoreComponents.activityFrequency +
        INFLUENCE_WEIGHTS.timingWeight * scoreComponents.timingWeight;
      
      // Get wallet profile for metadata
      const walletProfile = await WalletProfileModel.findOne({ 
        address: walletAddress 
      }).lean();
      
      const correlation: WalletTokenCorrelation = {
        correlationId: uuidv4(),
        walletAddress,
        tokenAddress: tokenAddr,
        chain,
        role,
        roleContext: overallRoleContext,  // NEW: Context for role
        influenceScore: Math.min(1, influenceScore),
        scoreComponents,  // NEW: Transparent breakdown
        netFlow,
        totalVolume: walletVolume,
        txCount: stats.txCount,
        volumeShare,
        activityFrequency,
        timeRelation,
        timingWeight,
        periodStart,
        periodEnd,
        confidence: this.calculateConfidence(stats.txCount, volumeShare),
        walletMeta: walletProfile ? {
          tags: walletProfile.tags || [],
          headline: walletProfile.summary?.headline,
        } : undefined,
        calculatedAt: new Date(),
        updatedAt: new Date(),
      };
      
      correlations.push(correlation);
    }
    
    // Sort by influence score (not by txCount - product rule)
    correlations.sort((a, b) => b.influenceScore - a.influenceScore);
    
    // Save top correlations to database
    const topCorrelations = correlations.slice(0, THRESHOLDS.topDriversLimit);
    for (const correlation of topCorrelations) {
      await WalletTokenCorrelationModel.findOneAndUpdate(
        { walletAddress: correlation.walletAddress, tokenAddress: correlation.tokenAddress },
        { $set: correlation },
        { upsert: true }
      );
    }
    
    return topCorrelations;
  }
  
  /**
   * Determine role context based on overall market behavior
   */
  private determineRoleContext(
    walletStats: Map<string, any>,
    totalVolume: number
  ): RoleContext {
    let totalInflow = 0;
    let totalOutflow = 0;
    
    for (const [, stats] of walletStats) {
      totalInflow += stats.inVolume;
      totalOutflow += stats.outVolume;
    }
    
    const netFlow = totalInflow - totalOutflow;
    const flowRatio = totalVolume > 0 ? Math.abs(netFlow) / totalVolume : 0;
    
    if (flowRatio > 0.2) {
      return netFlow > 0 ? 'accumulation' : 'distribution';
    }
    return 'net_flow';
  }
  
  /**
   * Calculate timing metrics relative to signal
   */
  private calculateTimingMetrics(
    firstActivityTime: Date,
    firstSignalTime: Date,
    periodStart: Date
  ): { timeRelation: TimeRelation; timingWeight: number } {
    const activityMs = firstActivityTime.getTime();
    const signalMs = firstSignalTime.getTime();
    
    let timeRelation: TimeRelation;
    let timingWeight: number;
    
    if (activityMs < signalMs - 60 * 60 * 1000) {
      // More than 1 hour before signal
      timeRelation = 'before_signal';
      timingWeight = 1.0; // Best timing
    } else if (activityMs <= signalMs + 60 * 60 * 1000) {
      // Within 1 hour of signal
      timeRelation = 'during_signal';
      timingWeight = 0.7;
    } else {
      // After signal
      timeRelation = 'after_signal';
      timingWeight = 0.3;
    }
    
    return { timeRelation, timingWeight };
  }
  
  /**
   * Calculate confidence based on data quality
   */
  private calculateConfidence(txCount: number, volumeShare: number): number {
    let confidence = 0.3; // Base
    
    // More transactions = higher confidence
    if (txCount >= 20) confidence += 0.3;
    else if (txCount >= 10) confidence += 0.2;
    else if (txCount >= 5) confidence += 0.1;
    
    // Higher volume share = higher confidence
    if (volumeShare >= 0.1) confidence += 0.3;
    else if (volumeShare >= 0.05) confidence += 0.2;
    else if (volumeShare >= 0.02) confidence += 0.1;
    
    return Math.min(1, confidence);
  }
  
  /**
   * Get token activity drivers (aggregated view for UI)
   * 
   * PRODUCT RULES:
   * - Max 3 wallets (not dashboard)
   * - Sort by influenceScore
   * - Human-summary always on top
   */
  async getTokenActivityDrivers(
    tokenAddress: string,
    chain: string = 'Ethereum',
    limit: number = THRESHOLDS.uiDriversLimit  // Default 3 for UI
  ): Promise<TokenActivityDrivers | null> {
    const tokenAddr = tokenAddress.toLowerCase();
    
    // Enforce UI limit (max 3)
    const effectiveLimit = Math.min(limit, THRESHOLDS.uiDriversLimit);
    
    // First try to get from recent calculations
    const correlations = await WalletTokenCorrelationModel.find({
      tokenAddress: tokenAddr,
      chain,
    })
      .sort({ influenceScore: -1 })  // Sort by influenceScore, NOT txCount
      .limit(effectiveLimit)
      .lean();
    
    // If no data, calculate fresh
    if (correlations.length === 0) {
      const freshCorrelations = await this.calculateTokenCorrelations(tokenAddr, chain);
      if (freshCorrelations.length === 0) {
        return null;
      }
      return this.buildActivityDrivers(tokenAddr, chain, freshCorrelations.slice(0, effectiveLimit));
    }
    
    return this.buildActivityDrivers(tokenAddr, chain, correlations as WalletTokenCorrelation[]);
  }
  
  /**
   * Build activity drivers response
   */
  private buildActivityDrivers(
    tokenAddress: string,
    chain: string,
    correlations: WalletTokenCorrelation[]
  ): TokenActivityDrivers {
    // Calculate dominant role
    const roleCounts = { buyer: 0, seller: 0, mixed: 0 };
    for (const c of correlations) {
      roleCounts[c.role]++;
    }
    const dominantRole: WalletRole = roleCounts.buyer >= roleCounts.seller ? 'buyer' : 'seller';
    
    // Get role context from first correlation
    const roleContext: RoleContext = correlations[0]?.roleContext || 'net_flow';
    
    // Generate summary (human-readable, product-focused)
    const highInfluence = correlations.filter(c => c.influenceScore > 0.5);
    const headline = this.generateHeadline(highInfluence.length, dominantRole, roleContext);
    const description = this.generateDescription(correlations, roleContext);
    
    return {
      tokenAddress,
      chain,
      totalParticipants: correlations.length,
      dominantRole,
      roleContext,
      topDrivers: correlations.map(c => ({
        walletAddress: c.walletAddress,
        role: c.role,
        roleContext: c.roleContext || roleContext,
        influenceScore: c.influenceScore,
        scoreComponents: c.scoreComponents || {
          volumeShare: c.volumeShare,
          activityFrequency: Math.min(1, c.activityFrequency / 10),
          timingWeight: c.timingWeight,
        },
        volumeShare: c.volumeShare,
        netFlow: c.netFlow,
        txCount: c.txCount,
        confidence: c.confidence,
        walletMeta: c.walletMeta,
      })),
      summary: {
        headline,
        description,
      },
      periodStart: correlations[0]?.periodStart || new Date(),
      periodEnd: correlations[0]?.periodEnd || new Date(),
      calculatedAt: new Date(),
    };
  }
  
  /**
   * Generate headline for UI (product-focused, not analytical)
   * Example: "Recent accumulation is primarily driven by 2 wallets with historically high activity."
   */
  private generateHeadline(
    highInfluenceCount: number, 
    dominantRole: WalletRole,
    roleContext: RoleContext
  ): string {
    const contextText = roleContext === 'accumulation' 
      ? 'accumulation' 
      : roleContext === 'distribution'
      ? 'distribution'
      : 'activity';
    
    if (highInfluenceCount === 0) {
      return `No dominant wallets identified for this ${contextText}`;
    } else if (highInfluenceCount === 1) {
      return `Recent ${contextText} is primarily driven by 1 wallet with high activity`;
    } else {
      return `Recent ${contextText} is primarily driven by ${highInfluenceCount} wallets with high activity`;
    }
  }
  
  /**
   * Generate description for UI
   */
  private generateDescription(
    correlations: WalletTokenCorrelation[],
    roleContext: RoleContext
  ): string {
    if (correlations.length === 0) {
      return 'Insufficient data to analyze wallet influence.';
    }
    
    const parts: string[] = [];
    
    // Volume concentration
    const totalShare = correlations.reduce((sum, c) => sum + c.volumeShare, 0);
    if (totalShare > 0.5) {
      parts.push(`Top ${correlations.length} wallets account for ${Math.round(totalShare * 100)}% of recent volume`);
    }
    
    // Timing insight
    const earlyWallets = correlations.filter(c => c.timeRelation === 'before_signal');
    if (earlyWallets.length > 0) {
      parts.push(`${earlyWallets.length} wallet(s) were active before signal detection`);
    }
    
    // Role context insight
    if (roleContext === 'accumulation') {
      const buyers = correlations.filter(c => c.role === 'buyer');
      if (buyers.length > 0) {
        parts.push(`${buyers.length} wallet(s) acted as buyers during this accumulation`);
      }
    } else if (roleContext === 'distribution') {
      const sellers = correlations.filter(c => c.role === 'seller');
      if (sellers.length > 0) {
        parts.push(`${sellers.length} wallet(s) acted as sellers during this distribution`);
      }
    }
    
    return parts.join('. ') + (parts.length > 0 ? '.' : 'Activity analysis in progress.');
  }
  
  /**
   * Link drivers to alert group
   * 
   * ARCHITECTURAL RULE:
   * A4 Dispatcher does NOT form drivers.
   * Drivers come ONLY from B2.
   */
  async linkDriversToAlertGroup(
    groupId: string,
    tokenAddress: string,
    chain: string = 'Ethereum'
  ): Promise<AlertGroupDrivers> {
    const drivers = await this.getTokenActivityDrivers(tokenAddress, chain);
    
    // Handle empty state (not an error - sometimes market moves as "crowd")
    if (!drivers || drivers.topDrivers.length === 0) {
      const emptyResult: AlertGroupDrivers = {
        groupId,
        drivers: [],
        driverSummary: 'Behavior detected',  // Empty state label
        hasDrivers: false,
        calculatedAt: new Date(),
      };
      
      await AlertGroupDriversModel.findOneAndUpdate(
        { groupId },
        { $set: emptyResult },
        { upsert: true }
      );
      
      return emptyResult;
    }
    
    // Create driver summary for alert card
    const topDriver = drivers.topDrivers[0];
    const additionalCount = drivers.topDrivers.length - 1;
    
    let driverSummary: string;
    const displayAddr = `${topDriver.walletAddress.slice(0, 6)}...${topDriver.walletAddress.slice(-4)}`;
    
    if (additionalCount === 0) {
      driverSummary = `Driven by ${displayAddr}`;
    } else {
      driverSummary = `Driven by ${displayAddr} and ${additionalCount} more`;
    }
    
    const alertGroupDrivers: AlertGroupDrivers = {
      groupId,
      drivers: drivers.topDrivers.map(d => ({
        walletAddress: d.walletAddress,
        influenceScore: d.influenceScore,
        scoreComponents: d.scoreComponents,
        role: d.role,
        roleContext: d.roleContext,
        confidence: d.confidence,
      })),
      driverSummary,
      hasDrivers: true,
      calculatedAt: new Date(),
    };
    
    // Save to database
    await AlertGroupDriversModel.findOneAndUpdate(
      { groupId },
      { $set: alertGroupDrivers },
      { upsert: true }
    );
    
    return alertGroupDrivers;
  }
  
  /**
   * Get drivers for alert group
   */
  async getAlertGroupDrivers(groupId: string): Promise<AlertGroupDrivers | null> {
    const drivers = await AlertGroupDriversModel.findOne({ groupId }).lean();
    return drivers as AlertGroupDrivers | null;
  }
  
  /**
   * Get wallet's token correlations
   */
  async getWalletCorrelations(
    walletAddress: string,
    limit: number = 10
  ): Promise<WalletTokenCorrelation[]> {
    const addr = walletAddress.toLowerCase();
    
    return WalletTokenCorrelationModel.find({ walletAddress: addr })
      .sort({ influenceScore: -1 })  // Sort by influenceScore
      .limit(limit)
      .lean() as Promise<WalletTokenCorrelation[]>;
  }
}

// Export singleton
export const walletTokenCorrelationEngine = new WalletTokenCorrelationEngine();
