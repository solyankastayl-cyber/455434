/**
 * Phase 6: ML Mode Service
 * Handles mode switching with safety checks
 * 
 * INTEGRATED with Alerts V2 for system notifications
 */
import { v4 as uuidv4 } from 'uuid';
import { ModeStateModel } from './mode_state.model.js';
import { ModeAuditModel } from './mode_audit.model.js';
import { KillSwitchEventModel } from './kill_switch_events.model.js';
import { systemAlertService } from '../system_alerts/system_alert.service.js';

// Thresholds for auto-kill
const KILL_THRESHOLDS = {
  FLIP_RATE: 0.07,  // 7%
  ECE: 0.15,
};

export type MLMode = 'OFF' | 'ADVISOR' | 'ASSIST';

export interface ModeState {
  mode: MLMode;
  killSwitch: {
    status: 'ARMED' | 'TRIGGERED';
    triggeredAt?: Date;
    triggeredBy?: string;
    reason?: string;
  };
  modeChangedAt: Date;
  modeChangedBy: string;
  lastHealthCheck?: {
    flipRate: number;
    ece: number;
    checkedAt: Date;
    gatesPassed: boolean;
  };
}

class ModeService {
  /**
   * Get or initialize mode state (singleton)
   */
  async getState(): Promise<ModeState> {
    let state = await ModeStateModel.findOne({ key: 'ml_mode_state' });
    
    if (!state) {
      state = await ModeStateModel.create({
        key: 'ml_mode_state',
        mode: 'OFF',
        killSwitch: { status: 'ARMED' },
        modeChangedAt: new Date(),
        modeChangedBy: 'system',
      });
    }
    
    return {
      mode: state.mode as MLMode,
      killSwitch: {
        status: state.killSwitch.status as 'ARMED' | 'TRIGGERED',
        triggeredAt: state.killSwitch.triggeredAt,
        triggeredBy: state.killSwitch.triggeredBy,
        reason: state.killSwitch.reason,
      },
      modeChangedAt: state.modeChangedAt,
      modeChangedBy: state.modeChangedBy,
      lastHealthCheck: state.lastHealthCheck ? {
        flipRate: state.lastHealthCheck.flipRate,
        ece: state.lastHealthCheck.ece,
        checkedAt: state.lastHealthCheck.checkedAt,
        gatesPassed: state.lastHealthCheck.gatesPassed,
      } : undefined,
    };
  }

  /**
   * Set ML mode with safety checks
   */
  async setMode(
    targetMode: MLMode, 
    triggeredBy: string = 'user',
    skipGateCheck: boolean = false
  ): Promise<{ success: boolean; mode: MLMode; blocked?: boolean; reason?: string }> {
    const currentState = await this.getState();
    
    // If kill switch is triggered, only OFF is allowed
    if (currentState.killSwitch.status === 'TRIGGERED' && targetMode !== 'OFF') {
      return {
        success: false,
        mode: currentState.mode,
        blocked: true,
        reason: 'Kill switch is TRIGGERED. Only OFF mode is allowed.',
      };
    }
    
    // ASSIST requires gates to pass
    if (targetMode === 'ASSIST' && !skipGateCheck) {
      const gatesResult = await this.checkGates();
      if (!gatesResult.passed) {
        return {
          success: false,
          mode: currentState.mode,
          blocked: true,
          reason: `ASSIST mode requires all gates to pass. Failed: ${gatesResult.failedGates.join(', ')}`,
        };
      }
    }
    
    // Update mode
    await ModeStateModel.updateOne(
      { key: 'ml_mode_state' },
      {
        $set: {
          mode: targetMode,
          modeChangedAt: new Date(),
          modeChangedBy: triggeredBy,
          updatedAt: new Date(),
        }
      },
      { upsert: true }
    );
    
    // Audit log
    await ModeAuditModel.create({
      auditId: uuidv4(),
      action: 'MODE_CHANGE',
      fromMode: currentState.mode,
      toMode: targetMode,
      triggeredBy,
      reason: `Mode change: ${currentState.mode} → ${targetMode}`,
      metrics: currentState.lastHealthCheck ? {
        flipRate: currentState.lastHealthCheck.flipRate,
        ece: currentState.lastHealthCheck.ece,
        gatesPassed: currentState.lastHealthCheck.gatesPassed,
      } : {},
      timestamp: new Date(),
    });
    
    // Alerts V2: Create system alert for mode change
    try {
      await systemAlertService.onMLModeChange({
        fromMode: currentState.mode,
        toMode: targetMode,
        triggeredBy,
      });
    } catch (err) {
      console.error('[Phase6] Failed to create mode change alert:', err);
    }
    
    console.log(`[Phase6] Mode changed: ${currentState.mode} → ${targetMode} by ${triggeredBy}`);
    
    return {
      success: true,
      mode: targetMode,
    };
  }

  /**
   * Trigger kill switch - immediately sets mode to OFF
   */
  async triggerKillSwitch(
    trigger: { type: string; value?: any; threshold?: any },
    triggeredBy: string = 'system'
  ): Promise<{ success: boolean; reason: string }> {
    const currentState = await this.getState();
    
    // Update state
    await ModeStateModel.updateOne(
      { key: 'ml_mode_state' },
      {
        $set: {
          mode: 'OFF',
          'killSwitch.status': 'TRIGGERED',
          'killSwitch.triggeredAt': new Date(),
          'killSwitch.triggeredBy': triggeredBy,
          'killSwitch.reason': trigger.type,
          modeChangedAt: new Date(),
          modeChangedBy: triggeredBy,
          updatedAt: new Date(),
        }
      },
      { upsert: true }
    );
    
    // Kill switch event
    await KillSwitchEventModel.create({
      eventId: uuidv4(),
      eventType: triggeredBy === 'user' || triggeredBy === 'manual' ? 'MANUAL_OFF' : 'AUTO_OFF',
      trigger,
      modeBefore: currentState.mode,
      modeAfter: 'OFF',
      triggeredBy,
      context: {
        flipRate: currentState.lastHealthCheck?.flipRate,
        ece: currentState.lastHealthCheck?.ece,
      },
      timestamp: new Date(),
    });
    
    // Audit log
    await ModeAuditModel.create({
      auditId: uuidv4(),
      action: 'KILL_SWITCH_TRIGGER',
      fromMode: currentState.mode,
      toMode: 'OFF',
      triggeredBy,
      reason: `Kill switch triggered: ${trigger.type}`,
      timestamp: new Date(),
    });
    
    // Alerts V2: Create CRITICAL system alert for kill switch
    try {
      await systemAlertService.onMLKillSwitch({
        reason: trigger.type,
        triggeredBy,
        flipRate: currentState.lastHealthCheck?.flipRate,
        ece: currentState.lastHealthCheck?.ece,
      });
    } catch (err) {
      console.error('[Phase6] Failed to create kill switch alert:', err);
    }
    
    console.log(`[Phase6] KILL SWITCH TRIGGERED by ${triggeredBy}: ${trigger.type}`);
    
    return {
      success: true,
      reason: `Kill switch triggered: ${trigger.type}`,
    };
  }

  /**
   * Reset kill switch (re-arm)
   */
  async resetKillSwitch(triggeredBy: string = 'user'): Promise<{ success: boolean }> {
    const currentState = await this.getState();
    
    await ModeStateModel.updateOne(
      { key: 'ml_mode_state' },
      {
        $set: {
          'killSwitch.status': 'ARMED',
          'killSwitch.triggeredAt': null,
          'killSwitch.triggeredBy': null,
          'killSwitch.reason': null,
          updatedAt: new Date(),
        }
      }
    );
    
    // Kill switch event
    await KillSwitchEventModel.create({
      eventId: uuidv4(),
      eventType: 'RESET',
      trigger: { type: 'MANUAL' },
      modeBefore: currentState.mode,
      modeAfter: currentState.mode,
      triggeredBy,
      timestamp: new Date(),
    });
    
    // Audit log
    await ModeAuditModel.create({
      auditId: uuidv4(),
      action: 'KILL_SWITCH_RESET',
      fromMode: currentState.mode,
      toMode: currentState.mode,
      triggeredBy,
      reason: 'Kill switch reset (re-armed)',
      timestamp: new Date(),
    });
    
    // Alerts V2: Create system alert for kill switch reset
    try {
      await systemAlertService.onMLKillReset({ triggeredBy });
    } catch (err) {
      console.error('[Phase6] Failed to create kill reset alert:', err);
    }
    
    console.log(`[Phase6] Kill switch RESET by ${triggeredBy}`);
    
    return { success: true };
  }

  /**
   * Check safety metrics and auto-trigger kill switch if needed
   */
  async healthCheck(metrics: { flipRate: number; ece: number }): Promise<{
    healthy: boolean;
    killTriggered: boolean;
    triggers: string[];
  }> {
    const triggers: string[] = [];
    
    // Check flip rate
    if (metrics.flipRate > KILL_THRESHOLDS.FLIP_RATE) {
      triggers.push(`FLIP_RATE: ${(metrics.flipRate * 100).toFixed(1)}% > ${KILL_THRESHOLDS.FLIP_RATE * 100}%`);
    }
    
    // Check ECE
    if (metrics.ece > KILL_THRESHOLDS.ECE) {
      triggers.push(`ECE: ${metrics.ece.toFixed(3)} > ${KILL_THRESHOLDS.ECE}`);
    }
    
    // Update health check in state
    const gatesResult = await this.checkGates();
    
    await ModeStateModel.updateOne(
      { key: 'ml_mode_state' },
      {
        $set: {
          'lastHealthCheck.flipRate': metrics.flipRate,
          'lastHealthCheck.ece': metrics.ece,
          'lastHealthCheck.checkedAt': new Date(),
          'lastHealthCheck.gatesPassed': gatesResult.passed,
          updatedAt: new Date(),
        }
      }
    );
    
    // Auto-trigger kill switch if thresholds exceeded
    if (triggers.length > 0) {
      await this.triggerKillSwitch({
        type: triggers.join(', '),
        value: metrics,
        threshold: KILL_THRESHOLDS,
      }, 'auto_health_check');
      
      return {
        healthy: false,
        killTriggered: true,
        triggers,
      };
    }
    
    return {
      healthy: true,
      killTriggered: false,
      triggers: [],
    };
  }

  /**
   * Check if gates pass for ASSIST mode
   */
  async checkGates(): Promise<{ passed: boolean; failedGates: string[] }> {
    const failedGates: string[] = [];
    
    // TODO: Integrate with actual gate checks from ml_shadow_phase4
    // For now, basic checks
    
    const state = await this.getState();
    
    // Gate 1: Kill switch must be ARMED
    if (state.killSwitch.status === 'TRIGGERED') {
      failedGates.push('KILL_SWITCH_TRIGGERED');
    }
    
    // Gate 2: Recent health check must pass
    if (state.lastHealthCheck) {
      if (state.lastHealthCheck.flipRate > KILL_THRESHOLDS.FLIP_RATE) {
        failedGates.push('FLIP_RATE_HIGH');
      }
      if (state.lastHealthCheck.ece > KILL_THRESHOLDS.ECE) {
        failedGates.push('ECE_HIGH');
      }
    }
    
    return {
      passed: failedGates.length === 0,
      failedGates,
    };
  }

  /**
   * Get mode audit history
   */
  async getAuditHistory(limit: number = 50): Promise<any[]> {
    const audits = await ModeAuditModel
      .find()
      .sort({ timestamp: -1 })
      .limit(limit);
    
    return audits;
  }

  /**
   * Get kill switch events
   */
  async getKillSwitchEvents(limit: number = 20): Promise<any[]> {
    const events = await KillSwitchEventModel
      .find()
      .sort({ timestamp: -1 })
      .limit(limit);
    
    return events;
  }
}

export const modeService = new ModeService();
