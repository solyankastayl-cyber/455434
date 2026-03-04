/**
 * Advanced System Overview Service
 * Aggregates system state, product impact, and critical events
 */

import { SelfLearningConfigModel } from '../../self_learning/self_learning_config.model.js';
import { TokenRankingModel } from '../../ranking/ranking.model.js';
import type {
  AdvancedSystemOverviewDTO,
  MLMode,
  DriftLevel,
  SafetyStatus,
  RollbackStatus,
} from '../dto/system-overview.dto.js';

export class AdvancedSystemOverviewService {
  async getSystemOverview(): Promise<AdvancedSystemOverviewDTO> {
    const config = await SelfLearningConfigModel.findOne({}).lean();
    
    const mlMode = this.getMLMode(config);
    const driftLevel = this.getDriftLevel(config);
    const safety = this.getSafetyStatus(driftLevel);
    const autoRollback = this.getRollbackStatus();

    const productImpact = await this.getProductImpact(mlMode, driftLevel);
    const recentCriticalEvents = await this.getCriticalEvents();

    return {
      systemState: {
        mlMode,
        driftLevel,
        safety,
        autoRollback,
      },
      productImpact,
      recentCriticalEvents,
    };
  }

  private getMLMode(config: any): MLMode {
    if (!config?.selfLearningEnabled) return 'RULES_ONLY';
    if (config.activeModelPointers?.['7d']) return 'ACTIVE';
    return 'SHADOW';
  }

  private getDriftLevel(config: any): DriftLevel {
    return (config?.currentDriftLevel as DriftLevel) || 'LOW';
  }

  private getSafetyStatus(driftLevel: DriftLevel): SafetyStatus {
    return driftLevel === 'HIGH' || driftLevel === 'CRITICAL' ? 'DEGRADED' : 'SAFE';
  }

  private getRollbackStatus(): RollbackStatus {
    // TODO: Check AuditLog for recent rollbacks
    return 'ARMED';
  }

  private async getProductImpact(mlMode: MLMode, driftLevel: DriftLevel) {
    const mlAffectsConfidence = mlMode === 'ACTIVE';
    const confidenceCapActive = driftLevel !== 'LOW';

    if (!mlAffectsConfidence) {
      return {
        mlAffectsConfidence: false,
        confidenceCapActive,
      };
    }

    // Get tokens with ML adjustments
    const tokens = await TokenRankingModel.find({ mlAdjusted: true }).lean();
    const tokensAffected = tokens.length;

    // Calculate avg ML modifier (mock for now)
    const avgMlModifier = 0.83;

    return {
      mlAffectsConfidence: true,
      avgMlModifier,
      tokensAffected,
      confidenceCapActive,
    };
  }

  private async getCriticalEvents() {
    // TODO: Query AuditLog for recent critical events
    // For now, return empty
    return [];
  }
}

export const advancedSystemOverviewService = new AdvancedSystemOverviewService();
