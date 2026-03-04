/**
 * Engine Service (Sprint 4 - v1 + Actor Signals v1)
 * 
 * Склеивает всё: signals → contexts → flows → actor signals → decision
 * Engine НЕ читает raw tx — только готовые слои.
 */
import { EngineInput, EngineDecision, EngineResponse, EngineCTA } from './engine.types.js';
import { evaluateEngineDecision } from './engine.rules.js';
import { logEngineDecision } from './engine.decision.logger.js';
import { SignalContextModel } from '../signals/signal_context.model.js';
import { ActorSignalModel } from '../signals/actor_signal.model.js';
import { ComputedGraphModel } from '../actors/computed_graph.model.js';
import { resolveToken } from '../resolver/token.resolver.js';
import { getWindowCutoff, TimeWindow } from '../common/window.service.js';

// Actor Signals v1 imports
import {
  collectActorSignals,
  applyActorSignals,
  createInitialEngineState,
  formatEngineOutput,
} from '../signals/actorSignalAdapter.service.js';

/**
 * Build EngineInput from existing data layers
 */
export async function buildEngineInput(
  assetAddress: string,
  window: TimeWindow
): Promise<EngineInput> {
  const cutoff = getWindowCutoff(window);
  const checked: string[] = [];

  // Resolve asset
  const tokenInfo = await resolveToken(assetAddress);
  const asset = {
    address: tokenInfo.address,
    symbol: tokenInfo.symbol,
  };

  // Get contexts
  const contexts = await SignalContextModel.find({
    status: 'active',
  })
    .sort({ overlapScore: -1 })
    .limit(5)
    .lean();

  checked.push('contexts');

  const engineContexts = contexts.map((c: any) => ({
    id: c._id.toString(),
    overlapScore: c.overlapScore || 0,
    primarySignalType: c.primarySignal?.type || 'unknown',
    involvedActors: c.involvedActors || [],
  }));

  // Get signals
  const signals = await ActorSignalModel.find({
    status: 'active',
    detectedAt: { $gte: cutoff },
  })
    .sort({ severity: -1 })
    .limit(20)
    .lean();

  checked.push('signals');

  const engineSignals = signals.map((s: any) => ({
    type: s.signalType,
    deviation: s.deviation || 0,
    severity: s.severity || 'low',
    source: s.actorSlug || 'unknown',
  }));

  // Get graph/corridors
  const graph = await ComputedGraphModel.findOne({ window: '7d' }).lean();
  checked.push('graph');

  const corridors = (graph as any)?.edges
    ?.filter((e: any) => e.flow?.volumeUsd > 50000)
    ?.slice(0, 10)
    ?.map((e: any) => ({
      from: e.from,
      to: e.to,
      volumeUsd: e.flow?.volumeUsd || 0,
      type: e.flow?.volumeUsd > 100000 ? 'corridor_volume_spike' : 'normal',
    })) || [];

  // Calculate flows from signals
  let netFlowUsd = 0;
  let deviation = 0;
  
  for (const sig of engineSignals) {
    if (sig.type === 'flow_deviation') {
      if (sig.source && sig.deviation) {
        // Inflow signals add positive, outflow negative
        const flowDir = engineSignals.some(
          s => s.source === sig.source && s.type === 'flow_deviation'
        ) ? -1 : 1;
        netFlowUsd += flowDir * (sig.deviation * 10000);
        deviation = Math.max(deviation, sig.deviation);
      }
    }
  }

  checked.push('flows');

  // Calculate coverage
  const coverageFactors = [
    contexts.length > 0 ? 30 : 0,
    signals.length > 0 ? 30 : 0,
    corridors.length > 0 ? 20 : 0,
    graph ? 20 : 0,
  ];
  const coveragePercent = coverageFactors.reduce((a, b) => a + b, 0);

  return {
    asset,
    window,
    signals: engineSignals,
    contexts: engineContexts,
    corridors,
    flows: {
      netFlowUsd,
      deviation,
    },
    coverage: {
      percent: coveragePercent,
      checked,
    },
  };
}

/**
 * Run Engine and return full response (with Actor Signals v1)
 */
export async function runEngine(
  assetAddress: string,
  window: TimeWindow
): Promise<EngineResponse> {
  // Build input from existing layers
  const input = await buildEngineInput(assetAddress, window);

  // Evaluate base decision (original rules)
  const baseDecision = evaluateEngineDecision(input);

  // ========== ACTOR SIGNALS V1 INTEGRATION ==========
  try {
    // Collect all actor signals
    const actorSignals = await collectActorSignals(assetAddress);

    // Create initial engine state from base decision
    const initialState = createInitialEngineState();
    
    // Map base decision to engine state
    initialState.evidence = input.signals.length * 5;
    initialState.direction = baseDecision.label === 'BUY' ? 20 : 
                              baseDecision.label === 'SELL' ? -20 : 0;
    initialState.risk = baseDecision.risks.length * 15;
    initialState.confidence = input.coverage.percent;
    initialState.label = baseDecision.label;
    initialState.reasons = baseDecision.why.map(w => w.title);

    // Apply actor signals to modify the decision
    const enhancedState = applyActorSignals(initialState, actorSignals);
    
    // Format output
    const actorEnhancedOutput = formatEngineOutput(enhancedState);

    // Build enhanced decision
    const enhancedDecision: EngineDecision = {
      label: actorEnhancedOutput.label,
      strength: actorEnhancedOutput.confidence >= 70 ? 'high' :
                actorEnhancedOutput.confidence >= 50 ? 'medium' : 'low',
      mode: 'rule_v1',
      why: [
        ...baseDecision.why,
        ...actorEnhancedOutput.reasons.map(r => ({
          title: r,
          evidence: 'Actor Signals v1',
          source: 'actors' as const,
        })),
      ],
      risks: baseDecision.risks,
    };

    // Log enhanced decision (for ML training)
    await logEngineDecision(input, enhancedDecision);

    // Build CTAs
    const cta: EngineCTA = {
      viewContexts: `/signals?tab=contextual`,
      viewActors: `/actors`,
      createAlert: `/alerts?prefill=${input.asset.symbol || input.asset.address}`,
    };

    return {
      status: 'completed',
      window,
      coverage: {
        pct: input.coverage.percent,
        checked: input.coverage.checked,
      },
      decision: enhancedDecision,
      inputsUsed: {
        actorSignals: input.signals.length + (actorSignals.dex ? 1 : 0) + (actorSignals.whale ? 1 : 0),
        contexts: input.contexts.length,
        corridors: input.corridors.length,
      },
      cta,
    };

  } catch (error) {
    console.error('[Engine] Actor Signals v1 failed, falling back to base decision:', error);
    
    // Fallback to base decision if actor signals fail
    await logEngineDecision(input, baseDecision);

    const cta: EngineCTA = {
      viewContexts: `/signals?tab=contextual`,
      viewActors: `/actors`,
      createAlert: `/alerts?prefill=${input.asset.symbol || input.asset.address}`,
    };

    return {
      status: 'completed',
      window,
      coverage: {
        pct: input.coverage.percent,
        checked: input.coverage.checked,
      },
      decision: baseDecision,
      inputsUsed: {
        actorSignals: input.signals.length,
        contexts: input.contexts.length,
        corridors: input.corridors.length,
      },
      cta,
    };
  }
}
