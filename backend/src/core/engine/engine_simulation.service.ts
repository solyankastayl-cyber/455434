/**
 * Engine Simulation Service
 * 
 * Режимы тестирования Engine без ожидания реального трафика:
 * 
 * 1. Historical Replay - прогон исторических данных
 * 2. Synthetic Perturbation - стресс-тест с искажениями
 * 3. Monte Carlo - случайные feature vectors
 * 
 * Симуляции НЕ влияют на production decisions
 */
import { EngineInput } from './engine_decision_v1_1.service.js';
import { generateDecisionV1_1 } from './engine_decision_v1_1.service.js';
import { buildEngineInputForActor, buildEngineInput } from './engine_input.service.js';
import { runShadowComparison } from './engine_shadow.service.js';
import { extractFeatures } from './engine_feature_extractor.js';
import { EntityModel } from '../entities/entities.model.js';
import { SignalContextModel } from '../signals/signal_context.model.js';
import { parseWindow, TimeWindow } from '../common/window.service.js';

// ============ SIMULATION CONFIG ============

export const SIMULATION_CONFIG = {
  maxBatchSize: 100,
  windows: ['1h', '6h', '24h', '7d'] as TimeWindow[],
};

// ============ SIMULATION TYPES ============

export interface SimulationResult {
  id: string;
  type: 'replay' | 'perturb' | 'montecarlo';
  totalRuns: number;
  results: {
    decision: 'BUY' | 'SELL' | 'NEUTRAL';
    evidence: number;
    risk: number;
    direction: number;
    coverage: number;
    asset: string;
    window: string;
  }[];
  summary: {
    buy: number;
    sell: number;
    neutral: number;
    avgEvidence: number;
    avgRisk: number;
    avgCoverage: number;
  };
  createdAt: Date;
}

export interface PerturbConfig {
  inflowMultiplier?: number;      // default 1.0
  outflowMultiplier?: number;     // default 1.0
  coverageOverride?: number;      // force coverage
  addConflicts?: boolean;         // inject inflow+outflow
  singleSource?: boolean;         // reduce to 1 source
}

// ============ HISTORICAL REPLAY ============

/**
 * Replay historical data through Engine
 * Runs decisions for all known actors across all windows
 */
export async function runHistoricalReplay(
  limit: number = 50
): Promise<SimulationResult> {
  const simulationId = `sim_replay_${Date.now()}`;
  const results: SimulationResult['results'] = [];
  
  // Get all entities
  const entities = await EntityModel.find({}).limit(20).lean();
  const windows = SIMULATION_CONFIG.windows;
  
  let runsCount = 0;
  
  for (const entity of entities as any[]) {
    if (runsCount >= limit) break;
    
    for (const window of windows) {
      if (runsCount >= limit) break;
      
      try {
        // Build input
        const input = await buildEngineInputForActor(entity.slug, window);
        
        // Generate decision
        const decision = await generateDecisionV1_1(input);
        
        // Run shadow comparison
        await runShadowComparison(input, {
          id: decision.id,
          decision: decision.decision,
          confidenceBand: decision.confidenceBand,
          scores: decision.scores,
        });
        
        results.push({
          decision: decision.decision,
          evidence: decision.scores.evidence,
          risk: decision.scores.risk,
          direction: decision.scores.direction,
          coverage: input.coverage.overall,
          asset: entity.slug,
          window,
        });
        
        runsCount++;
      } catch (err) {
        console.error(`[Simulation] Error for ${entity.slug}/${window}:`, err);
      }
    }
  }
  
  // Also run for token addresses from contexts
  const contexts = await SignalContextModel.find({}).limit(10).lean();
  
  for (const ctx of contexts as any[]) {
    if (runsCount >= limit) break;
    
    const assets = ctx.affectedAssets || [];
    for (const asset of assets.slice(0, 3)) {
      if (runsCount >= limit) break;
      
      try {
        const input = await buildEngineInput(asset, '24h');
        const decision = await generateDecisionV1_1(input);
        
        await runShadowComparison(input, {
          id: decision.id,
          decision: decision.decision,
          confidenceBand: decision.confidenceBand,
          scores: decision.scores,
        });
        
        results.push({
          decision: decision.decision,
          evidence: decision.scores.evidence,
          risk: decision.scores.risk,
          direction: decision.scores.direction,
          coverage: input.coverage.overall,
          asset: asset.slice(0, 10) + '...',
          window: '24h',
        });
        
        runsCount++;
      } catch (err) {
        // Skip errors
      }
    }
  }
  
  // Calculate summary
  const summary = calculateSummary(results);
  
  return {
    id: simulationId,
    type: 'replay',
    totalRuns: results.length,
    results,
    summary,
    createdAt: new Date(),
  };
}

// ============ SYNTHETIC PERTURBATION ============

/**
 * Run Engine with perturbed inputs to test robustness
 */
export async function runPerturbationTest(
  baseActor: string = 'binance',
  perturbations: PerturbConfig[]
): Promise<SimulationResult> {
  const simulationId = `sim_perturb_${Date.now()}`;
  const results: SimulationResult['results'] = [];
  
  // Default perturbations if none provided
  const defaultPerturbations: PerturbConfig[] = [
    { inflowMultiplier: 1.5 },           // +50% inflow
    { outflowMultiplier: 1.5 },          // +50% outflow
    { inflowMultiplier: 0.5 },           // -50% inflow
    { coverageOverride: 30 },            // Force low coverage
    { coverageOverride: 90 },            // Force high coverage
    { addConflicts: true },              // Inject conflicts
    { singleSource: true },              // Single source only
    { inflowMultiplier: 2, outflowMultiplier: 2 }, // Both high
  ];
  
  const tests = perturbations.length > 0 ? perturbations : defaultPerturbations;
  
  for (const perturb of tests) {
    try {
      // Get base input
      const baseInput = await buildEngineInputForActor(baseActor, '24h');
      
      // Apply perturbation
      const perturbedInput = applyPerturbation(baseInput, perturb);
      
      // Generate decision
      const decision = await generateDecisionV1_1(perturbedInput);
      
      results.push({
        decision: decision.decision,
        evidence: decision.scores.evidence,
        risk: decision.scores.risk,
        direction: decision.scores.direction,
        coverage: perturbedInput.coverage.overall,
        asset: `${baseActor} (perturbed)`,
        window: '24h',
      });
    } catch (err) {
      console.error(`[Simulation] Perturbation error:`, err);
    }
  }
  
  const summary = calculateSummary(results);
  
  return {
    id: simulationId,
    type: 'perturb',
    totalRuns: results.length,
    results,
    summary,
    createdAt: new Date(),
  };
}

/**
 * Apply perturbation to input
 */
function applyPerturbation(input: EngineInput, config: PerturbConfig): EngineInput {
  const perturbed = JSON.parse(JSON.stringify(input)) as EngineInput;
  
  // Coverage override
  if (config.coverageOverride !== undefined) {
    perturbed.coverage.overall = config.coverageOverride;
    perturbed.coverage.contexts = config.coverageOverride;
    perturbed.coverage.signals = config.coverageOverride;
    perturbed.coverage.actors = config.coverageOverride;
  }
  
  // Inflow multiplier
  if (config.inflowMultiplier !== undefined) {
    for (const signal of perturbed.signals) {
      if (signal.metric === 'inflow') {
        signal.deviation *= config.inflowMultiplier;
      }
    }
  }
  
  // Outflow multiplier
  if (config.outflowMultiplier !== undefined) {
    for (const signal of perturbed.signals) {
      if (signal.metric === 'outflow') {
        signal.deviation *= config.outflowMultiplier;
      }
    }
  }
  
  // Add conflicts
  if (config.addConflicts) {
    perturbed.signals.push({
      id: 'sim_inflow',
      type: 'flow_deviation',
      deviation: 2.5,
      severity: 'high',
      source: 'simulation',
      metric: 'inflow',
    });
    perturbed.signals.push({
      id: 'sim_outflow',
      type: 'flow_deviation',
      deviation: 2.5,
      severity: 'high',
      source: 'simulation',
      metric: 'outflow',
    });
  }
  
  // Single source
  if (config.singleSource) {
    perturbed.actors = perturbed.actors.slice(0, 1);
    perturbed.contexts = [];
    perturbed.signals = perturbed.signals.slice(0, 1);
  }
  
  return perturbed;
}

// ============ MONTE CARLO ============

/**
 * Generate random feature vectors and test decision boundaries
 */
export async function runMonteCarloTest(
  iterations: number = 50
): Promise<SimulationResult> {
  const simulationId = `sim_mc_${Date.now()}`;
  const results: SimulationResult['results'] = [];
  
  for (let i = 0; i < iterations; i++) {
    // Generate random input
    const randomInput = generateRandomInput();
    
    try {
      const decision = await generateDecisionV1_1(randomInput);
      
      results.push({
        decision: decision.decision,
        evidence: decision.scores.evidence,
        risk: decision.scores.risk,
        direction: decision.scores.direction,
        coverage: randomInput.coverage.overall,
        asset: `random_${i}`,
        window: '24h',
      });
    } catch (err) {
      // Skip errors
    }
  }
  
  const summary = calculateSummary(results);
  
  return {
    id: simulationId,
    type: 'montecarlo',
    totalRuns: results.length,
    results,
    summary,
    createdAt: new Date(),
  };
}

/**
 * Generate random EngineInput for Monte Carlo testing
 */
function generateRandomInput(): EngineInput {
  const randomBetween = (min: number, max: number) => 
    Math.floor(Math.random() * (max - min + 1)) + min;
  
  const coverage = randomBetween(10, 95);
  const signalCount = randomBetween(0, 10);
  const actorCount = randomBetween(0, 5);
  const contextCount = randomBetween(0, 3);
  
  const signals = [];
  for (let i = 0; i < signalCount; i++) {
    signals.push({
      id: `sig_${i}`,
      type: Math.random() > 0.5 ? 'flow_deviation' : 'behavior_regime_shift',
      deviation: Math.random() * 5,
      severity: ['low', 'medium', 'high'][randomBetween(0, 2)] as any,
      source: `actor_${randomBetween(0, 3)}`,
      metric: Math.random() > 0.5 ? 'inflow' : 'outflow',
    });
  }
  
  const actors = [];
  for (let i = 0; i < actorCount; i++) {
    actors.push({
      slug: `actor_${i}`,
      type: ['exchange', 'fund', 'whale'][randomBetween(0, 2)],
      flowDirection: ['inflow', 'outflow', 'balanced'][randomBetween(0, 2)] as any,
      signalCount: randomBetween(0, 5),
      contextCount: randomBetween(0, 2),
    });
  }
  
  const contexts = [];
  for (let i = 0; i < contextCount; i++) {
    contexts.push({
      id: `ctx_${i}`,
      overlapScore: randomBetween(1, 8),
      primarySignalType: 'flow_deviation',
      involvedActors: [`actor_${randomBetween(0, 3)}`],
      summary: 'Random context',
    });
  }
  
  return {
    id: `input_mc_${Date.now()}`,
    asset: {
      address: '0x' + Math.random().toString(16).slice(2, 42),
      symbol: 'TEST',
    },
    window: '24h',
    signals,
    actors,
    contexts,
    graphStats: {
      totalNodes: randomBetween(0, 20),
      totalEdges: randomBetween(0, 50),
      topCorridors: [],
    },
    coverage: {
      contexts: coverage,
      actors: coverage,
      signals: coverage,
      overall: coverage,
    },
    createdAt: new Date(),
  };
}

// ============ HELPERS ============

function calculateSummary(results: SimulationResult['results']): SimulationResult['summary'] {
  const buy = results.filter(r => r.decision === 'BUY').length;
  const sell = results.filter(r => r.decision === 'SELL').length;
  const neutral = results.filter(r => r.decision === 'NEUTRAL').length;
  
  const total = results.length || 1;
  
  return {
    buy,
    sell,
    neutral,
    avgEvidence: results.reduce((sum, r) => sum + r.evidence, 0) / total,
    avgRisk: results.reduce((sum, r) => sum + r.risk, 0) / total,
    avgCoverage: results.reduce((sum, r) => sum + r.coverage, 0) / total,
  };
}
