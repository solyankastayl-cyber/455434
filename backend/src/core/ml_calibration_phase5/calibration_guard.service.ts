/**
 * Phase 5: Calibration Guard Service
 * Checks if calibration map is safe to apply
 */
import { CalibrationRunModel } from './calibration_run.model.js';
import { CalibrationMapModel } from './calibration_map.model.js';
import { MLShadowAlertModel } from '../ml_shadow_phase4/ml_shadow_alert.model.js';
import { MLReadinessGateModel } from '../ml_shadow_phase4/ml_readiness_gate.model.js';

export interface GuardCheckResult {
  passed: boolean;
  checks: {
    name: string;
    passed: boolean;
    reason?: string;
    value?: any;
  }[];
  blockers: string[];
  warnings: string[];
}

export class CalibrationGuardService {
  /**
   * Check if calibration map is safe to apply
   */
  async checkSafety(runId: string, mode: 'SIMULATION' | 'PROD'): Promise<GuardCheckResult> {
    console.log(`[CalGuard] Checking safety for run=${runId}, mode=${mode}`);

    const run = await CalibrationRunModel.findOne({ runId });
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const map = await CalibrationMapModel.findOne({ mapId: run.artifactsRef.mapId });
    if (!map) {
      throw new Error(`Map not found for run: ${runId}`);
    }

    const checks: GuardCheckResult['checks'] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];

    // 1. ECE Improvement Check
    const eceCheck = this.checkECEImprovement(run);
    checks.push(eceCheck);
    if (!eceCheck.passed) {
      blockers.push(eceCheck.reason || 'ECE regression detected');
    }

    // 2. Clamp Rate Check
    const clampCheck = this.checkClampRate(run);
    checks.push(clampCheck);
    if (!clampCheck.passed) {
      blockers.push(clampCheck.reason || 'Clamp rate too high');
    }

    // 3. Max Adjustment Check
    const maxAdjCheck = this.checkMaxAdjustment(run);
    checks.push(maxAdjCheck);
    if (!maxAdjCheck.passed) {
      blockers.push(maxAdjCheck.reason || 'Adjustment exceeds limit');
    }

    // 4. Min Bin Count Check
    const binCountCheck = this.checkMinBinCount(map);
    checks.push(binCountCheck);
    if (!binCountCheck.passed) {
      warnings.push(binCountCheck.reason || 'Some bins have insufficient samples');
    }

    // 5. Active Alerts Check
    const alertsCheck = await this.checkActiveAlerts(run.window);
    checks.push(alertsCheck);
    if (!alertsCheck.passed && mode === 'PROD') {
      blockers.push(alertsCheck.reason || 'Critical alerts active');
    }

    // 6. Stability Gate Check (PROD only)
    if (mode === 'PROD') {
      const stabilityCheck = await this.checkStabilityGate(run.window);
      checks.push(stabilityCheck);
      if (!stabilityCheck.passed) {
        blockers.push(stabilityCheck.reason || 'Stability gate not passed');
      }
    }

    // 7. Phase 5 Readiness (PROD only)
    if (mode === 'PROD') {
      const readinessCheck = await this.checkPhase5Readiness();
      checks.push(readinessCheck);
      if (!readinessCheck.passed) {
        blockers.push(readinessCheck.reason || 'Phase 5 not ready');
      }
    }

    const passed = blockers.length === 0;

    console.log(`[CalGuard] Safety check ${passed ? 'PASSED' : 'FAILED'}`);
    if (blockers.length > 0) {
      console.log(`[CalGuard] Blockers: ${blockers.join(', ')}`);
    }
    if (warnings.length > 0) {
      console.log(`[CalGuard] Warnings: ${warnings.join(', ')}`);
    }

    return { passed, checks, blockers, warnings };
  }

  /**
   * Check 1: ECE Improvement
   */
  private checkECEImprovement(run: any): GuardCheckResult['checks'][0] {
    const threshold = 0.01; // Must improve by at least 0.01 or not worsen
    const deltaECE = run.outputMetrics.deltaECE;

    const passed = deltaECE <= threshold;

    return {
      name: 'ECE Improvement',
      passed,
      reason: passed ? undefined : `ECE worsened by ${deltaECE.toFixed(3)} (threshold: ${threshold})`,
      value: deltaECE,
    };
  }

  /**
   * Check 2: Clamp Rate
   */
  private checkClampRate(run: any): GuardCheckResult['checks'][0] {
    const threshold = 30; // Max 30% clamp rate
    const clampRate = run.outputMetrics.clampRate;

    const passed = clampRate <= threshold;

    return {
      name: 'Clamp Rate',
      passed,
      reason: passed ? undefined : `Clamp rate ${clampRate.toFixed(1)}% exceeds ${threshold}%`,
      value: clampRate,
    };
  }

  /**
   * Check 3: Max Adjustment
   */
  private checkMaxAdjustment(run: any): GuardCheckResult['checks'][0] {
    const maxAllowed = run.config.maxAdjPct;
    const maxSeen = run.outputMetrics.maxAdjSeen;

    const passed = maxSeen <= maxAllowed;

    return {
      name: 'Max Adjustment',
      passed,
      reason: passed ? undefined : `Max adjustment ${maxSeen.toFixed(1)}% exceeds ${maxAllowed}%`,
      value: maxSeen,
    };
  }

  /**
   * Check 4: Min Bin Count
   */
  private checkMinBinCount(map: any): GuardCheckResult['checks'][0] {
    const minRequired = map.guardrails.minBinCount;
    const lowCountBins = map.bins.filter((b: any) => b.n > 0 && b.n < minRequired);

    const passed = lowCountBins.length === 0;

    return {
      name: 'Min Bin Count',
      passed,
      reason: passed ? undefined : `${lowCountBins.length} bins have < ${minRequired} samples`,
      value: lowCountBins.length,
    };
  }

  /**
   * Check 5: Active Alerts
   */
  private async checkActiveAlerts(window: string): Promise<GuardCheckResult['checks'][0]> {
    const criticalAlerts = await MLShadowAlertModel.countDocuments({
      window,
      severity: { $in: ['CRITICAL', 'HIGH'] },
      status: 'ACTIVE',
    });

    const passed = criticalAlerts === 0;

    return {
      name: 'Active Alerts',
      passed,
      reason: passed ? undefined : `${criticalAlerts} critical/high alerts active`,
      value: criticalAlerts,
    };
  }

  /**
   * Check 6: Stability Gate
   */
  private async checkStabilityGate(window: string): Promise<GuardCheckResult['checks'][0]> {
    const gate = await MLReadinessGateModel.findOne({ window, type: 'STABILITY' });

    if (!gate) {
      return {
        name: 'Stability Gate',
        passed: false,
        reason: 'Stability gate not found',
      };
    }

    const passed = gate.status === 'PASS';

    return {
      name: 'Stability Gate',
      passed,
      reason: passed ? undefined : `Stability gate status: ${gate.status}`,
      value: gate.status,
    };
  }

  /**
   * Check 7: Phase 5 Readiness
   */
  private async checkPhase5Readiness(): Promise<GuardCheckResult['checks'][0]> {
    // Check if all Phase 4 gates are PASS
    const gates = await MLReadinessGateModel.find({});
    
    const allPass = gates.every(g => g.status === 'PASS');

    return {
      name: 'Phase 5 Readiness',
      passed: allPass,
      reason: allPass ? undefined : 'Not all Phase 4 gates passed',
      value: allPass,
    };
  }

  /**
   * Generate rejection reasons from guard result
   */
  generateRejectionReasons(guardResult: GuardCheckResult): string[] {
    return guardResult.blockers;
  }
}

export const calibrationGuardService = new CalibrationGuardService();
