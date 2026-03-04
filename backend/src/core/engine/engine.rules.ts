/**
 * Engine Rules v1 (Sprint 4)
 * 
 * Вся логика принятия решения.
 * Просто. Объяснимо. Без магии.
 * 
 * BUY:
 * - ≥1 flow_deviation (outflow ↓)
 * - ≥1 context с ≥2 signal types
 * - coverage ≥ 60%
 * 
 * SELL:
 * - ≥1 flow_deviation (inflow ↑)
 * - corridor spike от exchange actor
 * - coverage ≥ 60%
 * 
 * NEUTRAL:
 * - Всё остальное
 * - ИЛИ coverage < 60%
 * 
 * strength = количество совпавших правил, не "уверенность"
 */
import { EngineDecision, EngineInput, EngineWhy, EngineRisk } from './engine.types.js';

// Minimum coverage threshold
const MIN_COVERAGE = 60;

export function evaluateEngineDecision(input: EngineInput): EngineDecision {
  const why: EngineWhy[] = [];
  const risks: EngineRisk[] = [];

  // ========== COVERAGE CHECK ==========
  const coverageOk = input.coverage.percent >= MIN_COVERAGE;

  if (!coverageOk) {
    risks.push({
      title: 'Insufficient data coverage',
      evidence: `Only ${input.coverage.percent}% of required data available (need ≥${MIN_COVERAGE}%)`
    });

    return {
      label: 'NEUTRAL',
      strength: 'low',
      mode: 'rule_v1',
      why: [{
        title: 'Insufficient coverage to form directional decision',
        evidence: `Coverage ${input.coverage.percent}% below threshold`,
        source: 'flows'
      }],
      risks
    };
  }

  // ========== FLOW ANALYSIS ==========
  const flowOutflow = input.flows.netFlowUsd < 0;
  const flowInflow = input.flows.netFlowUsd > 0;
  const flowDeviation = Math.abs(input.flows.deviation);

  // ========== CONTEXT ANALYSIS ==========
  const hasContexts = input.contexts.length >= 1;
  const multiSignalContexts = input.contexts.filter(c => c.overlapScore >= 3);
  const hasMultiSignalContext = multiSignalContexts.length >= 1;

  // ========== CORRIDOR ANALYSIS ==========
  const hasCorridorSpike = input.corridors.some(
    c => c.type === 'corridor_volume_spike' || c.volumeUsd > 100000
  );

  // ========== SIGNAL ANALYSIS ==========
  const flowDeviationSignals = input.signals.filter(s => s.type === 'flow_deviation');
  const hasFlowDeviationSignal = flowDeviationSignals.length >= 1;
  const highSeveritySignals = input.signals.filter(s => s.severity === 'high');

  // ========== BUY LOGIC ==========
  // Net outflow + context support = potential accumulation signal
  if (flowOutflow && hasContexts) {
    why.push({
      title: 'Net outflow detected',
      evidence: `Net outflow of $${Math.abs(input.flows.netFlowUsd).toLocaleString()}`,
      source: 'flows'
    });

    if (hasMultiSignalContext) {
      why.push({
        title: 'Multi-signal context observed',
        evidence: `${multiSignalContexts.length} context(s) with overlap ≥3`,
        source: 'contexts'
      });
    }

    if (input.contexts.length > 0) {
      why.push({
        title: 'Contextual signal support',
        evidence: `${input.contexts.length} contextual signal group(s) detected`,
        source: 'contexts'
      });
    }

    // Calculate strength
    let buyStrength: 'low' | 'medium' | 'high' = 'low';
    const buyFactors = [
      hasMultiSignalContext,
      input.contexts.length >= 2,
      highSeveritySignals.length >= 1,
      flowDeviation > 2
    ].filter(Boolean).length;

    if (buyFactors >= 3) buyStrength = 'high';
    else if (buyFactors >= 2) buyStrength = 'medium';

    // Add risks
    if (input.coverage.percent < 80) {
      risks.push({
        title: 'Partial coverage',
        evidence: `Coverage ${input.coverage.percent}% may affect reliability`
      });
    }

    return {
      label: 'BUY',
      strength: buyStrength,
      mode: 'rule_v1',
      why,
      risks
    };
  }

  // ========== SELL LOGIC ==========
  // Net inflow + corridor spike = potential distribution signal
  if (flowInflow && hasCorridorSpike) {
    why.push({
      title: 'Net inflow detected',
      evidence: `Net inflow of $${input.flows.netFlowUsd.toLocaleString()}`,
      source: 'flows'
    });

    why.push({
      title: 'Corridor volume spike observed',
      evidence: 'Significant actor-to-actor transfer detected',
      source: 'graph'
    });

    if (hasFlowDeviationSignal) {
      why.push({
        title: 'Flow deviation signal',
        evidence: `${flowDeviationSignals.length} flow deviation signal(s) detected`,
        source: 'signals'
      });
    }

    // Calculate strength
    let sellStrength: 'low' | 'medium' | 'high' = 'medium';
    const sellFactors = [
      hasFlowDeviationSignal,
      input.corridors.length >= 2,
      highSeveritySignals.length >= 1
    ].filter(Boolean).length;

    if (sellFactors >= 2) sellStrength = 'high';

    // Add risks
    if (input.corridors.length === 1) {
      risks.push({
        title: 'Single corridor concentration',
        evidence: 'Signal driven by single corridor may be noise'
      });
    }

    return {
      label: 'SELL',
      strength: sellStrength,
      mode: 'rule_v1',
      why,
      risks
    };
  }

  // ========== NEUTRAL (DEFAULT) ==========
  risks.push({
    title: 'No dominant directional pattern',
    evidence: 'Observed signals do not form a directional consensus'
  });

  // Add what we did observe
  if (input.signals.length > 0) {
    why.push({
      title: 'Signals detected but inconclusive',
      evidence: `${input.signals.length} signal(s) observed without clear direction`,
      source: 'signals'
    });
  }

  if (input.contexts.length > 0) {
    why.push({
      title: 'Context exists but insufficient',
      evidence: `${input.contexts.length} context(s) without strong directional bias`,
      source: 'contexts'
    });
  }

  return {
    label: 'NEUTRAL',
    strength: 'low',
    mode: 'rule_v1',
    why,
    risks
  };
}
