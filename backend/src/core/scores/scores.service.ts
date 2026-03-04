/**
 * Scores Service
 * Business logic for score calculation
 */
import { scoresRepository, ScoreUpsertData } from './scores.repository.js';
import { 
  IScore, 
  ScoreSubjectType, 
  ScoreWindow, 
  ScoreBreakdown,
  getTierFromScore,
  calculateCompositeScore 
} from './scores.model.js';
import type { ScoreSort, ScoreTier } from './scores.schema.js';

/**
 * Format score for API response
 */
export function formatScore(score: IScore) {
  return {
    id: score._id.toString(),
    subjectType: score.subjectType,
    subjectId: score.subjectId,
    window: score.window,
    behaviorScore: Math.round(score.behaviorScore * 10) / 10,
    intensityScore: Math.round(score.intensityScore * 10) / 10,
    consistencyScore: Math.round(score.consistencyScore * 10) / 10,
    riskScore: Math.round(score.riskScore * 10) / 10,
    influenceScore: Math.round(score.influenceScore * 10) / 10,
    compositeScore: Math.round(score.compositeScore * 10) / 10,
    tier: score.tier,
    breakdown: score.breakdown,
    chain: score.chain,
    calculatedAt: score.calculatedAt.toISOString(),
  };
}

/**
 * Scores Service
 */
export class ScoresService {
  /**
   * Get score for address
   */
  async getByAddress(
    address: string,
    window: ScoreWindow = '30d'
  ): Promise<IScore | null> {
    return scoresRepository.findBySubject('address', address, window);
  }

  /**
   * Get all window scores for address
   */
  async getAllWindowsForAddress(address: string): Promise<IScore[]> {
    return scoresRepository.findByAddress(address);
  }

  /**
   * Get score for actor
   */
  async getByActor(
    actorId: string,
    window: ScoreWindow = '30d'
  ): Promise<IScore | null> {
    return scoresRepository.findBySubject('actor', actorId, window);
  }

  /**
   * Get score for entity
   */
  async getByEntity(
    entityId: string,
    window: ScoreWindow = '30d'
  ): Promise<IScore | null> {
    return scoresRepository.findBySubject('entity', entityId, window);
  }

  /**
   * Get top scores (leaderboard)
   */
  async getTop(options: {
    type?: ScoreSubjectType;
    sort?: ScoreSort;
    tier?: ScoreTier;
    window?: ScoreWindow;
    limit?: number;
    offset?: number;
  }): Promise<{ scores: IScore[]; total: number }> {
    const scores = await scoresRepository.findTop({
      subjectType: options.type,
      sort: options.sort,
      tier: options.tier,
      window: options.window,
      limit: options.limit,
      offset: options.offset,
    });

    return { scores, total: scores.length };
  }

  /**
   * Get watchlist scores
   */
  async getWatchlist(
    addresses: string[],
    window: ScoreWindow = '30d'
  ): Promise<IScore[]> {
    return scoresRepository.findByAddresses(addresses, window);
  }

  /**
   * Get stats
   */
  async getStats(): Promise<{
    totalScored: number;
    byTier: Record<string, number>;
    byWindow: Record<string, number>;
    avgComposite: number;
    lastCalculated: string | null;
  }> {
    const stats = await scoresRepository.getStats();
    return {
      ...stats,
      avgComposite: Math.round(stats.avgComposite * 10) / 10,
      lastCalculated: stats.lastCalculated?.toISOString() || null,
    };
  }

  /**
   * Calculate and upsert score for a subject
   */
  async calculateAndSave(
    subjectType: ScoreSubjectType,
    subjectId: string,
    window: ScoreWindow,
    metrics: {
      bundles: Array<{ bundleType: string; intensityScore: number; confidence: number }>;
      relations: Array<{ densityScore: number; interactionCount: number }>;
      signals: Array<{ signalType: string; severityScore: number }>;
      transfers: Array<{ timestamp: Date }>;
    }
  ): Promise<IScore> {
    const breakdown = this.calculateBreakdown(metrics);
    const scores = this.calculateScores(breakdown);
    
    const compositeScore = calculateCompositeScore(
      scores.behaviorScore,
      scores.intensityScore,
      scores.consistencyScore,
      scores.riskScore,
      scores.influenceScore
    );

    const data: ScoreUpsertData = {
      subjectType,
      subjectId,
      window,
      ...scores,
      compositeScore,
      tier: getTierFromScore(compositeScore),
      breakdown,
    };

    return scoresRepository.upsert(data);
  }

  /**
   * Calculate breakdown metrics from raw data
   */
  private calculateBreakdown(metrics: {
    bundles: Array<{ bundleType: string; intensityScore: number; confidence: number }>;
    relations: Array<{ densityScore: number; interactionCount: number }>;
    signals: Array<{ signalType: string; severityScore: number }>;
    transfers: Array<{ timestamp: Date }>;
  }): ScoreBreakdown {
    const { bundles, relations, signals, transfers } = metrics;

    // Behavior ratios from bundles
    const bundleCount = bundles.length || 1;
    const accumulationCount = bundles.filter(b => b.bundleType === 'accumulation').length;
    const distributionCount = bundles.filter(b => b.bundleType === 'distribution').length;
    const washCount = bundles.filter(b => b.bundleType === 'wash').length;
    const rotationCount = bundles.filter(b => b.bundleType === 'rotation').length;

    // Intensity from relations
    const densities = relations.map(r => r.densityScore);
    const avgDensity = densities.length > 0 
      ? densities.reduce((a, b) => a + b, 0) / densities.length 
      : 0;
    const peakDensity = densities.length > 0 ? Math.max(...densities) : 0;

    // Signal counts
    const intensitySpikes = signals.filter(s => s.signalType === 'intensity_spike').length;
    const washDetectedCount = signals.filter(s => s.signalType === 'wash_detected').length;
    const sharpReversals = signals.filter(s => 
      s.signalType === 'accumulation_end' || s.signalType === 'distribution_end'
    ).length;

    // Consistency - active days
    const uniqueDays = new Set(
      transfers.map(t => t.timestamp.toISOString().split('T')[0])
    ).size;
    const windowDays = 30; // Simplified
    const activeDaysRatio = Math.min(1, uniqueDays / windowDays);

    // Std dev of density
    const stdDevDensity = this.calculateStdDev(densities);

    // Volume weighted (simplified - use interaction counts)
    const totalInteractions = relations.reduce((sum, r) => sum + r.interactionCount, 0);
    const volumeWeighted = Math.min(100, Math.log10(totalInteractions + 1) * 20);

    // Noise ratio
    const signalNoiseRatio = signals.length > 0 
      ? signals.filter(s => s.severityScore >= 50).length / signals.length 
      : 0.5;

    // Variance check
    const highVariance = stdDevDensity > avgDensity * 0.5;
    const burstOnlyBehavior = activeDaysRatio < 0.2 && totalInteractions > 10;

    // Flow balance (accumulation vs distribution)
    const flowBalance = bundleCount > 0
      ? (accumulationCount - distributionCount) / bundleCount
      : 0;

    return {
      accumulationRatio: accumulationCount / bundleCount,
      distributionRatio: distributionCount / bundleCount,
      washRatio: washCount / bundleCount,
      rotationFrequency: rotationCount / bundleCount,
      flowBalance: (flowBalance + 1) / 2, // Normalize to 0-1
      avgDensity,
      peakDensity,
      intensitySpikes,
      volumeWeighted,
      activeDaysRatio,
      stdDevDensity,
      signalNoiseRatio,
      washDetectedCount,
      sharpReversals,
      burstOnlyBehavior,
      highVariance,
      followersCount: 0, // Requires deeper analysis
      avgFollowerLag: 0,
      frontRunRatio: 0,
      signalCount: signals.length,
      bundleCount: bundles.length,
      relationCount: relations.length,
      transferCount: transfers.length,
    };
  }

  /**
   * Calculate individual scores from breakdown
   */
  private calculateScores(breakdown: ScoreBreakdown): {
    behaviorScore: number;
    intensityScore: number;
    consistencyScore: number;
    riskScore: number;
    influenceScore: number;
  } {
    // Behavior Score (0-100)
    // Higher accumulation = positive, wash = negative
    const behaviorScore = Math.min(100, Math.max(0,
      50 +
      breakdown.accumulationRatio * 30 +
      breakdown.flowBalance * 20 -
      breakdown.washRatio * 40 -
      breakdown.distributionRatio * 10
    ));

    // Intensity Score (0-100)
    const intensityScore = Math.min(100, Math.max(0,
      breakdown.avgDensity * 0.4 +
      breakdown.peakDensity * 0.3 +
      breakdown.volumeWeighted * 0.3
    ));

    // Consistency Score (0-100)
    const consistencyScore = Math.min(100, Math.max(0,
      breakdown.activeDaysRatio * 50 +
      breakdown.signalNoiseRatio * 30 +
      (1 - Math.min(1, breakdown.stdDevDensity / 50)) * 20
    ));

    // Risk Score (0-100) - Higher = more risky
    const riskScore = Math.min(100, Math.max(0,
      breakdown.washRatio * 50 +
      breakdown.sharpReversals * 10 +
      (breakdown.burstOnlyBehavior ? 20 : 0) +
      (breakdown.highVariance ? 15 : 0) +
      breakdown.washDetectedCount * 5
    ));

    // Influence Score (0-100)
    const influenceScore = Math.min(100, Math.max(0,
      Math.log10(breakdown.followersCount + 1) * 20 +
      consistencyScore * 0.3 +
      (1 - breakdown.frontRunRatio) * 20 +
      breakdown.avgDensity * 0.2
    ));

    return {
      behaviorScore,
      intensityScore,
      consistencyScore,
      riskScore,
      influenceScore,
    };
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  /**
   * Bulk calculate scores
   */
  async bulkCalculate(
    items: Array<{
      subjectType: ScoreSubjectType;
      subjectId: string;
      window: ScoreWindow;
      metrics: {
        bundles: Array<{ bundleType: string; intensityScore: number; confidence: number }>;
        relations: Array<{ densityScore: number; interactionCount: number }>;
        signals: Array<{ signalType: string; severityScore: number }>;
        transfers: Array<{ timestamp: Date }>;
      };
    }>
  ): Promise<number> {
    const scores: ScoreUpsertData[] = items.map(item => {
      const breakdown = this.calculateBreakdown(item.metrics);
      const calculated = this.calculateScores(breakdown);
      const compositeScore = calculateCompositeScore(
        calculated.behaviorScore,
        calculated.intensityScore,
        calculated.consistencyScore,
        calculated.riskScore,
        calculated.influenceScore
      );

      return {
        subjectType: item.subjectType,
        subjectId: item.subjectId,
        window: item.window,
        ...calculated,
        compositeScore,
        tier: getTierFromScore(compositeScore),
        breakdown,
      };
    });

    return scoresRepository.bulkUpsert(scores);
  }
}

export const scoresService = new ScoresService();
