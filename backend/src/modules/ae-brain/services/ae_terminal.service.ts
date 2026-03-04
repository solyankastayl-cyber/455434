/**
 * AE Terminal Service — Main Orchestrator
 * Aggregates C1-C5 into unified terminal output
 */

import type { AeTerminal, GuardMode, AeClusterInfo, AeTransitionInfo } from '../contracts/ae_terminal.contract.js';
import { buildAeState } from './ae_state.service.js';
import { classifyRegime } from './ae_regime.service.js';
import { buildCausalGraph, getKeyDrivers } from './ae_causal.service.js';
import { buildScenarios } from './ae_scenarios.service.js';
import { computeNovelty, snapshotState, getStateFromDB } from './ae_novelty.service.js';
import { clamp } from '../utils/ae_math.js';

// C7 & C8 imports
import { getCurrentCluster } from '../cluster/services/cluster.service.js';
import { getTransitionPack } from '../transition/services/transition.service.js';

// Guard level to mode mapping
const GUARD_LEVEL_TO_MODE: Record<number, GuardMode> = {
  0: 'NONE',
  0.33: 'WARN',
  0.66: 'CRISIS',
  1: 'BLOCK',
};

function getGuardMode(level: number): GuardMode {
  if (level >= 0.9) return 'BLOCK';
  if (level >= 0.5) return 'CRISIS';
  if (level >= 0.2) return 'WARN';
  return 'NONE';
}

/**
 * Build complete AE Terminal pack
 */
export async function buildAeTerminal(asOf?: string): Promise<AeTerminal> {
  const computedAt = new Date().toISOString();
  const today = asOf || new Date().toISOString().split('T')[0];
  
  try {
    // C1: Build State (prefer historical if available)
    let state = await getStateFromDB(today);
    if (!state) {
      state = await buildAeState(today);
    }
    
    // C2: Classify Regime
    const regime = classifyRegime(state);
    
    // C3: Build Causal Graph
    const causal = buildCausalGraph(state);
    
    // C4: Build Scenarios
    const scenarios = buildScenarios(state, regime);
    
    // C5: Compute Novelty (using current state)
    const novelty = await computeNovelty(today, state);
    
    // C7: Get Cluster info
    let cluster: AeClusterInfo | undefined;
    try {
      const clusterResult = await getCurrentCluster(today);
      if (clusterResult) {
        cluster = {
          clusterId: clusterResult.clusterId,
          label: clusterResult.label,
          distance: clusterResult.distance,
        };
      }
    } catch (e) {
      console.warn('[AE Terminal] Cluster unavailable:', (e as Error).message);
    }
    
    // C8: Get Transition info
    let transition: AeTransitionInfo | undefined;
    try {
      const transitionPack = await getTransitionPack(cluster?.label);
      if (transitionPack && transitionPack.derived) {
        const d = transitionPack.derived;
        const currentDuration = transitionPack.durations.find(
          dur => dur.label === d.currentLabel
        );
        
        transition = {
          currentLabel: d.currentLabel,
          mostLikelyNext: d.mostLikelyNext,
          mostLikelyNextProb: d.mostLikelyNextProb,
          selfTransitionProb: d.selfTransitionProb,
          riskToStress: {
            p1w: d.riskToStress.p1w,
            p2w: d.riskToStress.p2w,
            p4w: d.riskToStress.p4w,
          },
          medianDurationWeeks: currentDuration?.medianWeeks || 0,
        };
      }
    } catch (e) {
      console.warn('[AE Terminal] Transition unavailable:', (e as Error).message);
    }
    
    // Recommendation
    const sizeMultiplier = clamp(1 - 0.6 * state.vector.guardLevel, 0, 1);
    const guardMode = getGuardMode(state.vector.guardLevel);
    
    const notes: string[] = [];
    if (guardMode === 'BLOCK') {
      notes.push('Trading blocked — extreme stress');
    } else if (guardMode === 'CRISIS') {
      notes.push('Reduced exposure — crisis mode');
    } else if (guardMode === 'WARN') {
      notes.push('Elevated caution — warning level');
    }
    
    if (novelty.novelty === 'UNSEEN') {
      notes.push('ALERT: Unseen configuration — extra caution');
    } else if (novelty.novelty === 'RARE') {
      notes.push('Note: Rare market configuration');
    }
    
    // Add transition warning if stress risk is high
    if (transition && transition.riskToStress.p4w > 0.25) {
      notes.push(`Elevated 4-week stress risk: ${(transition.riskToStress.p4w * 100).toFixed(1)}%`);
    }
    
    // Explanation
    const keyDrivers = getKeyDrivers(causal);
    const headline = buildHeadline(regime.regime, state.vector.dxySignalSigned, guardMode);
    
    return {
      ok: true,
      asOf: today,
      state,
      regime,
      causal,
      scenarios,
      novelty,
      cluster,        // C7
      transition,     // C8
      recommendation: {
        sizeMultiplier: Math.round(sizeMultiplier * 100) / 100,
        guard: guardMode,
        notes,
      },
      explain: {
        headline,
        drivers: keyDrivers,
        limits: ['SPX/BTC integration pending (D-Track)'],
      },
      computedAt,
    };
  } catch (e) {
    console.error('[AE Terminal] Build failed:', (e as Error).message);
    throw e;
  }
}

/**
 * Build headline based on regime and signals
 */
function buildHeadline(
  regime: string,
  dxySignal: number,
  guard: GuardMode
): string {
  const dxyBias = dxySignal > 0.15 ? 'USD supportive' : 
                  dxySignal < -0.15 ? 'USD weakness' : 
                  'USD neutral';
  
  switch (regime) {
    case 'RISK_OFF_STRESS':
      return `Crisis regime: ${dxyBias}, risk assets under pressure`;
    case 'DOLLAR_DOMINANCE':
      return `Dollar dominance: hawkish policy, ${dxyBias}`;
    case 'LIQUIDITY_EXPANSION':
      return `Liquidity expansion: dovish regime, risk-on window`;
    case 'LIQUIDITY_CONTRACTION':
      return `Liquidity tightening: ${dxyBias}, elevated caution`;
    case 'DISINFLATION_PIVOT':
      return `Disinflation signals: potential policy pivot`;
    default:
      return `Mixed signals: ${dxyBias}, no dominant regime`;
  }
}

/**
 * Quick health check for AE Brain
 */
export async function getAeBrainHealth(): Promise<{
  ok: boolean;
  module: string;
  version: string;
  components: string[];
}> {
  return {
    ok: true,
    module: 'ae-brain',
    version: 'C1-C5',
    components: ['state', 'regime', 'causal', 'scenarios', 'novelty'],
  };
}
