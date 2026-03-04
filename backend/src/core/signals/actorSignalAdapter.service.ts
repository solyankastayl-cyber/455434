/**
 * AS-4: Actor Signal Adapter
 * 
 * Единая точка интеграции Actor Signals v1 с Decision Engine
 * Агрегирует влияние всех сигналов и применяет к engine state
 */

import {
  analyzeDEXFlow,
  calculateDEXFlowImpact,
  DEXFlowAnalysis,
  DEXFlowImpact,
} from './dexFlow.service.js';

import {
  analyzeWhaleTransfers,
  calculateWhaleImpact,
  WhaleAnalysis,
  WhaleImpact,
} from './whaleTransfer.service.js';

import {
  detectActorConflicts,
  calculateConflictImpact,
  ConflictSignal,
  ConflictImpact,
} from './actorConflict.service.js';

/**
 * Aggregated actor signals for a token
 */
export interface ActorSignals {
  dex: {
    analysis: DEXFlowAnalysis;
    impact: DEXFlowImpact;
  } | null;
  whale: {
    analysis: WhaleAnalysis;
    impact: WhaleImpact;
  } | null;
  conflict: {
    signal: ConflictSignal;
    impact: ConflictImpact;
  } | null;
}

/**
 * Engine state that will be modified by actor signals
 */
export interface EngineState {
  evidence: number;
  direction: number;
  risk: number;
  confidence: number;
  score: number;
  label: 'BUY' | 'SELL' | 'NEUTRAL';
  reasons: string[];
  forceDecision: 'NEUTRAL' | null;
}

/**
 * Собирает все Actor Signals для токена
 */
export async function collectActorSignals(
  tokenAddress: string
): Promise<ActorSignals> {
  // AS-1: DEX Flow
  let dexAnalysis: DEXFlowAnalysis | null = null;
  let dexImpact: DEXFlowImpact | null = null;
  
  try {
    dexAnalysis = await analyzeDEXFlow(tokenAddress);
    dexImpact = calculateDEXFlowImpact(dexAnalysis.window24h);
  } catch (error) {
    console.error('DEX flow analysis failed:', error);
  }

  // AS-2: Whale Transfers
  let whaleAnalysis: WhaleAnalysis | null = null;
  let whaleImpact: WhaleImpact | null = null;
  
  try {
    whaleAnalysis = await analyzeWhaleTransfers(tokenAddress);
    whaleImpact = calculateWhaleImpact(whaleAnalysis);
  } catch (error) {
    console.error('Whale transfer analysis failed:', error);
  }

  // AS-3: Conflicts (только если есть оба предыдущих сигнала)
  let conflictSignal: ConflictSignal | null = null;
  let conflictImpact: ConflictImpact | null = null;
  
  if (dexAnalysis && whaleAnalysis) {
    try {
      conflictSignal = detectActorConflicts(
        dexAnalysis.window24h,
        whaleAnalysis
      );
      conflictImpact = calculateConflictImpact(conflictSignal);
    } catch (error) {
      console.error('Conflict detection failed:', error);
    }
  }

  return {
    dex: dexAnalysis && dexImpact ? { analysis: dexAnalysis, impact: dexImpact } : null,
    whale: whaleAnalysis && whaleImpact ? { analysis: whaleAnalysis, impact: whaleImpact } : null,
    conflict: conflictSignal && conflictImpact ? { signal: conflictSignal, impact: conflictImpact } : null,
  };
}

/**
 * Применяет Actor Signals к Engine State
 * 
 * Это главная функция адаптера
 */
export function applyActorSignals(
  engineState: EngineState,
  signals: ActorSignals
): EngineState {
  const state = { ...engineState };
  const allReasons: string[] = [...state.reasons];

  // Apply DEX Flow impact
  if (signals.dex) {
    const { impact } = signals.dex;
    state.evidence += impact.evidencePoints;
    state.direction += impact.directionPoints;
    state.risk += impact.riskPoints;
    allReasons.push(...impact.reasons);
  }

  // Apply Whale impact
  if (signals.whale) {
    const { impact } = signals.whale;
    state.evidence += impact.evidencePoints;
    state.direction += impact.directionPoints;
    state.risk += impact.riskPoints;
    state.confidence += impact.confidencePoints;
    allReasons.push(...impact.reasons);
  }

  // Apply Conflict impact (может forced NEUTRAL!)
  if (signals.conflict) {
    const { impact } = signals.conflict;
    state.confidence += impact.confidencePoints;
    state.risk += impact.riskPoints;
    
    // CRITICAL: Force decision if conflict score is too high
    if (impact.forceDecision === 'NEUTRAL') {
      state.forceDecision = 'NEUTRAL';
    }
    
    allReasons.push(...impact.reasons);
  }

  // Recalculate final score
  state.score = state.evidence + state.direction - state.risk;

  // Determine label based on new score and rules
  state.label = determineLabel(state);
  state.reasons = allReasons;

  return state;
}

/**
 * Определяет финальный label (BUY/SELL/NEUTRAL)
 */
function determineLabel(state: EngineState): 'BUY' | 'SELL' | 'NEUTRAL' {
  // FORCE NEUTRAL if conflicts are critical
  if (state.forceDecision === 'NEUTRAL') {
    return 'NEUTRAL';
  }

  // BUY conditions
  if (
    state.score >= 30 &&
    state.confidence >= 60 &&
    state.risk < 50
  ) {
    return 'BUY';
  }

  // SELL conditions
  if (
    state.score <= -30 ||
    state.risk >= 70
  ) {
    return 'SELL';
  }

  // Default to NEUTRAL
  return 'NEUTRAL';
}

/**
 * Создает начальный Engine State (нейтральный)
 */
export function createInitialEngineState(): EngineState {
  return {
    evidence: 0,
    direction: 0,
    risk: 0,
    confidence: 50, // Neutral starting point
    score: 0,
    label: 'NEUTRAL',
    reasons: [],
    forceDecision: null,
  };
}

/**
 * Форматирует Engine State для вывода пользователю
 */
export function formatEngineOutput(state: EngineState) {
  return {
    label: state.label,
    score: Math.round(state.score),
    confidence: Math.round(Math.max(0, Math.min(100, state.confidence))),
    risk: Math.round(Math.max(0, Math.min(100, state.risk))),
    reasons: state.reasons,
    breakdown: {
      evidence: Math.round(state.evidence),
      direction: Math.round(state.direction),
      riskRaw: Math.round(state.risk),
    },
  };
}
