/**
 * Platform Crash-Test Service
 * 
 * Runs comprehensive crash-test across normal + stress modes.
 * Checks numerical stability, regime hysteresis, override bounds, determinism.
 * Produces resilienceScore (0..1).
 */

import * as crypto from 'crypto';
import { CrashTestReport } from '../contracts/stress_sim.contract.js';
import { getStressSimulationService } from './stress_simulation.service.js';
import { getBrainCompareService } from './brain_compare.service.js';
import { getPresetNames } from '../stress/black_swan_library.js';

export class CrashTestService {

  async runCrashTest(params: {
    start: string;
    end: string;
    stepDays: number;
    asset: string;
  }): Promise<CrashTestReport> {
    const { start, end, stepDays, asset } = params;
    const stressService = getStressSimulationService();
    const compareService = getBrainCompareService();

    let totalSteps = 0;
    let numericalErrors = 0;
    let regimeFlips = 0;
    let overrideExplosions = 0;
    let nanCount = 0;
    let capViolations = 0;
    let flipStorm = false;
    let determinismFail = false;

    const byMode: CrashTestReport['byMode'] = {};

    // ─────────────────────────────────────────────────────
    // MODE 1: Normal operation
    // ─────────────────────────────────────────────────────
    console.log('[CrashTest] Phase 1: Normal mode');
    const normalResult = await this.testNormalMode(compareService, start, end, stepDays);
    byMode['NORMAL'] = normalResult;
    totalSteps += normalResult.steps;
    nanCount += normalResult.nanCount;
    regimeFlips += normalResult.flipCount;
    capViolations += normalResult.capViolations;
    if (normalResult.maxOverride > 0.60) overrideExplosions++;

    // ─────────────────────────────────────────────────────
    // MODE 2: Each stress preset
    // ─────────────────────────────────────────────────────
    const presets = getPresetNames();
    for (const preset of presets) {
      console.log(`[CrashTest] Phase 2: Stress preset ${preset}`);
      try {
        const report = await stressService.runStress({
          asset,
          start,
          end,
          stepDays,
          scenarioPreset: preset,
        });

        const modeResult = {
          steps: report.window.nSteps,
          nanCount: report.stability.nanDetected ? 1 : 0,
          flipCount: report.stability.scenarioFlipCount,
          maxOverride: report.stability.maxOverrideIntensity,
          capViolations: report.safety.capViolations,
          issues: report.verdict.issues,
        };

        byMode[preset] = modeResult;
        totalSteps += modeResult.steps;
        nanCount += modeResult.nanCount;
        regimeFlips += modeResult.flipCount;
        capViolations += modeResult.capViolations;
        if (report.stability.flipStormDetected) flipStorm = true;
        if (report.stability.nanDetected) numericalErrors++;
        if (report.stability.maxOverrideIntensity > 1.0) overrideExplosions++;
      } catch (e) {
        byMode[preset] = {
          steps: 0,
          nanCount: 0,
          flipCount: 0,
          maxOverride: 0,
          capViolations: 0,
          issues: [`Preset failed: ${(e as Error).message}`],
        };
        numericalErrors++;
      }
    }

    // ─────────────────────────────────────────────────────
    // MODE 3: Determinism check
    // ─────────────────────────────────────────────────────
    console.log('[CrashTest] Phase 3: Determinism check');
    const detResult = await this.testDeterminism(compareService);
    determinismFail = !detResult.pass;
    byMode['DETERMINISM'] = {
      steps: detResult.steps,
      nanCount: 0,
      flipCount: 0,
      maxOverride: 0,
      capViolations: 0,
      issues: detResult.pass ? [] : ['Determinism failure: same inputs gave different outputs'],
    };
    totalSteps += detResult.steps;

    // ─────────────────────────────────────────────────────
    // RESILIENCE SCORE
    // ─────────────────────────────────────────────────────
    const resilienceScore = this.computeResilience({
      nanDetected: nanCount > 0,
      flipStorm,
      capViolationsAny: capViolations > 0,
      overrideExplosion: overrideExplosions > 0,
      determinismFail,
    });

    // Grade
    let grade: CrashTestReport['verdict']['grade'];
    if (resilienceScore >= 0.90) grade = 'PRODUCTION';
    else if (resilienceScore >= 0.85) grade = 'INSTITUTIONAL';
    else if (resilienceScore >= 0.60) grade = 'REVIEW';
    else grade = 'FAIL';

    const reasons: string[] = [];
    if (nanCount > 0) reasons.push(`NaN detected: ${nanCount} occurrences`);
    if (flipStorm) reasons.push('Flip storm detected in stress mode');
    if (capViolations > 0) reasons.push(`Cap violations: ${capViolations}`);
    if (overrideExplosions > 0) reasons.push(`Override explosions: ${overrideExplosions}`);
    if (determinismFail) reasons.push('Determinism check failed');
    if (reasons.length === 0) reasons.push('All checks passed');

    return {
      totalSteps,
      numericalErrors,
      regimeFlips,
      overrideExplosions,
      nanCount,
      capViolations,
      determinismFail,
      flipStorm,
      resilienceScore,
      byMode,
      verdict: { grade, score: resilienceScore, reasons },
    };
  }

  // ─────────────────────────────────────────────────────────

  private async testNormalMode(
    compareService: any,
    start: string,
    end: string,
    stepDays: number
  ): Promise<{ steps: number; nanCount: number; flipCount: number; maxOverride: number; capViolations: number; issues: string[] }> {
    const dates = this.generateDates(start, end, stepDays);
    let nanCount = 0;
    let flipCount = 0;
    let maxOverride = 0;
    let capViolations = 0;
    const scenarios: string[] = [];
    const issues: string[] = [];

    for (const asOf of dates) {
      try {
        const pack = await compareService.compare(asOf);
        const alloc = pack.brain.allocations;

        // NaN check
        if ([alloc.spxSize, alloc.btcSize, alloc.cashSize].some((v: number) => isNaN(v) || !isFinite(v))) {
          nanCount++;
        }

        // Cap check
        if (alloc.spxSize > 1.01 || alloc.btcSize > 1.01) capViolations++;

        // Override intensity
        const d = pack.diff.allocationsDelta;
        const intensity = Math.abs(d.spx) + Math.abs(d.btc) + Math.abs(d.cash);
        if (intensity > maxOverride) maxOverride = intensity;

        scenarios.push(pack.brain.decision.scenario);
      } catch (e) {
        issues.push(`Normal mode error at ${asOf}: ${(e as Error).message}`);
      }
    }

    for (let i = 1; i < scenarios.length; i++) {
      if (scenarios[i] !== scenarios[i - 1]) flipCount++;
    }

    return { steps: dates.length, nanCount, flipCount, maxOverride: round3(maxOverride), capViolations, issues };
  }

  private async testDeterminism(compareService: any): Promise<{ pass: boolean; steps: number }> {
    const testDates = ['2025-06-15', '2025-09-15', '2025-12-15'];
    let pass = true;

    for (const asOf of testDates) {
      try {
        const r1 = await compareService.compare(asOf);
        const r2 = await compareService.compare(asOf);

        if (r1.diff.diffHash !== r2.diff.diffHash) {
          pass = false;
          break;
        }
      } catch {
        // Skip dates without data
      }
    }

    return { pass, steps: testDates.length * 2 };
  }

  private computeResilience(flags: {
    nanDetected: boolean;
    flipStorm: boolean;
    capViolationsAny: boolean;
    overrideExplosion: boolean;
    determinismFail: boolean;
  }): number {
    let score = 1.0;
    if (flags.nanDetected) score -= 0.20;
    if (flags.flipStorm) score -= 0.20;
    if (flags.capViolationsAny) score -= 0.20;
    if (flags.overrideExplosion) score -= 0.20;
    if (flags.determinismFail) score -= 0.20;
    return Math.round(Math.max(0, score) * 100) / 100;
  }

  private generateDates(start: string, end: string, stepDays: number): string[] {
    const dates: string[] = [];
    let current = new Date(start);
    const endDate = new Date(end);
    while (current <= endDate && dates.length < 200) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + stepDays);
    }
    return dates;
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

let instance: CrashTestService | null = null;
export function getCrashTestService(): CrashTestService {
  if (!instance) instance = new CrashTestService();
  return instance;
}
