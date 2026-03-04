/**
 * Phase 5: Calibration Apply Service
 * Activates calibration maps atomically
 */
import { CalibrationRunModel } from './calibration_run.model.js';
import { CalibrationMapModel } from './calibration_map.model.js';
import { CalibrationActiveModel } from './calibration_active.model.js';
import { CalibrationAuditModel } from './calibration_audit.model.js';
import { calibrationGuardService } from './calibration_guard.service.js';

export interface ApplyCalibrationInput {
  runId: string;
  mapId: string;
  mode: 'SIMULATION' | 'PROD';
  activatedBy?: 'system' | 'admin' | 'simulation';
}

export interface ApplyCalibrationResult {
  success: boolean;
  message: string;
  window: string;
  activeMapId: string | null;
  guardResult?: any;
}

export class CalibrationApplyService {
  /**
   * Apply (activate) calibration map
   */
  async applyCalibration(input: ApplyCalibrationInput): Promise<ApplyCalibrationResult> {
    const { runId, mapId, mode, activatedBy = mode === 'SIMULATION' ? 'simulation' : 'system' } = input;

    console.log(`[CalApply] Applying calibration: run=${runId}, map=${mapId}, mode=${mode}`);

    // 1. Fetch run and map
    const run = await CalibrationRunModel.findOne({ runId });
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const map = await CalibrationMapModel.findOne({ mapId });
    if (!map) {
      throw new Error(`Map not found: ${mapId}`);
    }

    // 2. Run safety checks
    const guardResult = await calibrationGuardService.checkSafety(runId, mode);
    
    if (!guardResult.passed) {
      console.log(`[CalApply] Guard check FAILED`);
      
      // Update run status to REJECTED
      await CalibrationRunModel.updateOne(
        { runId },
        {
          $set: {
            status: 'REJECTED',
            rejectionReasons: guardResult.blockers,
          },
        }
      );

      return {
        success: false,
        message: 'Safety checks failed',
        window: run.window,
        activeMapId: null,
        guardResult,
      };
    }

    // 3. Atomic activation
    const window = run.window;
    const now = new Date();

    // Update CalibrationActive (upsert)
    await CalibrationActiveModel.findOneAndUpdate(
      { window },
      {
        $set: {
          activeMapId: mapId,
          activatedAt: now,
          activatedBy,
          status: 'ACTIVE',
          notes: `Applied ${mode} mode at ${now.toISOString()}`,
        },
      },
      { upsert: true }
    );

    // 4. Update run status to APPLIED
    await CalibrationRunModel.updateOne(
      { runId },
      { $set: { status: 'APPLIED' } }
    );

    console.log(`[CalApply] ✓ Calibration applied: ${mapId} for ${window}`);

    return {
      success: true,
      message: `Calibration applied (${mode} mode)`,
      window,
      activeMapId: mapId,
      guardResult,
    };
  }

  /**
   * Disable calibration for a window
   */
  async disableCalibration(window: '24h' | '7d', reason: string): Promise<void> {
    console.log(`[CalApply] Disabling calibration for ${window}: ${reason}`);

    await CalibrationActiveModel.findOneAndUpdate(
      { window },
      {
        $set: {
          activeMapId: null,
          status: 'DISABLED',
          notes: `Disabled: ${reason}`,
        },
      },
      { upsert: true }
    );

    console.log(`[CalApply] ✓ Calibration disabled for ${window}`);
  }

  /**
   * Get active calibration status
   */
  async getActiveStatus(window: '24h' | '7d'): Promise<any> {
    const active = await CalibrationActiveModel.findOne({ window });
    
    if (!active) {
      return {
        window,
        status: 'DISABLED',
        activeMapId: null,
      };
    }

    return {
      window,
      status: active.status,
      activeMapId: active.activeMapId,
      activatedAt: active.activatedAt,
      activatedBy: active.activatedBy,
      notes: active.notes,
    };
  }

  /**
   * Audit log - record calibration application on sample
   */
  async logCalibrationApplication(
    window: '24h' | '7d',
    sampleKey: string,
    rawConfidence: number,
    calibratedConfidence: number,
    mapId: string,
    runId: string
  ): Promise<void> {
    const adjPct = ((calibratedConfidence - rawConfidence) / rawConfidence) * 100;
    const clamped = calibratedConfidence < 0 || calibratedConfidence > 1;

    await CalibrationAuditModel.create({
      window,
      sampleKey,
      rawConfidence,
      calibratedConfidence,
      adjPct,
      clamped,
      mapId,
      runId,
    });
  }
}

export const calibrationApplyService = new CalibrationApplyService();
