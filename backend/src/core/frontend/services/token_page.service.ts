/**
 * Token Page Service - Full token details for frontend
 * 
 * Features Redis caching with TTL for performance
 */

import { TokenRankingModel } from '../../ranking/ranking.model.js';
import { ActorSignalModel } from '../../signals/actor_signal.model.js';
import { cache } from '../../../infra/cache/index.js';
import type {
  TokenPageResponseDTO,
  TokenDecisionDTO,
  TokenStatusDTO,
  PriceSnapshotDTO,
  TrendDTO,
  RiskDTO,
  SignalDTO,
} from '../dto/token.dto.js';

// Cache TTL in seconds
const TOKEN_CACHE_TTL = 90; // 1.5 minutes

export class TokenPageService {
  async getToken(symbol: string): Promise<TokenPageResponseDTO> {
    const symbolUpper = symbol.toUpperCase();
    const cacheKey = `frontend:token:${symbolUpper}`;
    
    // Use cache-aside pattern
    return cache.getOrSet(cacheKey, TOKEN_CACHE_TTL, async () => {
      return this.buildTokenPage(symbolUpper);
    });
  }

  private async buildTokenPage(symbolUpper: string): Promise<TokenPageResponseDTO> {
    // Fetch token ranking
    const token = await TokenRankingModel
      .findOne({ symbol: symbolUpper })
      .lean();

    if (!token) {
      throw new Error(`Token ${symbolUpper} not found`);
    }

    // Fetch recent signals
    const signals = await ActorSignalModel
      .find({ symbol: symbolUpper })
      .sort({ detectedAt: -1 })
      .limit(5)
      .lean();

    return {
      symbol: token.symbol,
      name: token.name || token.symbol,
      contractAddress: token.contractAddress,
      decision: this.buildDecision(token),
      status: this.buildStatus(token),
      priceSnapshot: this.buildPriceSnapshot(token),
      trend: this.buildTrend(token),
      risk: this.buildRisk(token),
      signals: signals.map(s => this.mapSignal(s)),
    };
  }

  private buildDecision(token: any): TokenDecisionDTO {
    return {
      action: token.bucket,
      confidence: Math.round(token.engineConfidence || 0),
      baseConfidence: Math.round(token.engineConfidence || 0),
    };
  }

  private buildStatus(token: any): TokenStatusDTO {
    return {
      mlActive: !!token.mlAdjusted,
      driftLevel: token.driftLevel || 'LOW',
      approvalStatus: 'APPROVED',
    };
  }

  private buildPriceSnapshot(token: any): PriceSnapshotDTO {
    return {
      priceUsd: token.priceUsd || 0,
      change24h: token.priceChange24h || 0,
      volume24h: token.volume24h || 0,
      marketCap: token.marketCap,
    };
  }

  private buildTrend(token: any): TrendDTO {
    const change = token.priceChange24h || 0;
    const absChange = Math.abs(change);

    if (absChange < 2) {
      return { label: 'NOISE', horizon: '7d', confidence: 50 };
    }

    if (change > 10) {
      return { label: 'TREND_UP', horizon: '7d', confidence: 90 };
    }

    if (change < -10) {
      return { label: 'TREND_DOWN', horizon: '7d', confidence: 90 };
    }

    return { label: 'SIDEWAYS', horizon: '7d', confidence: 60 };
  }

  private buildRisk(token: any): RiskDTO {
    const risk = token.engineRisk || 0;
    const level = risk >= 70 ? 'HIGH' : risk >= 40 ? 'MEDIUM' : 'LOW';

    return {
      score: Math.round(risk),
      level,
      drawdown7d: token.drawdown7d || 0,
    };
  }

  private mapSignal(signal: any): SignalDTO {
    return {
      signalType: signal.signalType,
      direction: signal.direction || 'NEUTRAL',
      detectedAt: signal.detectedAt,
      note: signal.note,
    };
  }

  /**
   * Invalidate token cache (call after data updates)
   */
  async invalidateCache(symbol?: string): Promise<void> {
    if (symbol) {
      await cache.del(`frontend:token:${symbol.toUpperCase()}`);
    } else {
      await cache.invalidate('frontend:token:*');
    }
  }
}

export const tokenPageService = new TokenPageService();
