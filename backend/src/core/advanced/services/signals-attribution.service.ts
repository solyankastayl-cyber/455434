/**
 * Advanced Signals & Attribution Service
 * Aggregates signal coverage, impact, and calibration
 */

import { ActorSignalModel } from '../../signals/actor_signal.model.js';
import { TokenRankingModel } from '../../ranking/ranking.model.js';
import type { AdvancedSignalsAttributionDTO } from '../dto/signals-attribution.dto.js';

export class AdvancedSignalsAttributionService {
  async getSignalsAttribution(): Promise<AdvancedSignalsAttributionDTO> {
    const coverage = await this.getCoverage();
    const topImpactSignals = await this.getTopImpactSignals();
    const confidenceCalibration = this.getConfidenceCalibration();
    const links = await this.getLinks();

    return {
      coverage,
      topImpactSignals,
      confidenceCalibration,
      links,
    };
  }

  private async getCoverage() {
    // Get unique signal types
    const signals = await ActorSignalModel.distinct('signalType');
    const activeSignals = signals.length;

    // Total possible signal types (mock)
    const TOTAL_SIGNAL_TYPES = 10;
    const coveragePercent = Math.round((activeSignals / TOTAL_SIGNAL_TYPES) * 100);

    // Calculate conflict rate (mock)
    const conflictRate = 0.12; // 12%

    return {
      activeSignals,
      coveragePercent,
      conflictRate,
    };
  }

  private async getTopImpactSignals() {
    // Mock top impact signals
    // TODO: Get from AttributionStats when available
    return [
      {
        signalType: 'DEX_FLOW',
        direction: 'POSITIVE' as const,
        confidenceImpact: 12,
      },
      {
        signalType: 'WHALE_TX',
        direction: 'NEGATIVE' as const,
        confidenceImpact: -8,
      },
      {
        signalType: 'CORRIDOR_SPIKE',
        direction: 'POSITIVE' as const,
        confidenceImpact: 5,
      },
    ];
  }

  private getConfidenceCalibration() {
    // Mock calibration status
    // TODO: Calculate from actual decision outcomes
    const MIN_DECISIONS = 100;
    const decisionsCount = 50; // mock

    if (decisionsCount < MIN_DECISIONS) {
      return {
        status: 'INSUFFICIENT_DATA' as const,
        note: `Need ${MIN_DECISIONS - decisionsCount} more decisions for calibration`,
      };
    }

    return {
      status: 'OK' as const,
    };
  }

  private async getLinks() {
    // Get token with highest signal activity
    const token = await TokenRankingModel
      .findOne({})
      .sort({ actorSignalScore: -1 })
      .lean();

    return {
      tokenExample: token?.symbol,
    };
  }
}

export const advancedSignalsAttributionService = new AdvancedSignalsAttributionService();
