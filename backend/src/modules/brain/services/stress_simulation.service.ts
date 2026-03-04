/**
 * Stress Simulation Service
 * 
 * Runs Brain through black swan scenarios, checking stability, safety, response.
 * Forces regime/crossAsset/tailRisk overrides per preset.
 */

import { StressSimRequest, StressSimReport } from '../contracts/stress_sim.contract.js';
import { BLACK_SWAN_LIBRARY, BlackSwanPreset } from '../stress/black_swan_library.js';
import { getBrainOrchestratorService } from './brain_orchestrator.service.js';
import { buildEngineGlobal } from '../../engine-global/engine_global.service.js';
import { getEngineGlobalWithBrain } from '../../engine-global/engine_global_brain_bridge.service.js';

// Scenario-dependent override thresholds
const OVERRIDE_THRESHOLDS: Record<string, number> = {
  BASE: 0.35,
  RISK: 0.45,
  TAIL: 0.60,
};

export class StressSimulationService {

  async runStress(req: StressSimRequest): Promise<StressSimReport> {
    const preset = BLACK_SWAN_LIBRARY[req.scenarioPreset];
    if (!preset) {
      throw new Error(`Unknown preset: ${req.scenarioPreset}. Available: ${Object.keys(BLACK_SWAN_LIBRARY).join(', ')}`);
    }

    const dates = this.generateDates(req.start, req.end, req.stepDays);
    console.log(`[Stress] Running ${preset.name}: ${dates.length} steps, ${req.start}→${req.end}`);

    const samples: StressSimReport['samples'] = [];
    let nanDetected = false;
    let flipStormDetected = false;
    const overrideIntensities: number[] = [];
    const scenarios: string[] = [];
    let capViolations = 0;
    let haircutViolations = 0;
    let negativeExposure = false;
    let allocationSumValid = true;
    const cashIncreases: number[] = [];
    const riskReductions: number[] = [];
    const scenarioProbs = { BASE: 0, RISK: 0, TAIL: 0, count: 0 };

    for (const asOf of dates) {
      try {
        // Get baseline (no brain)
        const engineOff = await buildEngineGlobal(asOf);
        // Normalize offAlloc (Engine may return unnormalized)
        const rawSpx = engineOff?.allocations?.spxSize || 0;
        const rawBtc = engineOff?.allocations?.btcSize || 0;
        const rawCash = engineOff?.allocations?.cashSize || 0;
        const rawSum = rawSpx + rawBtc + rawCash || 1;
        const offAlloc = {
          spx: rawSpx / rawSum,
          btc: rawBtc / rawSum,
          cash: rawCash / rawSum,
        };

        // Get brain decision with stress overrides injected
        const brainService = getBrainOrchestratorService();
        const decision = await brainService.computeDecision(asOf, false);

        // Apply stress overrides to the decision
        const stressedDecision = this.applyStressOverrides(decision, preset);

        // Get brain-on allocations
        const engineOn = await getEngineGlobalWithBrain({ asOf, brain: true, brainMode: 'on' });
        const onAlloc = {
          spx: clamp01(engineOn?.allocations?.spxSize || 0),
          btc: clamp01(engineOn?.allocations?.btcSize || 0),
          cash: clamp01(engineOn?.allocations?.cashSize || 0),
        };

        // Apply stress directives to allocations
        const stressedAlloc = this.applyStressAllocations(onAlloc, stressedDecision, preset);

        // Check for NaN
        const values = [stressedAlloc.spx, stressedAlloc.btc, stressedAlloc.cash];
        if (values.some(v => isNaN(v) || !isFinite(v))) {
          nanDetected = true;
        }

        // Check negative
        if (values.some(v => v < -0.001)) {
          negativeExposure = true;
        }

        // Check allocation sum
        const sum = stressedAlloc.spx + stressedAlloc.btc + stressedAlloc.cash;
        if (Math.abs(sum) > 0.001 && (sum < 0 || sum > 3)) {
          allocationSumValid = false;
        }

        // Check caps
        if (stressedAlloc.spx > 1.01 || stressedAlloc.btc > 1.01) capViolations++;

        // Check haircuts
        const haircuts = stressedDecision.directives?.haircuts || {};
        for (const v of Object.values(haircuts)) {
          if (typeof v === 'number' && (v > 1 || v < 0)) haircutViolations++;
        }

        // Override intensity
        const intensity = Math.abs(stressedAlloc.spx - offAlloc.spx)
          + Math.abs(stressedAlloc.btc - offAlloc.btc)
          + Math.abs(stressedAlloc.cash - offAlloc.cash);
        overrideIntensities.push(intensity);

        // Scenario
        const scenario = stressedDecision.scenario?.name || 'UNKNOWN';
        scenarios.push(scenario);

        // Response metrics
        cashIncreases.push(stressedAlloc.cash - offAlloc.cash);
        riskReductions.push(
          (offAlloc.spx - stressedAlloc.spx) + (offAlloc.btc - stressedAlloc.btc)
        );

        // Scenario probs
        const probs = stressedDecision.scenario?.probs || {};
        scenarioProbs.BASE += probs.BASE || 0;
        scenarioProbs.RISK += probs.RISK || 0;
        scenarioProbs.TAIL += probs.TAIL || 0;
        scenarioProbs.count++;

        samples.push({
          asOf,
          scenario,
          allocations: stressedAlloc,
          overrideIntensity: round3(intensity),
          warnings: (stressedDecision.directives?.warnings || []).slice(0, 3),
        });
      } catch (e) {
        console.warn(`[Stress] Error at ${asOf}: ${(e as Error).message}`);
        samples.push({
          asOf,
          scenario: 'ERROR',
          allocations: { spx: 0, btc: 0, cash: 1 },
          overrideIntensity: 0,
          warnings: [(e as Error).message],
        });
      }
    }

    // Flip storm: > 3 flips per 10 steps
    let flips = 0;
    for (let i = 1; i < scenarios.length; i++) {
      if (scenarios[i] !== scenarios[i - 1]) flips++;
    }
    if (scenarios.length > 0 && flips / scenarios.length > 0.3) {
      flipStormDetected = true;
    }

    const maxOverride = overrideIntensities.length > 0 ? Math.max(...overrideIntensities) : 0;
    const avgOverride = overrideIntensities.length > 0
      ? overrideIntensities.reduce((a, b) => a + b, 0) / overrideIntensities.length : 0;

    // Verdict
    const issues: string[] = [];
    if (nanDetected) issues.push('NaN detected in allocations');
    if (flipStormDetected) issues.push(`Flip storm: ${flips} flips in ${scenarios.length} steps`);
    if (negativeExposure) issues.push('Negative exposure detected');
    if (capViolations > 0) issues.push(`${capViolations} cap violations`);
    if (!allocationSumValid) issues.push('Allocation sum out of bounds');

    // Check override against scenario-dependent threshold
    const dominantScenario = this.getDominant(scenarios);
    const threshold = OVERRIDE_THRESHOLDS[dominantScenario] || 0.60;
    if (maxOverride > threshold) {
      issues.push(`Max override intensity ${round3(maxOverride)} > ${threshold} (${dominantScenario} threshold)`);
    }

    const n = scenarioProbs.count || 1;

    return {
      scenarioPreset: req.scenarioPreset,
      window: { start: req.start, end: req.end, nSteps: samples.length },
      stability: {
        flipStormDetected,
        maxOverrideIntensity: round3(maxOverride),
        avgOverrideIntensity: round3(avgOverride),
        nanDetected,
        scenarioFlipCount: flips,
      },
      safety: {
        allocationSumValid,
        negativeExposure,
        capViolations,
        haircutViolations,
      },
      response: {
        avgCashIncrease: round3(cashIncreases.reduce((a, b) => a + b, 0) / (cashIncreases.length || 1)),
        avgRiskReduction: round3(riskReductions.reduce((a, b) => a + b, 0) / (riskReductions.length || 1)),
        avgScenarioProb: {
          BASE: round3(scenarioProbs.BASE / n),
          RISK: round3(scenarioProbs.RISK / n),
          TAIL: round3(scenarioProbs.TAIL / n),
        },
      },
      samples,
      verdict: {
        resilient: issues.length === 0,
        issues,
      },
    };
  }

  // ─────────────────────────────────────────────────────────

  private applyStressOverrides(decision: any, preset: BlackSwanPreset): any {
    const ov = preset.overrides;
    const d = JSON.parse(JSON.stringify(decision));

    // Force scenario based on stress
    if (ov.forceTailRisk !== undefined && ov.forceTailRisk >= 0.5) {
      d.scenario = { ...d.scenario, name: 'TAIL' };
      d.scenario.probs = { BASE: 0.05, RISK: 0.15, TAIL: 0.80 };
    } else if (ov.forceTailRisk !== undefined && ov.forceTailRisk >= 0.35) {
      d.scenario = { ...d.scenario, name: 'RISK' };
      d.scenario.probs = { BASE: 0.20, RISK: 0.50, TAIL: 0.30 };
    }

    // Force guard
    if (ov.forceGuardLevel === 'CRISIS') {
      d.directives = d.directives || {};
      d.directives.haircuts = { ...d.directives.haircuts, btc: 0.60, spx: 0.75 };
      d.directives.riskMode = 'RISK_OFF';
      d.directives.warnings = d.directives.warnings || [];
      d.directives.warnings.push(`STRESS OVERRIDE: Guard forced to CRISIS`);
    } else if (ov.forceGuardLevel === 'WARN') {
      d.directives = d.directives || {};
      d.directives.haircuts = { ...d.directives.haircuts, btc: 0.85, spx: 0.90 };
      d.directives.warnings = d.directives.warnings || [];
      d.directives.warnings.push(`STRESS OVERRIDE: Guard forced to WARN`);
    }

    return d;
  }

  private applyStressAllocations(
    alloc: { spx: number; btc: number; cash: number },
    decision: any,
    preset: BlackSwanPreset
  ): { spx: number; btc: number; cash: number } {
    const result = { ...alloc };
    const haircuts = decision.directives?.haircuts || {};

    // Apply haircuts
    if (haircuts.spx !== undefined && typeof haircuts.spx === 'number') {
      result.spx *= haircuts.spx;
    }
    if (haircuts.btc !== undefined && typeof haircuts.btc === 'number') {
      result.btc *= haircuts.btc;
    }

    // Apply caps
    const caps = decision.directives?.caps || {};
    if (caps.spx?.maxSize !== undefined) {
      result.spx = Math.min(result.spx, caps.spx.maxSize);
    }
    if (caps.btc?.maxSize !== undefined) {
      result.btc = Math.min(result.btc, caps.btc.maxSize);
    }

    // Clamp
    result.spx = clamp01(result.spx);
    result.btc = clamp01(result.btc);
    result.cash = clamp01(result.cash);

    return result;
  }

  private getDominant(scenarios: string[]): string {
    const counts: Record<string, number> = {};
    for (const s of scenarios) {
      counts[s] = (counts[s] || 0) + 1;
    }
    let best = 'BASE';
    let bestCount = 0;
    for (const [s, c] of Object.entries(counts)) {
      if (c > bestCount) { best = s; bestCount = c; }
    }
    return best;
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

function clamp01(v: number): number {
  if (isNaN(v) || !isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

let instance: StressSimulationService | null = null;
export function getStressSimulationService(): StressSimulationService {
  if (!instance) instance = new StressSimulationService();
  return instance;
}
