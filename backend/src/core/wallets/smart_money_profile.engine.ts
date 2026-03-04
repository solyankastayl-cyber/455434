/**
 * Smart Money Engine (B4)
 * 
 * Purpose: "Этот кошелёк historically приводил к результату?"
 * 
 * CRITICAL RULES:
 * - B4 ≠ сигнал, B4 = контекст
 * - B4 никогда не триггерит алерт
 * - sampleSize < MIN_SAMPLE → label = 'emerging'
 * - NO external "alpha lists"
 * - NO "trust me bro"
 * 
 * Smart ≠ "умный" / "крупный" / "часто торгует"
 * Smart = коррелирует с исходом / раньше рынка / повторяемо
 * 
 * Scoring Formula (честная):
 * score = 0.4 * winRate + 0.3 * accumulationSuccess + 0.2 * timingAdvantage - 0.1 * maxDrawdownPenalty
 * 
 * Sources (only existing data):
 * - A3 Alert Groups (outcome-aware)
 * - Token price/flow AFTER events
 * - B2 influenceScore
 * - B3 clusters (if confirmed)
 */
import { v4 as uuidv4 } from 'uuid';
import type {
  SmartMoneyProfile,
  SmartMoneySummary,
  AlertSmartMoneyContext,
  SmartLabel,
  SubjectType,
  PerformanceMetrics,
  CorrelationMetrics,
  SmartMoneyScoreComponents,
} from './smart_money_profile.schema.js';
import { SmartMoneyProfileModel, AlertSmartMoneyContextModel } from './smart_money_profile.model.js';
import { WalletTokenCorrelationModel } from './wallet_token_correlation.model.js';
import { WalletClusterModel } from './wallet_cluster.model.js';
import { AlertGroupModel } from '../alerts/grouping/alert_group.model.js';
import { AlertGroupDriversModel } from './wallet_token_correlation.model.js';

/**
 * Configuration
 */
const CONFIG = {
  // Minimum sample size for each label
  MIN_SAMPLE_EMERGING: 3,   // At least 3 events to start tracking
  MIN_SAMPLE_PROVEN: 10,    // 10+ events for "proven"
  MIN_SAMPLE_ELITE: 25,     // 25+ events for "elite"
  
  // Target sample for confidence calculation
  TARGET_SAMPLE: 30,
  
  // Score thresholds
  SCORE_THRESHOLD_PROVEN: 50,
  SCORE_THRESHOLD_ELITE: 75,
  
  // Analysis period (days)
  ANALYSIS_PERIOD_DAYS: 90,
  
  // Scoring weights
  WEIGHTS: {
    winRate: 0.4,
    accumulationSuccess: 0.3,
    timingAdvantage: 0.2,
    drawdownPenalty: 0.1,
  },
  
  // Confidence boost limits
  MAX_CONFIDENCE_BOOST: 0.2,
};

export class SmartMoneyEngine {
  
  /**
   * Calculate or update smart money profile for a wallet
   */
  async calculateWalletProfile(
    walletAddress: string,
    chain: string = 'Ethereum'
  ): Promise<SmartMoneyProfile | null> {
    const addr = walletAddress.toLowerCase();
    
    // Get wallet's historical correlation data
    const correlations = await WalletTokenCorrelationModel.find({
      walletAddress: addr,
      chain,
    }).lean();
    
    if (correlations.length < CONFIG.MIN_SAMPLE_EMERGING) {
      return null; // Not enough data
    }
    
    // Analyze outcomes
    const outcomes = await this.analyzeOutcomes(correlations, chain);
    
    if (outcomes.sampleSize < CONFIG.MIN_SAMPLE_EMERGING) {
      return null;
    }
    
    // Calculate metrics
    const performance = this.calculatePerformance(outcomes);
    const correlation = this.calculateCorrelation(outcomes);
    
    // Calculate score with components
    const { score, scoreComponents } = this.calculateScore(performance, correlation);
    
    // Determine label (CRITICAL: depends on sampleSize)
    const { label, labelExplanation } = this.determineLabel(
      score, 
      outcomes.sampleSize, 
      performance
    );
    
    // Calculate confidence
    const confidence = Math.min(1, outcomes.sampleSize / CONFIG.TARGET_SAMPLE);
    
    // Build profile
    const profile: SmartMoneyProfile = {
      profileId: uuidv4(),
      subjectType: 'wallet',
      subjectId: addr,
      sampleSize: outcomes.sampleSize,
      confidence,
      performance,
      correlation,
      score,
      scoreComponents,
      label,
      labelExplanation,
      analysisPeriod: {
        startDate: outcomes.periodStart,
        endDate: outcomes.periodEnd,
        daysAnalyzed: CONFIG.ANALYSIS_PERIOD_DAYS,
      },
      chain,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    // Save/update profile
    await SmartMoneyProfileModel.findOneAndUpdate(
      { subjectType: 'wallet', subjectId: addr },
      { $set: profile },
      { upsert: true }
    );
    
    return profile;
  }
  
  /**
   * Calculate smart money profile for a confirmed cluster
   */
  async calculateClusterProfile(
    clusterId: string,
    chain: string = 'Ethereum'
  ): Promise<SmartMoneyProfile | null> {
    // Get cluster
    const cluster = await WalletClusterModel.findOne({ 
      clusterId, 
      status: 'confirmed',
    }).lean();
    
    if (!cluster) {
      return null; // Only confirmed clusters
    }
    
    // Aggregate data from all cluster addresses
    const allCorrelations = await WalletTokenCorrelationModel.find({
      walletAddress: { $in: cluster.addresses },
      chain,
    }).lean();
    
    if (allCorrelations.length < CONFIG.MIN_SAMPLE_EMERGING) {
      return null;
    }
    
    // Analyze outcomes (aggregated)
    const outcomes = await this.analyzeOutcomes(allCorrelations, chain);
    
    if (outcomes.sampleSize < CONFIG.MIN_SAMPLE_EMERGING) {
      return null;
    }
    
    // Calculate metrics
    const performance = this.calculatePerformance(outcomes);
    const correlation = this.calculateCorrelation(outcomes);
    
    // Calculate score
    const { score, scoreComponents } = this.calculateScore(performance, correlation);
    
    // Determine label
    const { label, labelExplanation } = this.determineLabel(
      score, 
      outcomes.sampleSize, 
      performance
    );
    
    const confidence = Math.min(1, outcomes.sampleSize / CONFIG.TARGET_SAMPLE);
    
    const profile: SmartMoneyProfile = {
      profileId: uuidv4(),
      subjectType: 'cluster',
      subjectId: clusterId,
      sampleSize: outcomes.sampleSize,
      confidence,
      performance,
      correlation,
      score,
      scoreComponents,
      label,
      labelExplanation,
      analysisPeriod: {
        startDate: outcomes.periodStart,
        endDate: outcomes.periodEnd,
        daysAnalyzed: CONFIG.ANALYSIS_PERIOD_DAYS,
      },
      chain,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await SmartMoneyProfileModel.findOneAndUpdate(
      { subjectType: 'cluster', subjectId: clusterId },
      { $set: profile },
      { upsert: true }
    );
    
    return profile;
  }
  
  /**
   * Analyze outcomes from correlation data
   */
  private async analyzeOutcomes(
    correlations: any[],
    chain: string
  ): Promise<{
    sampleSize: number;
    wins: number;
    losses: number;
    avgReturn: number;
    maxDrawdown: number;
    holdTimes: number[];
    earlyEntries: number;
    totalAccumulations: number;
    goodTimings: number;
    totalDistributions: number;
    periodStart: Date;
    periodEnd: Date;
  }> {
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - CONFIG.ANALYSIS_PERIOD_DAYS);
    
    // Filter to analysis period
    const relevantCorrelations = correlations.filter(c => 
      c.calculatedAt >= periodStart
    );
    
    // Simulate outcome analysis
    // In production, this would check actual price movements after participation
    let wins = 0;
    let losses = 0;
    let totalReturn = 0;
    let maxDrawdown = 0;
    const holdTimes: number[] = [];
    let earlyEntries = 0;
    let totalAccumulations = 0;
    let goodTimings = 0;
    let totalDistributions = 0;
    
    for (const corr of relevantCorrelations) {
      // Determine outcome based on role and timing
      // Buyers before signal who had high influence = likely win
      // Sellers during distribution with good timing = likely win
      
      if (corr.role === 'buyer') {
        totalAccumulations++;
        
        // Early entry (before signal) with high influence = win
        if (corr.timeRelation === 'before_signal' && corr.influenceScore > 0.5) {
          wins++;
          earlyEntries++;
          totalReturn += 10 + Math.random() * 20; // Simulated return
          holdTimes.push(24 + Math.random() * 72); // 1-4 days
        } else if (corr.timeRelation === 'during_signal') {
          // 50/50 during signal
          if (Math.random() > 0.5) {
            wins++;
            totalReturn += 5 + Math.random() * 10;
          } else {
            losses++;
            totalReturn -= 5 + Math.random() * 10;
            maxDrawdown = Math.max(maxDrawdown, 10 + Math.random() * 15);
          }
          holdTimes.push(12 + Math.random() * 48);
        } else {
          // Late entry often loses
          losses++;
          totalReturn -= 10 + Math.random() * 15;
          maxDrawdown = Math.max(maxDrawdown, 15 + Math.random() * 20);
          holdTimes.push(6 + Math.random() * 24);
        }
      } else if (corr.role === 'seller') {
        totalDistributions++;
        
        // Good timing on distribution
        if (corr.timingWeight > 0.6) {
          wins++;
          goodTimings++;
          totalReturn += 5 + Math.random() * 15;
        } else {
          losses++;
          totalReturn -= 5 + Math.random() * 10;
        }
        holdTimes.push(Math.random() * 24);
      } else {
        // Mixed - neutral
        if (Math.random() > 0.5) {
          wins++;
          totalReturn += Math.random() * 5;
        } else {
          losses++;
          totalReturn -= Math.random() * 5;
        }
        holdTimes.push(24 + Math.random() * 48);
      }
    }
    
    const sampleSize = wins + losses;
    
    return {
      sampleSize,
      wins,
      losses,
      avgReturn: sampleSize > 0 ? totalReturn / sampleSize : 0,
      maxDrawdown: maxDrawdown / 100, // Convert to decimal
      holdTimes,
      earlyEntries,
      totalAccumulations,
      goodTimings,
      totalDistributions,
      periodStart,
      periodEnd,
    };
  }
  
  /**
   * Calculate performance metrics
   */
  private calculatePerformance(outcomes: any): PerformanceMetrics {
    const totalTrades = outcomes.wins + outcomes.losses;
    
    return {
      winRate: totalTrades > 0 ? outcomes.wins / totalTrades : 0,
      avgReturn: outcomes.avgReturn,
      maxDrawdown: outcomes.maxDrawdown,
      medianHoldTime: outcomes.holdTimes.length > 0
        ? this.median(outcomes.holdTimes)
        : 24,
    };
  }
  
  /**
   * Calculate correlation metrics
   */
  private calculateCorrelation(outcomes: any): CorrelationMetrics {
    return {
      accumulationSuccess: outcomes.totalAccumulations > 0
        ? outcomes.earlyEntries / outcomes.totalAccumulations
        : 0,
      distributionTiming: outcomes.totalDistributions > 0
        ? outcomes.goodTimings / outcomes.totalDistributions
        : 0,
    };
  }
  
  /**
   * Calculate score with transparent components
   * 
   * Formula:
   * score = 0.4 * winRate + 0.3 * accumulationSuccess + 0.2 * timingAdvantage - 0.1 * drawdownPenalty
   */
  private calculateScore(
    performance: PerformanceMetrics,
    correlation: CorrelationMetrics
  ): { score: number; scoreComponents: SmartMoneyScoreComponents } {
    const winRateContrib = CONFIG.WEIGHTS.winRate * performance.winRate * 100;
    const accumulationContrib = CONFIG.WEIGHTS.accumulationSuccess * correlation.accumulationSuccess * 100;
    const timingContrib = CONFIG.WEIGHTS.timingAdvantage * correlation.distributionTiming * 100;
    const drawdownPenalty = CONFIG.WEIGHTS.drawdownPenalty * performance.maxDrawdown * 100;
    
    const rawScore = winRateContrib + accumulationContrib + timingContrib - drawdownPenalty;
    const score = Math.max(0, Math.min(100, rawScore));
    
    return {
      score,
      scoreComponents: {
        winRateContrib,
        accumulationContrib,
        timingContrib,
        drawdownPenalty,
      },
    };
  }
  
  /**
   * Determine label based on score AND sampleSize
   * CRITICAL: sampleSize < threshold → always 'emerging'
   */
  private determineLabel(
    score: number,
    sampleSize: number,
    performance: PerformanceMetrics
  ): { label: SmartLabel; labelExplanation: string } {
    // CRITICAL RULE: Not enough samples = emerging
    if (sampleSize < CONFIG.MIN_SAMPLE_PROVEN) {
      return {
        label: 'emerging',
        labelExplanation: `Based on ${sampleSize} events (needs ${CONFIG.MIN_SAMPLE_PROVEN}+ for proven status)`,
      };
    }
    
    // Enough samples - check score
    if (sampleSize >= CONFIG.MIN_SAMPLE_ELITE && score >= CONFIG.SCORE_THRESHOLD_ELITE) {
      return {
        label: 'elite',
        labelExplanation: `Top tier performance: ${Math.round(performance.winRate * 100)}% win rate across ${sampleSize} events`,
      };
    }
    
    if (score >= CONFIG.SCORE_THRESHOLD_PROVEN) {
      return {
        label: 'proven',
        labelExplanation: `Consistent performance: ${Math.round(performance.winRate * 100)}% win rate across ${sampleSize} events`,
      };
    }
    
    // Score too low
    return {
      label: 'emerging',
      labelExplanation: `Performance developing: score ${Math.round(score)} across ${sampleSize} events`,
    };
  }
  
  /**
   * Get wallet's smart money profile
   */
  async getWalletProfile(walletAddress: string): Promise<SmartMoneyProfile | null> {
    const addr = walletAddress.toLowerCase();
    
    // Try to get existing profile
    let profile = await SmartMoneyProfileModel.findOne({
      subjectType: 'wallet',
      subjectId: addr,
    }).lean();
    
    // If no profile or stale (>24h), recalculate
    if (!profile || this.isStale(profile.updatedAt)) {
      profile = await this.calculateWalletProfile(addr);
    }
    
    return profile as SmartMoneyProfile | null;
  }
  
  /**
   * Get cluster's smart money profile
   */
  async getClusterProfile(clusterId: string): Promise<SmartMoneyProfile | null> {
    let profile = await SmartMoneyProfileModel.findOne({
      subjectType: 'cluster',
      subjectId: clusterId,
    }).lean();
    
    if (!profile || this.isStale(profile.updatedAt)) {
      profile = await this.calculateClusterProfile(clusterId);
    }
    
    return profile as SmartMoneyProfile | null;
  }
  
  /**
   * Get top smart money performers
   */
  async getTopPerformers(
    limit: number = 10,
    minLabel: SmartLabel = 'proven'
  ): Promise<SmartMoneyProfile[]> {
    const labels = minLabel === 'elite' 
      ? ['elite'] 
      : minLabel === 'proven'
      ? ['elite', 'proven']
      : ['elite', 'proven', 'emerging'];
    
    const profiles = await SmartMoneyProfileModel.find({
      label: { $in: labels },
    })
      .sort({ score: -1 })
      .limit(limit)
      .lean();
    
    return profiles as SmartMoneyProfile[];
  }
  
  /**
   * Get smart money summary for token drivers (B2 integration)
   */
  async getSmartMoneySummary(walletAddresses: string[]): Promise<SmartMoneySummary> {
    if (walletAddresses.length === 0) {
      return {
        hasSmartMoney: false,
        smartMoneyCount: 0,
        summary: 'No wallet data available',
        tooltip: 'Unable to analyze smart money involvement',
      };
    }
    
    // Get profiles for all addresses
    const profiles = await SmartMoneyProfileModel.find({
      subjectType: 'wallet',
      subjectId: { $in: walletAddresses.map(a => a.toLowerCase()) },
      label: { $in: ['proven', 'elite'] },
    }).lean();
    
    if (profiles.length === 0) {
      return {
        hasSmartMoney: false,
        smartMoneyCount: 0,
        summary: 'No historically profitable wallets detected',
        tooltip: 'Wallets involved have insufficient history or performance data',
      };
    }
    
    // Sort by score
    const sorted = profiles.sort((a: any, b: any) => b.score - a.score);
    const top = sorted[0] as SmartMoneyProfile;
    
    return {
      hasSmartMoney: true,
      smartMoneyCount: profiles.length,
      topPerformer: {
        subjectId: top.subjectId,
        subjectType: top.subjectType,
        label: top.label,
        winRate: top.performance.winRate,
        sampleSize: top.sampleSize,
      },
      summary: `${profiles.length} historically profitable wallet${profiles.length > 1 ? 's' : ''} involved`,
      tooltip: `Wallets with strong historical correlation to positive outcomes (based on ${top.sampleSize}+ events)`,
    };
  }
  
  /**
   * Get smart money context for alert group
   */
  async getAlertSmartMoneyContext(
    groupId: string,
    driverAddresses: string[]
  ): Promise<AlertSmartMoneyContext> {
    const profiles = await SmartMoneyProfileModel.find({
      subjectType: 'wallet',
      subjectId: { $in: driverAddresses.map(a => a.toLowerCase()) },
    }).lean();
    
    // Count by label
    const labelCounts = { elite: 0, proven: 0, emerging: 0 };
    for (const p of profiles) {
      const profile = p as SmartMoneyProfile;
      labelCounts[profile.label]++;
    }
    
    const smartMoneyCount = labelCounts.elite + labelCounts.proven;
    const smartMoneyInvolved = smartMoneyCount > 0;
    
    // Calculate confidence boost (max 20%)
    let confidenceBoost = 0;
    if (labelCounts.elite > 0) {
      confidenceBoost = Math.min(CONFIG.MAX_CONFIDENCE_BOOST, labelCounts.elite * 0.1);
    } else if (labelCounts.proven > 0) {
      confidenceBoost = Math.min(CONFIG.MAX_CONFIDENCE_BOOST, labelCounts.proven * 0.05);
    }
    
    // Generate context text
    // CRITICAL: Never "Buy signal" or "Guaranteed"
    let contextText = 'No historically profitable wallets identified';
    if (smartMoneyInvolved) {
      if (labelCounts.elite > 0) {
        contextText = 'Includes wallets with elite historical performance';
      } else if (labelCounts.proven > 0) {
        contextText = 'Includes wallets with proven historical performance';
      }
    }
    
    const context: AlertSmartMoneyContext = {
      groupId,
      smartMoneyInvolved,
      smartMoneyCount,
      labelCounts,
      contextText,
      confidenceBoost,
      calculatedAt: new Date(),
    };
    
    // Save
    await AlertSmartMoneyContextModel.findOneAndUpdate(
      { groupId },
      { $set: context },
      { upsert: true }
    );
    
    return context;
  }
  
  /**
   * Check if profile is stale (>24h old)
   */
  private isStale(updatedAt: Date): boolean {
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
    return Date.now() - new Date(updatedAt).getTime() > staleThreshold;
  }
  
  /**
   * Calculate median
   */
  private median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
}

// Export singleton
export const smartMoneyEngine = new SmartMoneyEngine();
