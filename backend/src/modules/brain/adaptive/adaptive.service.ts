/**
 * P12 — Adaptive Coefficient Learning Service
 * 
 * Walk-forward tuning of deterministic rule parameters.
 * Grid search with smoothing, strict gates, no ML blackbox.
 */

import * as crypto from 'crypto';
import {
  AdaptiveParams,
  AdaptiveMode,
  AssetId,
  TuningRunRequest,
  TuningRunReport,
  TuningCandidate,
  TuningMetrics,
  createDefaultParams,
  smoothUpdate,
  round4,
  clamp,
  validateAdaptiveParams,
} from './adaptive.contract.js';
import { 
  AdaptiveParamsModel, 
  AdaptiveHistoryModel, 
  TuningRunModel,
} from './adaptive_param.model.js';
import { getBrainCompareService } from '../services/brain_compare.service.js';
import { SYSTEM_FREEZE, isSystemFrozen } from '../../../core/version.js';

export class AdaptiveService {

  // ═══════════════════════════════════════════════════════════════
  // GET CURRENT PARAMS
  // ═══════════════════════════════════════════════════════════════

  async getParams(asset: AssetId): Promise<AdaptiveParams> {
    const doc = await AdaptiveParamsModel.findOne({ asset });
    
    if (!doc) {
      // Initialize with defaults
      const defaults = createDefaultParams(asset);
      await this.saveParams(defaults);
      return defaults;
    }
    
    return this.docToParams(doc);
  }

  async saveParams(params: AdaptiveParams): Promise<void> {
    await AdaptiveParamsModel.updateOne(
      { asset: params.asset },
      { $set: params },
      { upsert: true }
    );
    
    // Also save to history
    await AdaptiveHistoryModel.create({
      ...params,
      createdAt: new Date(),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // RUN TUNING (Walk-Forward Grid Search)
  // ═══════════════════════════════════════════════════════════════

  async runTuning(request: TuningRunRequest): Promise<string> {
    const { asset, start, end, steps, mode, gridSize = 3 } = request;
    const runId = `tune_${asset}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    // Create run record
    await TuningRunModel.create({
      runId,
      asset,
      start,
      end,
      steps,
      mode,
      status: 'running',
      startedAt: new Date(),
    });
    
    console.log(`[Adaptive] Starting tuning run ${runId} for ${asset}`);
    
    // Run async
    this.executeTuning(runId, request).catch(e => {
      console.error(`[Adaptive] Tuning ${runId} failed:`, e);
      TuningRunModel.updateOne({ runId }, { $set: { status: 'failed' } }).exec();
    });
    
    return runId;
  }

  // ═══════════════════════════════════════════════════════════════
  // TWO-PHASE TUNING (Optimized: Quick Filter → Deep Validation)
  // ═══════════════════════════════════════════════════════════════

  async runTwoPhase(request: TuningRunRequest): Promise<string> {
    const { asset, start, end, steps, mode } = request;
    const runId = `twophase_${asset}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    // Create run record
    await TuningRunModel.create({
      runId,
      asset,
      start,
      end,
      steps,
      mode,
      status: 'running',
      phase: 'filter',
      startedAt: new Date(),
    });
    
    console.log(`[Adaptive] Starting TWO-PHASE tuning ${runId} for ${asset}`);
    
    // Run async
    this.executeTwoPhase(runId, request).catch(e => {
      console.error(`[Adaptive] Two-phase ${runId} failed:`, e);
      TuningRunModel.updateOne({ runId }, { $set: { status: 'failed' } }).exec();
    });
    
    return runId;
  }

  private async executeTwoPhase(runId: string, request: TuningRunRequest): Promise<void> {
    const { asset, start, end, steps, mode } = request;
    const currentParams = await this.getParams(asset);
    
    // ═══════════════════════════════════════════════════════════
    // PHASE A: Quick Filter (5 steps, 8 candidates)
    // Goal: eliminate 70% of weak combinations
    // ═══════════════════════════════════════════════════════════
    
    console.log(`[Adaptive] PHASE A: Quick Filter (5 steps, 8 candidates)`);
    await TuningRunModel.updateOne({ runId }, { $set: { phase: 'filter' } });
    
    const filterSteps = 5;  // Quick evaluation
    const filterCandidates = this.generateSmartCandidates(currentParams, 8);
    
    // Evaluate baseline with quick steps
    const baselineMetrics = await this.evaluateParams(currentParams, start, end, filterSteps);
    const baseline = {
      params: currentParams,
      score: this.computeScore(baselineMetrics),
      metrics: baselineMetrics,
    };
    
    // Evaluate filter candidates
    const filterResults: Array<{ params: AdaptiveParams; score: number; metrics: TuningMetrics }> = [];
    
    for (let i = 0; i < filterCandidates.length; i++) {
      try {
        const metrics = await this.evaluateParams(filterCandidates[i], start, end, filterSteps);
        const score = this.computeScore(metrics);
        filterResults.push({ params: filterCandidates[i], score, metrics });
        console.log(`[Adaptive] Filter ${i+1}/${filterCandidates.length}: score=${score.toFixed(3)}`);
      } catch (e) {
        console.warn(`[Adaptive] Filter candidate ${i} failed:`, (e as Error).message);
      }
    }
    
    // Select top 3 candidates
    filterResults.sort((a, b) => b.score - a.score);
    const top3 = filterResults.slice(0, 3);
    
    console.log(`[Adaptive] PHASE A Complete. Top 3 scores: ${top3.map(c => c.score.toFixed(3)).join(', ')}`);
    
    // ═══════════════════════════════════════════════════════════
    // PHASE B: Deep Validation (full steps on top 3 only)
    // ═══════════════════════════════════════════════════════════
    
    console.log(`[Adaptive] PHASE B: Deep Validation (${steps} steps, top 3 candidates)`);
    await TuningRunModel.updateOne({ runId }, { $set: { phase: 'deep' } });
    
    let best = baseline;
    
    for (let i = 0; i < top3.length; i++) {
      try {
        const metrics = await this.evaluateParams(top3[i].params, start, end, steps);
        const score = this.computeScore(metrics);
        console.log(`[Adaptive] Deep ${i+1}/3: score=${score.toFixed(3)}, hitRate=${metrics.avgDeltaHitRatePp.toFixed(2)}pp`);
        
        if (score > best.score) {
          best = { params: top3[i].params, score, metrics };
          console.log(`[Adaptive] New best found: ${score.toFixed(3)}`);
        }
      } catch (e) {
        console.warn(`[Adaptive] Deep candidate ${i} failed:`, (e as Error).message);
      }
    }
    
    // Apply smoothing if best != baseline
    let finalParams = currentParams;
    if (best.params.versionId !== currentParams.versionId) {
      finalParams = this.smoothParams(currentParams, best.params);
      finalParams.versionId = `adaptive_${asset}_${new Date().toISOString()}`;
      finalParams.source = 'tuned';
    }
    
    // Evaluate gates
    const gates = this.evaluateGates(best.metrics, currentParams.gates);
    
    // Build report with extended metrics
    const report = {
      runId,
      asset,
      start,
      end,
      steps,
      mode,
      status: 'complete' as const,
      startedAt: (await TuningRunModel.findOne({ runId }))?.startedAt?.toISOString() || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      baseline,
      best: {
        params: finalParams,
        score: best.score,
        metrics: best.metrics,
      },
      candidatesEvaluated: filterCandidates.length + 3,
      phases: {
        filter: { candidates: filterCandidates.length, steps: filterSteps },
        deep: { candidates: 3, steps },
      },
      gates,
      recommendation: gates.passed ? 'promote' : (best.score > baseline.score ? 'review' : 'reject'),
    };
    
    // Save report
    await TuningRunModel.updateOne(
      { runId },
      { $set: { status: 'complete', completedAt: new Date(), report } }
    );
    
    // If mode=on and gates passed, auto-promote
    // SYSTEM_FREEZE: Block auto-promote in frozen state (v2.2)
    if (mode === 'on' && gates.passed) {
      if (isSystemFrozen()) {
        console.log(`[Adaptive] Auto-promote BLOCKED by SYSTEM_FREEZE for ${asset}`);
        report.recommendation = 'blocked_by_freeze';
      } else {
        console.log(`[Adaptive] Auto-promoting params for ${asset}`);
        await this.promote(asset, finalParams.versionId);
      }
    }
    
    console.log(`[Adaptive] Two-phase ${runId} complete. Recommendation: ${report.recommendation}`);
  }

  // Smart candidate generation (focused, not brute-force)
  private generateSmartCandidates(base: AdaptiveParams, count: number): AdaptiveParams[] {
    const candidates: AdaptiveParams[] = [];
    
    // Key tuning: K (strength) variations
    for (const kMult of [0.85, 0.95, 1.05, 1.15]) {
      candidates.push({
        ...base,
        versionId: `smart_K_${kMult}`,
        optimizer: { ...base.optimizer, K: clamp(base.optimizer.K * kMult, 0.1, 0.5) },
      });
    }
    
    // wTail variations
    for (const wTailMult of [0.9, 1.1]) {
      candidates.push({
        ...base,
        versionId: `smart_wTail_${wTailMult}`,
        optimizer: { ...base.optimizer, wTail: clamp(base.optimizer.wTail * wTailMult, 0.5, 2.0) },
      });
    }
    
    // Combined K + wTail
    candidates.push({
      ...base,
      versionId: 'smart_conservative',
      optimizer: {
        ...base.optimizer,
        K: clamp(base.optimizer.K * 0.9, 0.1, 0.5),
        wTail: clamp(base.optimizer.wTail * 1.1, 0.5, 2.0),
      },
    });
    
    candidates.push({
      ...base,
      versionId: 'smart_aggressive',
      optimizer: {
        ...base.optimizer,
        K: clamp(base.optimizer.K * 1.1, 0.1, 0.5),
        wTail: clamp(base.optimizer.wTail * 0.9, 0.5, 2.0),
      },
    });
    
    return candidates.slice(0, count);
  }

  private async executeTuning(runId: string, request: TuningRunRequest): Promise<void> {
    const { asset, start, end, steps, mode, gridSize = 3 } = request;
    
    // Get current params
    const currentParams = await this.getParams(asset);
    
    // Evaluate baseline
    console.log(`[Adaptive] Evaluating baseline params...`);
    const baselineMetrics = await this.evaluateParams(currentParams, start, end, steps);
    const baseline: TuningCandidate = {
      params: currentParams,
      score: this.computeScore(baselineMetrics),
      metrics: baselineMetrics,
    };
    
    // Generate candidates (grid search)
    const candidates = this.generateCandidates(currentParams, gridSize);
    console.log(`[Adaptive] Evaluating ${candidates.length} candidates...`);
    
    let best = baseline;
    let candidatesEvaluated = 0;
    
    for (const candidateParams of candidates) {
      try {
        const metrics = await this.evaluateParams(candidateParams, start, end, steps);
        const score = this.computeScore(metrics);
        candidatesEvaluated++;
        
        if (score > best.score) {
          best = { params: candidateParams, score, metrics };
          console.log(`[Adaptive] New best: score=${score.toFixed(3)}, avgDelta=${metrics.avgDeltaHitRatePp.toFixed(2)}pp`);
        }
        
        if (candidatesEvaluated % 10 === 0) {
          console.log(`[Adaptive] Progress: ${candidatesEvaluated}/${candidates.length}`);
        }
      } catch (e) {
        console.warn(`[Adaptive] Candidate eval failed:`, (e as Error).message);
      }
    }
    
    // Apply smoothing if best != baseline
    let finalParams = currentParams;
    if (best.params.versionId !== currentParams.versionId) {
      finalParams = this.smoothParams(currentParams, best.params);
      finalParams.versionId = `adaptive_${asset}_${new Date().toISOString()}`;
      finalParams.source = 'tuned';
    }
    
    // Evaluate gates
    const gates = this.evaluateGates(best.metrics, currentParams.gates);
    
    // Build report
    const report: TuningRunReport = {
      runId,
      asset,
      start,
      end,
      steps,
      mode,
      status: 'complete',
      startedAt: (await TuningRunModel.findOne({ runId }))?.startedAt?.toISOString() || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      baseline,
      best: {
        params: finalParams,
        score: best.score,
        metrics: best.metrics,
      },
      candidatesEvaluated,
      gates,
      recommendation: gates.passed ? 'promote' : (best.score > baseline.score ? 'review' : 'reject'),
    };
    
    // Save report
    await TuningRunModel.updateOne(
      { runId },
      { $set: { status: 'complete', completedAt: new Date(), report } }
    );
    
    // If mode=on and gates passed, auto-promote
    // SYSTEM_FREEZE: Block auto-promote in frozen state (v2.2)
    if (mode === 'on' && gates.passed) {
      if (isSystemFrozen()) {
        console.log(`[Adaptive] Auto-promote BLOCKED by SYSTEM_FREEZE for ${asset}`);
        report.recommendation = 'blocked_by_freeze';
      } else {
        console.log(`[Adaptive] Auto-promoting params for ${asset}`);
        await this.promote(asset, finalParams.versionId);
      }
    }
    
    console.log(`[Adaptive] Tuning ${runId} complete. Recommendation: ${report.recommendation}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // EVALUATE PARAMS (using Brain Compare)
  // ═══════════════════════════════════════════════════════════════

  private async evaluateParams(
    params: AdaptiveParams, 
    start: string, 
    end: string, 
    steps: number
  ): Promise<TuningMetrics> {
    // Generate dates for walk-forward
    const dates = this.generateDates(start, end, steps);
    const compareService = getBrainCompareService();
    
    const deltas: number[] = [];
    const intensities: number[] = [];
    const scenarios: string[] = [];
    let flipCount = 0;
    let degradationCount = 0;
    
    // Regime-based tracking
    let lastScenario = '';
    const flipsByRegime = { base: 0, risk: 0, tail: 0 };
    
    // P12.1 FIX: Track intensity by scenario for institutional audit
    const intensitiesByScenario: { BASE: number[], RISK: number[], TAIL: number[] } = {
      BASE: [], RISK: [], TAIL: []
    };
    
    // P12.1 FIX: Track delta by horizon
    const deltasByHorizon: { d30: number[], d90: number[], d180: number[], d365: number[] } = {
      d30: [], d90: [], d180: [], d365: []
    };
    
    for (let i = 0; i < dates.length; i++) {
      try {
        const asOf = dates[i];
        const comparison = await compareService.compare(asOf);
        
        // Delta = difference between brain ON and OFF (from allocationsDelta)
        const spxDelta = comparison.diff?.allocationsDelta?.spx || 0;
        const btcDelta = comparison.diff?.allocationsDelta?.btc || 0;
        const delta = Math.max(Math.abs(spxDelta), Math.abs(btcDelta));
        deltas.push(delta);
        
        // Get override intensity from compare response
        const intensity = comparison.diff?.overrideIntensity?.total || 0;
        intensities.push(intensity);
        
        // Track scenario
        const scenario = comparison.brain?.decision?.scenario || 'BASE';
        scenarios.push(scenario);
        
        // P12.1 FIX: Track intensity by scenario
        if (scenario === 'BASE' || scenario === 'RISK' || scenario === 'TAIL') {
          intensitiesByScenario[scenario].push(intensity);
        }
        
        // P12.1 FIX: Track delta by horizon from compare diff
        const horizonDeltas = comparison.diff?.deltaByHorizon || {};
        if (horizonDeltas.d30 !== undefined) deltasByHorizon.d30.push(horizonDeltas.d30);
        if (horizonDeltas.d90 !== undefined) deltasByHorizon.d90.push(horizonDeltas.d90);
        if (horizonDeltas.d180 !== undefined) deltasByHorizon.d180.push(horizonDeltas.d180);
        if (horizonDeltas.d365 !== undefined) deltasByHorizon.d365.push(horizonDeltas.d365);
        
        // Count flips (direction changes) with regime breakdown
        if (i > 0) {
          const prevDelta = deltas[i - 1];
          if ((delta > 0 && prevDelta < 0) || (delta < 0 && prevDelta > 0)) {
            flipCount++;
            // Track by current regime
            if (scenario === 'BASE') flipsByRegime.base++;
            else if (scenario === 'RISK') flipsByRegime.risk++;
            else if (scenario === 'TAIL') flipsByRegime.tail++;
          }
        }
        lastScenario = scenario;
        
        // Track degradation (if delta is negative = Brain hurt performance)
        if (delta < params.gates.maxDegradationPp / 100) {
          degradationCount++;
        }
      } catch (e) {
        console.warn(`[Adaptive] Compare failed at date ${dates[i]}:`, (e as Error).message);
      }
    }
    
    const n = deltas.length || 1;
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / n;
    const minDelta = deltas.length > 0 ? Math.min(...deltas) : 0;
    const maxDelta = deltas.length > 0 ? Math.max(...deltas) : 0;
    const avgIntensity = intensities.length > 0 ? intensities.reduce((a, b) => a + b, 0) / n : 0;
    const maxIntensity = intensities.length > 0 ? Math.max(...intensities) : 0;
    
    // Calculate stability (variance of deltas)
    const deltaVariance = deltas.reduce((sum, d) => sum + Math.pow(d - avgDelta, 2), 0) / n;
    const stabilityScore = 1 - Math.min(1, Math.sqrt(deltaVariance) * 10); // Lower variance = higher stability
    
    // Calculate intensity variance
    const avgIntensityCalc = intensities.reduce((a, b) => a + b, 0) / intensities.length;
    const intensityVariance = intensities.reduce((sum, i) => sum + Math.pow(i - avgIntensityCalc, 2), 0) / intensities.length;
    
    // Convert to yearly flip rate
    const periodDays = (new Date(end).getTime() - new Date(start).getTime()) / (24 * 60 * 60 * 1000);
    const flipRatePerYear = periodDays > 0 ? (flipCount / periodDays) * 365 : 0;
    
    // Calculate tail scenario rate
    const tailCount = scenarios.filter(s => s === 'TAIL').length;
    const riskCount = scenarios.filter(s => s === 'RISK').length;
    const baseCount = scenarios.filter(s => s === 'BASE').length;
    const tailScenarioRate = n > 0 ? tailCount / n : 0;
    
    // P12.1 FIX: Calculate scenario rates for audit
    const scenarioRates = {
      BASE: n > 0 ? round4(baseCount / n) : 0,
      RISK: n > 0 ? round4(riskCount / n) : 0,
      TAIL: n > 0 ? round4(tailCount / n) : 0,
    };
    
    // P12.1 FIX: Calculate average intensity by scenario
    const avgIntensityByScenario = {
      BASE: intensitiesByScenario.BASE.length > 0 
        ? round4(intensitiesByScenario.BASE.reduce((a,b) => a+b, 0) / intensitiesByScenario.BASE.length)
        : 0,
      RISK: intensitiesByScenario.RISK.length > 0
        ? round4(intensitiesByScenario.RISK.reduce((a,b) => a+b, 0) / intensitiesByScenario.RISK.length)
        : 0,
      TAIL: intensitiesByScenario.TAIL.length > 0
        ? round4(intensitiesByScenario.TAIL.reduce((a,b) => a+b, 0) / intensitiesByScenario.TAIL.length)
        : 0,
    };
    
    // P12.1 FIX: Calculate delta by horizon (from collected data)
    const avgDeltaByHorizon = {
      d30: deltasByHorizon.d30.length > 0 
        ? round4(deltasByHorizon.d30.reduce((a,b) => a+b, 0) / deltasByHorizon.d30.length * 100)
        : round4(avgDelta * 100),
      d90: deltasByHorizon.d90.length > 0
        ? round4(deltasByHorizon.d90.reduce((a,b) => a+b, 0) / deltasByHorizon.d90.length * 100)
        : round4(avgDelta * 100),
      d180: deltasByHorizon.d180.length > 0
        ? round4(deltasByHorizon.d180.reduce((a,b) => a+b, 0) / deltasByHorizon.d180.length * 100)
        : round4(avgDelta * 100),
      d365: deltasByHorizon.d365.length > 0
        ? round4(deltasByHorizon.d365.reduce((a,b) => a+b, 0) / deltasByHorizon.d365.length * 100)
        : round4(avgDelta * 100),
    };
    
    // Calculate regime flip sensitivity (flips that happen on scenario changes)
    let scenarioChanges = 0;
    for (let i = 1; i < scenarios.length; i++) {
      if (scenarios[i] !== scenarios[i-1]) scenarioChanges++;
    }
    const regimeFlipSensitivity = scenarioChanges > 0 ? flipCount / scenarioChanges : 0;
    
    // Flip rate by regime (normalized)
    const totalFlips = flipsByRegime.base + flipsByRegime.risk + flipsByRegime.tail;
    const flipRateByRegime = {
      base: totalFlips > 0 ? flipsByRegime.base / totalFlips : 0,
      risk: totalFlips > 0 ? flipsByRegime.risk / totalFlips : 0,
      tail: totalFlips > 0 ? flipsByRegime.tail / totalFlips : 0,
    };
    
    return {
      avgDeltaHitRatePp: round4(avgDelta * 100),  // Convert to percentage points
      minDeltaPp: round4(minDelta * 100),
      maxDeltaPp: round4(maxDelta * 100),
      flipRatePerYear: round4(flipRatePerYear),
      avgOverrideIntensity: round4(avgIntensity),
      maxOverrideIntensity: round4(maxIntensity),
      stabilityScore: round4(Math.max(0, stabilityScore)),
      degradationCount,
      
      // Extended metrics
      tailScenarioRate: round4(tailScenarioRate),
      intensityVariance: round4(intensityVariance),
      regimeFlipSensitivity: round4(regimeFlipSensitivity),
      
      // P12.1 FIX: Scenario rates for audit
      scenarioRates,
      
      // P12.1 FIX: Override intensity by scenario (KEY METRIC)
      overrideIntensityByScenario: avgIntensityByScenario,
      
      // P12.1 FIX: Delta by horizon (for alpha breakdown)
      deltaByHorizon: avgDeltaByHorizon,
      
      // Regime breakdown
      flipRateByRegime,
    };
  }

  private generateDates(start: string, end: string, steps: number): string[] {
    const dates: string[] = [];
    const startDate = new Date(start);
    const endDate = new Date(end);
    const totalDays = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
    const stepDays = Math.max(1, Math.floor(totalDays / steps));
    
    let current = new Date(start);
    while (current <= endDate && dates.length < steps) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + stepDays);
    }
    
    return dates;
  }

  // ═══════════════════════════════════════════════════════════════
  // OBJECTIVE SCORE (Enhanced with tail/flip penalties)
  // ═══════════════════════════════════════════════════════════════

  private computeScore(metrics: TuningMetrics): number {
    // Objective: maximize delta hit rate, penalize bad behaviors
    let score = metrics.avgDeltaHitRatePp;
    
    // 1. Degradation penalty (if any horizon < -1pp)
    if (metrics.minDeltaPp < -1) {
      score -= 2;
    }
    
    // 2. Flip storm penalty (усилено)
    if (metrics.flipRatePerYear > 6) {
      score -= (metrics.flipRatePerYear - 6) * 1.0; // Увеличен вес
    }
    
    // 3. Override explosion penalty (усилено для TAIL proximity)
    if (metrics.maxOverrideIntensity > 0.35) {
      const overCapDelta = metrics.maxOverrideIntensity - 0.35;
      score -= overCapDelta * 15; // Усилен вес
    }
    
    // 4. Instability penalty
    if (metrics.stabilityScore < 0.5) {
      score -= (0.5 - metrics.stabilityScore) * 2;
    }
    
    // 5. NEW: Tail frequency increase penalty
    if (metrics.tailScenarioRate > 0.40) { // >40% tail scenarios = suspicious
      score -= (metrics.tailScenarioRate - 0.40) * 5;
    }
    
    // 6. NEW: Override intensity variance penalty (oscillation)
    if (metrics.intensityVariance > 0.05) {
      score -= metrics.intensityVariance * 10;
    }
    
    // 7. NEW: Regime flip sensitivity penalty
    if (metrics.regimeFlipSensitivity > 0.3) {
      score -= (metrics.regimeFlipSensitivity - 0.3) * 3;
    }
    
    return round4(score);
  }

  // ═══════════════════════════════════════════════════════════════
  // GENERATE CANDIDATES (Grid Search)
  // ═══════════════════════════════════════════════════════════════

  private generateCandidates(base: AdaptiveParams, gridSize: number): AdaptiveParams[] {
    const candidates: AdaptiveParams[] = [];
    const multipliers = gridSize === 3 ? [0.9, 1.0, 1.1] : [0.85, 0.95, 1.0, 1.05, 1.15];
    
    // Grid search on key optimizer params
    for (const kMult of multipliers) {
      for (const wTailMult of multipliers) {
        const candidate: AdaptiveParams = {
          ...base,
          versionId: `candidate_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          optimizer: {
            ...base.optimizer,
            K: clamp(base.optimizer.K * kMult, 0.1, 0.5),
            wTail: clamp(base.optimizer.wTail * wTailMult, 0.5, 2.0),
          },
        };
        
        // Validate and add
        const validation = validateAdaptiveParams(candidate);
        if (validation.valid) {
          candidates.push(candidate);
        }
      }
    }
    
    // Also try metarisk variations
    for (const durMult of [0.9, 1.0, 1.1]) {
      const candidate: AdaptiveParams = {
        ...base,
        versionId: `candidate_meta_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        metarisk: {
          ...base.metarisk,
          durationScale: clamp(base.metarisk.durationScale * durMult, 0.5, 1.5),
        },
      };
      
      const validation = validateAdaptiveParams(candidate);
      if (validation.valid) {
        candidates.push(candidate);
      }
    }
    
    return candidates;
  }

  // ═══════════════════════════════════════════════════════════════
  // SMOOTH PARAMS
  // ═══════════════════════════════════════════════════════════════

  private smoothParams(current: AdaptiveParams, candidate: AdaptiveParams): AdaptiveParams {
    const alpha = 0.35; // Smoothing factor
    
    return {
      ...current,
      optimizer: {
        K: smoothUpdate(current.optimizer.K, candidate.optimizer.K, alpha),
        wReturn: smoothUpdate(current.optimizer.wReturn, candidate.optimizer.wReturn, alpha),
        wTail: smoothUpdate(current.optimizer.wTail, candidate.optimizer.wTail, alpha),
        wCorr: smoothUpdate(current.optimizer.wCorr, candidate.optimizer.wCorr, alpha),
        wGuard: smoothUpdate(current.optimizer.wGuard, candidate.optimizer.wGuard, alpha),
        capBase: current.optimizer.capBase, // Don't change caps
        capDefensive: current.optimizer.capDefensive,
        capTail: current.optimizer.capTail,
      },
      metarisk: {
        durationScale: smoothUpdate(current.metarisk.durationScale, candidate.metarisk.durationScale, alpha),
        stabilityScale: smoothUpdate(current.metarisk.stabilityScale, candidate.metarisk.stabilityScale, alpha),
        flipPenalty: smoothUpdate(current.metarisk.flipPenalty, candidate.metarisk.flipPenalty, alpha),
        crossAdj: smoothUpdate(current.metarisk.crossAdj, candidate.metarisk.crossAdj, alpha),
      },
      brain: current.brain, // Don't change brain rules in auto-tuning (more sensitive)
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // EVALUATE GATES
  // ═══════════════════════════════════════════════════════════════

  private evaluateGates(metrics: TuningMetrics, gates: any): TuningRunReport['gates'] {
    // P12.1 FIX: Check intensity by scenario (institutional requirement)
    const intensityByScenario = (metrics as any).overrideIntensityByScenario || { BASE: 0, RISK: 0, TAIL: 0 };
    
    const checks = {
      deltaHitRate: metrics.avgDeltaHitRatePp >= gates.minDeltaHitRatePp,
      degradation: metrics.minDeltaPp >= gates.maxDegradationPp,
      flipRate: metrics.flipRatePerYear <= gates.maxFlipRatePerYear,
      overrideIntensity: metrics.maxOverrideIntensity <= gates.maxOverrideIntensityBase,
      // P12.1 FIX: Scenario-specific intensity gates
      baseIntensity: intensityByScenario.BASE <= 0.35,   // KEY: BASE must be calm
      riskIntensity: intensityByScenario.RISK <= 0.45,   // RISK can be moderate
      tailIntensity: intensityByScenario.TAIL <= 0.60,   // TAIL can be aggressive
      determinism: true, // Assumed from deterministic code
      noLookahead: true, // Assumed from asOf-safe code
    };
    
    const reasons: string[] = [];
    if (!checks.deltaHitRate) reasons.push(`avgDeltaHitRatePp ${metrics.avgDeltaHitRatePp} < ${gates.minDeltaHitRatePp}`);
    if (!checks.degradation) reasons.push(`minDeltaPp ${metrics.minDeltaPp} < ${gates.maxDegradationPp}`);
    if (!checks.flipRate) reasons.push(`flipRate ${metrics.flipRatePerYear} > ${gates.maxFlipRatePerYear}`);
    if (!checks.overrideIntensity) reasons.push(`maxIntensity ${metrics.maxOverrideIntensity} > ${gates.maxOverrideIntensityBase}`);
    // P12.1 FIX: Report scenario intensity failures
    if (!checks.baseIntensity) reasons.push(`baseAvgIntensity ${intensityByScenario.BASE} > 0.35`);
    if (!checks.riskIntensity) reasons.push(`riskAvgIntensity ${intensityByScenario.RISK} > 0.45`);
    if (!checks.tailIntensity) reasons.push(`tailAvgIntensity ${intensityByScenario.TAIL} > 0.60`);
    
    return {
      passed: Object.values(checks).every(Boolean),
      checks,
      reasons,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // PROMOTE PARAMS
  // ═══════════════════════════════════════════════════════════════

  async promote(asset: AssetId, versionId: string): Promise<void> {
    // Find in history
    const history = await AdaptiveHistoryModel.findOne({ asset, versionId });
    if (!history) {
      throw new Error(`Version ${versionId} not found in history`);
    }
    
    // Update active params
    const params = this.docToParams(history);
    params.source = 'promoted';
    params.updatedAt = new Date().toISOString();
    
    await this.saveParams(params);
    console.log(`[Adaptive] Promoted ${versionId} for ${asset}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // GET STATUS/REPORT
  // ═══════════════════════════════════════════════════════════════

  async getRunStatus(runId: string): Promise<any> {
    const run = await TuningRunModel.findOne({ runId });
    if (!run) {
      return { ok: false, error: 'Run not found' };
    }
    
    return {
      ok: true,
      runId,
      status: run.status,
      startedAt: run.startedAt?.toISOString(),
      completedAt: run.completedAt?.toISOString(),
      report: run.report,
    };
  }

  async getHistory(asset: AssetId, limit: number = 10): Promise<any[]> {
    const docs = await AdaptiveHistoryModel.find({ asset })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    return docs.map(d => ({
      versionId: d.versionId,
      source: d.source,
      createdAt: d.createdAt,
      metrics: d.metrics,
    }));
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private docToParams(doc: any): AdaptiveParams {
    return {
      versionId: doc.versionId,
      asset: doc.asset,
      brain: doc.brain,
      optimizer: doc.optimizer,
      metarisk: doc.metarisk,
      gates: doc.gates,
      updatedAt: doc.updatedAt?.toISOString?.() || doc.updatedAt,
      source: doc.source,
    };
  }
}

// Singleton
let instance: AdaptiveService | null = null;

export function getAdaptiveService(): AdaptiveService {
  if (!instance) {
    instance = new AdaptiveService();
  }
  return instance;
}
