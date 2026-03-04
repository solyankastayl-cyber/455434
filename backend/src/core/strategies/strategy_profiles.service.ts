/**
 * Strategy Profiles Service
 * Classification logic for trading strategies
 */
import { 
  strategyProfilesRepository, 
  StrategyProfileUpsertData 
} from './strategy_profiles.repository.js';
import {
  IStrategyProfile,
  StrategyType,
  RiskLevel,
  InfluenceLevel,
  getRiskLevel,
  getInfluenceLevel,
  STRATEGY_DISPLAY_NAMES,
  STRATEGY_DESCRIPTIONS,
} from './strategy_profiles.model.js';
import type { StrategySortEnum } from './strategy_profiles.schema.js';

// Classification thresholds
const THRESHOLDS = {
  // Accumulation Sniper
  ACCUMULATION_RATIO_HIGH: 0.6,
  HOLDING_TIME_LONG: 72, // hours
  WASH_RATIO_LOW: 0.15,
  CONSISTENCY_HIGH: 55,

  // Distribution Whale
  DISTRIBUTION_RATIO_HIGH: 0.6,
  INFLUENCE_HIGH: 55,

  // Momentum Rider
  INTENSITY_SPIKES_HIGH: 3,
  HOLDING_TIME_SHORT: 24, // hours

  // Rotation Trader
  ROTATION_RATIO_HIGH: 0.4,
  PREFERRED_ASSETS_MIN: 3,

  // Wash Operator
  WASH_RATIO_HIGH: 0.3,

  // Liquidity Farmer
  FLOW_RATIO_HIGH: 0.5,
  STABILITY_HIGH: 0.6,

  // Mixed threshold
  DOMINANT_RATIO: 0.5,
};

/**
 * Format strategy profile for API
 */
export function formatStrategyProfile(profile: IStrategyProfile) {
  return {
    id: profile._id.toString(),
    address: profile.address,
    chain: profile.chain,
    strategyType: profile.strategyType,
    strategyName: STRATEGY_DISPLAY_NAMES[profile.strategyType],
    strategyDescription: STRATEGY_DESCRIPTIONS[profile.strategyType],
    secondaryStrategy: profile.secondaryStrategy,
    confidence: Math.round(profile.confidence * 100) / 100,
    stability: Math.round(profile.stability * 100) / 100,
    riskLevel: profile.riskLevel,
    influenceLevel: profile.influenceLevel,
    avgHoldingTimeHours: Math.round(profile.avgHoldingTimeHours),
    preferredWindow: profile.preferredWindow,
    preferredAssets: profile.preferredAssets,
    performanceProxy: profile.performanceProxy,
    bundleBreakdown: profile.bundleBreakdown,
    previousStrategy: profile.previousStrategy,
    strategyChangesLast30d: profile.strategyChangesLast30d,
    detectedAt: profile.detectedAt.toISOString(),
  };
}

/**
 * Classification input data
 */
export interface ClassificationInput {
  // From bundles
  accumulationRatio: number;
  distributionRatio: number;
  rotationRatio: number;
  washRatio: number;
  flowRatio: number;
  
  // From scores
  consistencyScore: number;
  intensityScore: number;
  behaviorScore: number;
  riskScore: number;
  influenceScore: number;
  avgDensity: number;
  
  // From signals
  intensitySpikeCount: number;
  
  // From transfers/relations
  avgHoldingTimeHours: number;
  preferredAssets: string[];
  
  // Previous state
  previousStrategy?: StrategyType | null;
  strategyChangesLast30d?: number;
}

/**
 * Strategy Profiles Service
 */
export class StrategyProfilesService {
  /**
   * Get profile by address
   */
  async getByAddress(
    address: string,
    chain: string = 'ethereum'
  ): Promise<IStrategyProfile | null> {
    return strategyProfilesRepository.findByAddress(address, chain);
  }

  /**
   * Get top profiles
   */
  async getTop(options: {
    type?: StrategyType;
    riskLevel?: RiskLevel;
    influenceLevel?: InfluenceLevel;
    minConfidence?: number;
    sort?: StrategySortEnum;
    limit?: number;
    offset?: number;
    chain?: string;
  }): Promise<{ profiles: IStrategyProfile[]; total: number }> {
    const profiles = await strategyProfilesRepository.findTop({
      strategyType: options.type,
      ...options,
    });
    return { profiles, total: profiles.length };
  }

  /**
   * Get profiles by strategy type
   */
  async getByStrategyType(
    strategyType: StrategyType,
    options: { limit?: number; minConfidence?: number; chain?: string } = {}
  ): Promise<IStrategyProfile[]> {
    return strategyProfilesRepository.findByStrategyType(strategyType, options);
  }

  /**
   * Get stats
   */
  async getStats(chain: string = 'ethereum'): Promise<{
    totalProfiles: number;
    byStrategy: Record<string, { count: number; name: string }>;
    byRiskLevel: Record<string, number>;
    byInfluenceLevel: Record<string, number>;
    avgConfidence: number;
    avgStability: number;
  }> {
    const stats = await strategyProfilesRepository.getStats(chain);
    
    // Enhance byStrategy with names
    const byStrategy: Record<string, { count: number; name: string }> = {};
    for (const [type, count] of Object.entries(stats.byStrategy)) {
      byStrategy[type] = {
        count,
        name: STRATEGY_DISPLAY_NAMES[type as StrategyType] || type,
      };
    }

    return {
      ...stats,
      byStrategy,
      avgConfidence: Math.round(stats.avgConfidence * 100) / 100,
      avgStability: Math.round(stats.avgStability * 100) / 100,
    };
  }

  /**
   * Classify strategy for an address
   */
  classifyStrategy(input: ClassificationInput): {
    strategyType: StrategyType;
    secondaryStrategy: StrategyType | null;
    confidence: number;
    stability: number;
  } {
    const scores: Record<StrategyType, number> = {
      'accumulation_sniper': 0,
      'distribution_whale': 0,
      'momentum_rider': 0,
      'rotation_trader': 0,
      'wash_operator': 0,
      'liquidity_farmer': 0,
      'mixed': 0,
    };

    // ========== ACCUMULATION SNIPER ==========
    if (input.accumulationRatio >= THRESHOLDS.ACCUMULATION_RATIO_HIGH) {
      scores['accumulation_sniper'] += 0.4;
    }
    if (input.avgHoldingTimeHours >= THRESHOLDS.HOLDING_TIME_LONG) {
      scores['accumulation_sniper'] += 0.25;
    }
    if (input.washRatio < THRESHOLDS.WASH_RATIO_LOW) {
      scores['accumulation_sniper'] += 0.2;
    }
    if (input.consistencyScore >= THRESHOLDS.CONSISTENCY_HIGH) {
      scores['accumulation_sniper'] += 0.15;
    }

    // ========== DISTRIBUTION WHALE ==========
    if (input.distributionRatio >= THRESHOLDS.DISTRIBUTION_RATIO_HIGH) {
      scores['distribution_whale'] += 0.5;
    }
    if (input.influenceScore >= THRESHOLDS.INFLUENCE_HIGH) {
      scores['distribution_whale'] += 0.3;
    }
    if (input.avgDensity > 30) {
      scores['distribution_whale'] += 0.2;
    }

    // ========== MOMENTUM RIDER ==========
    if (input.intensitySpikeCount >= THRESHOLDS.INTENSITY_SPIKES_HIGH) {
      scores['momentum_rider'] += 0.4;
    }
    if (input.avgHoldingTimeHours <= THRESHOLDS.HOLDING_TIME_SHORT) {
      scores['momentum_rider'] += 0.35;
    }
    if (input.intensityScore >= 60) {
      scores['momentum_rider'] += 0.25;
    }

    // ========== ROTATION TRADER ==========
    if (input.rotationRatio >= THRESHOLDS.ROTATION_RATIO_HIGH) {
      scores['rotation_trader'] += 0.5;
    }
    if (input.preferredAssets.length >= THRESHOLDS.PREFERRED_ASSETS_MIN) {
      scores['rotation_trader'] += 0.3;
    }
    if (input.consistencyScore >= 50) {
      scores['rotation_trader'] += 0.2;
    }

    // ========== WASH OPERATOR ==========
    if (input.washRatio >= THRESHOLDS.WASH_RATIO_HIGH) {
      scores['wash_operator'] += 0.6;
    }
    if (input.riskScore >= 50) {
      scores['wash_operator'] += 0.25;
    }
    if (input.behaviorScore < 40) {
      scores['wash_operator'] += 0.15;
    }

    // ========== LIQUIDITY FARMER ==========
    if (input.flowRatio >= THRESHOLDS.FLOW_RATIO_HIGH) {
      scores['liquidity_farmer'] += 0.4;
    }
    if (input.consistencyScore >= 60) {
      scores['liquidity_farmer'] += 0.35;
    }
    if (input.washRatio < 0.1 && input.riskScore < 30) {
      scores['liquidity_farmer'] += 0.25;
    }

    // Find primary and secondary strategies
    const sortedStrategies = Object.entries(scores)
      .filter(([key]) => key !== 'mixed')
      .sort((a, b) => b[1] - a[1]);

    const [primaryType, primaryScore] = sortedStrategies[0];
    const [secondaryType, secondaryScore] = sortedStrategies[1];

    // Check if dominant strategy exists
    let strategyType: StrategyType;
    let secondaryStrategy: StrategyType | null = null;

    if (primaryScore >= THRESHOLDS.DOMINANT_RATIO) {
      strategyType = primaryType as StrategyType;
      if (secondaryScore >= 0.3) {
        secondaryStrategy = secondaryType as StrategyType;
      }
    } else {
      strategyType = 'mixed';
      if (primaryScore >= 0.3) {
        secondaryStrategy = primaryType as StrategyType;
      }
    }

    // Calculate confidence
    const confidence = this.calculateConfidence(input, primaryScore);

    // Calculate stability
    const stability = this.calculateStability(
      input.strategyChangesLast30d || 0,
      input.consistencyScore
    );

    return {
      strategyType,
      secondaryStrategy,
      confidence,
      stability,
    };
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    input: ClassificationInput,
    primaryScore: number
  ): number {
    // Base from classification score
    let confidence = primaryScore * 0.4;

    // Add consistency factor
    confidence += (input.consistencyScore / 100) * 0.3;

    // Subtract wash ratio penalty
    confidence -= input.washRatio * 0.2;

    // Add if not mixed
    if (primaryScore >= THRESHOLDS.DOMINANT_RATIO) {
      confidence += 0.1;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Calculate stability score
   */
  private calculateStability(
    strategyChangesLast30d: number,
    consistencyScore: number
  ): number {
    // Max 4 windows in 30d
    const changeRatio = Math.min(1, strategyChangesLast30d / 4);
    
    const stability = 
      (1 - changeRatio) * 0.6 +
      (consistencyScore / 100) * 0.4;

    return Math.max(0, Math.min(1, stability));
  }

  /**
   * Calculate and save strategy profile
   */
  async calculateAndSave(
    address: string,
    input: ClassificationInput,
    chain: string = 'ethereum'
  ): Promise<IStrategyProfile> {
    const classification = this.classifyStrategy(input);

    // Check if strategy changed
    let previousStrategy = input.previousStrategy || null;
    let strategyChanges = input.strategyChangesLast30d || 0;

    const existing = await this.getByAddress(address, chain);
    if (existing && existing.strategyType !== classification.strategyType) {
      previousStrategy = existing.strategyType;
      strategyChanges = (existing.strategyChangesLast30d || 0) + 1;
    }

    // Determine preferred window based on holding time
    let preferredWindow: '1d' | '7d' | '30d' = '7d';
    if (input.avgHoldingTimeHours < 24) {
      preferredWindow = '1d';
    } else if (input.avgHoldingTimeHours > 168) {
      preferredWindow = '30d';
    }

    const data: StrategyProfileUpsertData = {
      address,
      chain,
      strategyType: classification.strategyType,
      secondaryStrategy: classification.secondaryStrategy,
      confidence: classification.confidence,
      stability: classification.stability,
      riskLevel: getRiskLevel(input.riskScore),
      influenceLevel: getInfluenceLevel(input.influenceScore),
      avgHoldingTimeHours: input.avgHoldingTimeHours,
      preferredWindow,
      preferredAssets: input.preferredAssets.slice(0, 5),
      performanceProxy: {
        consistencyScore: input.consistencyScore,
        intensityScore: input.intensityScore,
        behaviorScore: input.behaviorScore,
        washRatio: input.washRatio,
        avgDensity: input.avgDensity,
      },
      bundleBreakdown: {
        accumulationRatio: input.accumulationRatio,
        distributionRatio: input.distributionRatio,
        rotationRatio: input.rotationRatio,
        washRatio: input.washRatio,
        flowRatio: input.flowRatio,
      },
      previousStrategy,
      strategyChangesLast30d: strategyChanges,
    };

    return strategyProfilesRepository.upsert(data);
  }

  /**
   * Bulk calculate and save
   */
  async bulkCalculate(
    items: Array<{
      address: string;
      input: ClassificationInput;
      chain?: string;
    }>
  ): Promise<{ updated: number; strategyShifts: number }> {
    const profiles: StrategyProfileUpsertData[] = [];
    let strategyShifts = 0;

    for (const item of items) {
      const classification = this.classifyStrategy(item.input);
      
      // Check for strategy shift
      if (
        item.input.previousStrategy &&
        item.input.previousStrategy !== classification.strategyType
      ) {
        strategyShifts++;
      }

      let preferredWindow: '1d' | '7d' | '30d' = '7d';
      if (item.input.avgHoldingTimeHours < 24) {
        preferredWindow = '1d';
      } else if (item.input.avgHoldingTimeHours > 168) {
        preferredWindow = '30d';
      }

      profiles.push({
        address: item.address,
        chain: item.chain || 'ethereum',
        strategyType: classification.strategyType,
        secondaryStrategy: classification.secondaryStrategy,
        confidence: classification.confidence,
        stability: classification.stability,
        riskLevel: getRiskLevel(item.input.riskScore),
        influenceLevel: getInfluenceLevel(item.input.influenceScore),
        avgHoldingTimeHours: item.input.avgHoldingTimeHours,
        preferredWindow,
        preferredAssets: item.input.preferredAssets.slice(0, 5),
        performanceProxy: {
          consistencyScore: item.input.consistencyScore,
          intensityScore: item.input.intensityScore,
          behaviorScore: item.input.behaviorScore,
          washRatio: item.input.washRatio,
          avgDensity: item.input.avgDensity,
        },
        bundleBreakdown: {
          accumulationRatio: item.input.accumulationRatio,
          distributionRatio: item.input.distributionRatio,
          rotationRatio: item.input.rotationRatio,
          washRatio: item.input.washRatio,
          flowRatio: item.input.flowRatio,
        },
        previousStrategy: item.input.previousStrategy || null,
        strategyChangesLast30d: item.input.strategyChangesLast30d || 0,
      });
    }

    const updated = await strategyProfilesRepository.bulkUpsert(profiles);
    return { updated, strategyShifts };
  }
}

export const strategyProfilesService = new StrategyProfilesService();
