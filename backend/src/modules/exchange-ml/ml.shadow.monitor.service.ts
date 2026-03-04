/**
 * ML Shadow Monitor Service
 * 
 * Monitors ML health and triggers auto-rollback if needed.
 * 
 * RULES:
 * - If CRITICAL streak >= 3, auto-rollback
 * - ECE thresholds: HEALTHY <=0.20, DEGRADED <=0.30, CRITICAL >0.30
 */

import { mlPromotionService } from './ml.promotion.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ShadowMetrics {
  ece: number;           // Expected Calibration Error
  brier: number;         // Brier score
  divergence: number;    // Disagreement rate with Meta-Brain
  accuracy?: number;
}

export type HealthState = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export interface MonitorState {
  lastEvaluation: number | null;
  health: HealthState;
  criticalStreak: number;
  metrics: ShadowMetrics | null;
  autoRollbackEnabled: boolean;
}

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS
// ═══════════════════════════════════════════════════════════════

const THRESHOLDS = {
  ECE_HEALTHY: 0.20,
  ECE_DEGRADED: 0.30,
  CRITICAL_STREAK_ROLLBACK: 3,
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let monitorState: MonitorState = {
  lastEvaluation: null,
  health: 'HEALTHY',
  criticalStreak: 0,
  metrics: null,
  autoRollbackEnabled: true,
};

// ═══════════════════════════════════════════════════════════════
// SHADOW MONITOR SERVICE
// ═══════════════════════════════════════════════════════════════

export class MlShadowMonitorService {
  
  /**
   * Evaluate metrics and maybe trigger rollback
   */
  async evaluateAndMaybeRollback(metrics: ShadowMetrics): Promise<{
    health: HealthState;
    criticalStreak: number;
    rolledBack: boolean;
    reason?: string;
  }> {
    const promotionState = await mlPromotionService.getState();
    
    // Determine health from ECE
    const ece = metrics.ece;
    let health: HealthState;
    
    if (ece <= THRESHOLDS.ECE_HEALTHY) {
      health = 'HEALTHY';
    } else if (ece <= THRESHOLDS.ECE_DEGRADED) {
      health = 'DEGRADED';
    } else {
      health = 'CRITICAL';
    }
    
    // Update streak
    if (health === 'CRITICAL') {
      monitorState.criticalStreak += 1;
    } else {
      monitorState.criticalStreak = 0;
    }
    
    // Update state
    monitorState = {
      ...monitorState,
      lastEvaluation: Date.now(),
      health,
      metrics,
    };
    
    console.log(`[MLOps Monitor] Health: ${health}, ECE: ${ece.toFixed(3)}, Streak: ${monitorState.criticalStreak}`);
    
    // Check auto-rollback
    let rolledBack = false;
    let reason: string | undefined;
    
    if (
      monitorState.autoRollbackEnabled &&
      promotionState.mode === 'ACTIVE_SAFE' &&
      monitorState.criticalStreak >= THRESHOLDS.CRITICAL_STREAK_ROLLBACK
    ) {
      reason = `AUTO_ROLLBACK: CRITICAL_STREAK_${monitorState.criticalStreak}, ECE=${ece.toFixed(3)}`;
      await mlPromotionService.rollback(reason, 'shadow_monitor');
      rolledBack = true;
      monitorState.criticalStreak = 0;
      
      console.log(`[MLOps Monitor] Auto-rollback triggered: ${reason}`);
    }
    
    return {
      health,
      criticalStreak: monitorState.criticalStreak,
      rolledBack,
      reason,
    };
  }
  
  /**
   * Get current monitor state
   */
  getState(): MonitorState {
    return { ...monitorState };
  }
  
  /**
   * Enable/disable auto-rollback
   */
  setAutoRollback(enabled: boolean): void {
    monitorState.autoRollbackEnabled = enabled;
    console.log(`[MLOps Monitor] Auto-rollback ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Reset monitor state
   */
  reset(): void {
    monitorState = {
      lastEvaluation: null,
      health: 'HEALTHY',
      criticalStreak: 0,
      metrics: null,
      autoRollbackEnabled: true,
    };
    console.log('[MLOps Monitor] State reset');
  }
}

// Singleton
export const mlShadowMonitorService = new MlShadowMonitorService();

console.log('[MLOps] Shadow monitor service loaded');
