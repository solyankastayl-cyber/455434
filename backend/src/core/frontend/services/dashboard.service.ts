/**
 * Dashboard Service - BFF layer for frontend
 * Aggregates data from TokenRankingModel + SelfLearningConfig
 * 
 * Features Redis caching with TTL for performance
 */

import { TokenRankingModel } from '../../ranking/ranking.model.js';
import { SelfLearningConfigModel } from '../../self_learning/self_learning_config.model.js';
import { cache } from '../../../infra/cache/index.js';
import type {
  DashboardResponseDTO,
  GlobalStateDTO,
  TokenItemDTO,
  PaginationDTO,
} from '../dto/dashboard.dto.js';

// Cache TTL in seconds
const DASHBOARD_CACHE_TTL = 60; // 1 minute

export class DashboardService {
  async getDashboard(page: number, limit: number): Promise<DashboardResponseDTO> {
    const cacheKey = `frontend:dashboard:${page}:${limit}`;
    
    // Use cache-aside pattern
    return cache.getOrSet(cacheKey, DASHBOARD_CACHE_TTL, async () => {
      return this.buildDashboard(page, limit);
    });
  }

  private async buildDashboard(page: number, limit: number): Promise<DashboardResponseDTO> {
    const skip = (page - 1) * limit;

    // Fetch tokens sorted by compositeScore
    const tokens = await TokenRankingModel
      .find({})
      .sort({ compositeScore: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await TokenRankingModel.countDocuments();

    // Build response
    return {
      globalState: await this.getGlobalState(),
      pagination: this.buildPagination(page, limit, total, skip + tokens.length),
      tokens: tokens.map(t => this.mapToken(t)),
    };
  }

  private async getGlobalState(): Promise<GlobalStateDTO> {
    const cfg = await SelfLearningConfigModel.findOne({}).lean();
    const hasActiveModel = !!(cfg?.activeModelPointers?.['7d']);

    return {
      mlStatus: hasActiveModel ? 'ACTIVE' : 'RULES_ONLY',
      driftLevel: (cfg?.currentDriftLevel as any) ?? 'LOW',
      confidenceMode: hasActiveModel ? 'ML' : 'RULES',
    };
  }

  private buildPagination(
    page: number,
    limit: number,
    total: number,
    current: number
  ): PaginationDTO {
    return {
      page,
      limit,
      totalTokens: total,
      hasNextPage: current < total,
    };
  }

  private mapToken(token: any): TokenItemDTO {
    return {
      symbol: token.symbol,
      name: token.name || token.symbol,
      contractAddress: token.contractAddress,
      decision: token.bucket,
      confidence: Math.round(token.engineConfidence || 0),
      badges: this.buildBadges(token),
      explanation: this.buildExplanation(token),
      priceUsd: token.priceUsd,
      change24h: token.priceChange24h,
    };
  }

  private buildBadges(token: any): string[] {
    const badges: string[] = [];

    // ML status
    if (token.mlAdjusted) badges.push('ML_ENABLED');

    // Confidence
    if (token.engineConfidence >= 70) badges.push('HIGH_CONFIDENCE');
    if (token.engineConfidence < 40) badges.push('LOW_CONFIDENCE');

    // Risk
    if (token.engineRisk >= 70) badges.push('HIGH_RISK');

    // Drift
    const drift = token.driftLevel || 'LOW';
    badges.push(`${drift}_DRIFT`);

    return badges;
  }

  private buildExplanation(token: any): string {
    const actorScore = token.actorSignalScore || 0;
    const confidence = token.engineConfidence || 0;
    const mlActive = token.mlAdjusted;

    if (actorScore > 70) {
      return mlActive
        ? 'Strong on-chain activity (ML-enhanced)'
        : 'Strong on-chain activity';
    }

    if (confidence >= 70) {
      return `High confidence ranking (${confidence}%)`;
    }

    if (actorScore > 40) {
      return 'Moderate on-chain signals detected';
    }

    return 'Standard market analysis';
  }

  /**
   * Invalidate dashboard cache (call after data updates)
   */
  async invalidateCache(): Promise<void> {
    await cache.invalidate('frontend:dashboard:*');
  }
}

export const dashboardService = new DashboardService();
