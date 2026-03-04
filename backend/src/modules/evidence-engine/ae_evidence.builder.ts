/**
 * AE BRAIN EVIDENCE BUILDER — P4.2
 * 
 * Builds explainability pack for AE Brain state.
 * Answers: Why is the regime X? What's the scenario distribution? What drives transitions?
 */

import type { 
  AeEvidencePack, 
  EvidenceDriver, 
  EvidenceDelta, 
  EvidenceConflict,
  EvidenceFlipCondition 
} from './evidence.contract.js';

// ═══════════════════════════════════════════════════════════════
// INTERPRETATION MAPS
// ═══════════════════════════════════════════════════════════════

const REGIME_INTERPRETATIONS: Record<string, { description: string; risk: string }> = {
  'RISK_ON_GROWTH': {
    description: 'Growth-driven risk-on environment',
    risk: 'Full position sizes appropriate',
  },
  'RISK_ON_MOMENTUM': {
    description: 'Momentum-driven rally, less fundamentals',
    risk: 'Position sizes slightly reduced for fragility',
  },
  'NEUTRAL': {
    description: 'No clear directional bias',
    risk: 'Reduced position sizes, wait for clarity',
  },
  'RISK_OFF_FEAR': {
    description: 'Fear-driven selloff, often overshooting',
    risk: 'Defensive positions, potential reversal candidate',
  },
  'RISK_OFF_STRESS': {
    description: 'Credit stress regime, systemic risk elevated',
    risk: 'Minimal positions, capital preservation priority',
  },
};

const SCENARIO_EXPLANATIONS: Record<string, string> = {
  'bull': 'Upside scenario - continuation of positive trend or reversal from oversold',
  'base': 'Base scenario - range-bound or modest continuation',
  'bear': 'Downside scenario - risk-off continuation or growth slowdown',
};

// ═══════════════════════════════════════════════════════════════
// MAIN BUILDER
// ═══════════════════════════════════════════════════════════════

interface AeTerminalOutput {
  state: {
    asOf: string;
    vector: {
      macroSigned: number;
      macroConfidence: number;
      guardLevel: number;
      dxySignalSigned: number;
      dxyConfidence: number;
      regimeBias90d: number;
      liquidityImpulse: number;
    };
  };
  regime: string;
  novelty: number;
  nearest: Array<{ cluster: string; similarity: number }>;
  scenario?: {
    weights: { bull: number; base: number; bear: number };
    dominant: string;
  };
  transition?: {
    selfTransition: number;
    nextMostLikely: { state: string; probability: number };
  };
}

export function buildAeEvidence(terminal: AeTerminalOutput): AeEvidencePack {
  const { state, regime, novelty, scenarios } = terminal;
  const vector = state.vector;
  
  // Normalize regime to string
  const regimeStr = typeof regime === 'string' ? regime : (regime as any)?.regime || 'NEUTRAL';
  
  // Normalize novelty
  const noveltyScore = typeof novelty === 'number' ? novelty : (novelty as any)?.score || 0;
  const nearest = (novelty as any)?.nearest || [];
  
  // Normalize scenarios
  const scenarioList = (scenarios as any)?.scenarios || scenarios || [];
  let scenario: AeTerminalOutput['scenario'] | undefined;
  if (Array.isArray(scenarioList) && scenarioList.length > 0) {
    const bull = scenarioList.find((s: any) => s.name?.includes('BULL'))?.prob || 0.25;
    const bear = scenarioList.find((s: any) => s.name?.includes('BEAR'))?.prob || 0.25;
    const base = scenarioList.find((s: any) => s.name === 'BASE')?.prob || 0.5;
    const dominant = bull > base && bull > bear ? 'bull' : bear > base ? 'bear' : 'base';
    scenario = { weights: { bull, base, bear }, dominant };
  }
  
  // Build headline
  const headline = buildHeadline(regimeStr, noveltyScore, scenario);
  
  // Build regime summary
  const regimeSummary = buildRegimeSummary(regimeStr, vector);
  
  // Build key drivers from state vector
  const keyDrivers = buildKeyDrivers(vector);
  
  // Build deltas (trend analysis)
  const deltas = buildDeltas(vector);
  
  // Build conflicts
  const conflicts = buildConflicts(vector, regimeStr);
  
  // Build flip conditions
  const whatWouldFlip = buildFlipConditions(regimeStr, vector);
  
  // Build state summary
  const stateSummary = {
    regime: regimeStr,
    novelty: Math.round(noveltyScore * 100) / 100,
    nearestCluster: nearest[0]?.cluster || 'Unknown',
  };
  
  // Build transition analysis (simplified without historical data)
  const transitionAnalysis = {
    selfTransition: 0.9,
    mostLikelyNext: 'Current regime persists',
    probability: 0.9,
  };
  
  // Build scenario weights
  const scenarioWeights = buildScenarioWeights(scenario);
  
  // Determine confidence
  const confidence = determineConfidence(vector, nearest, noveltyScore);
  
  return {
    type: 'AE_BRAIN',
    headline,
    regimeSummary,
    keyDrivers,
    deltas,
    conflicts,
    whatWouldFlip,
    confidence,
    computedAt: new Date().toISOString(),
    stateSummary,
    transitionAnalysis,
    scenarioWeights,
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILDERS
// ═══════════════════════════════════════════════════════════════

function buildHeadline(regime: string, novelty: number, scenario?: AeTerminalOutput['scenario']): string {
  const regimeInfo = REGIME_INTERPRETATIONS[regime] || { description: 'Unknown regime', risk: 'Uncertain' };
  
  let noveltyNote = '';
  if (novelty > 0.5) noveltyNote = ' (HIGH NOVELTY - unusual conditions)';
  else if (novelty > 0.3) noveltyNote = ' (elevated novelty)';
  
  const scenarioNote = scenario?.dominant 
    ? `. ${scenario.dominant.toUpperCase()} scenario dominant (${Math.round(scenario.weights[scenario.dominant as keyof typeof scenario.weights] * 100)}%)`
    : '';
  
  return `${regimeInfo.description}${noveltyNote}${scenarioNote}`;
}

function buildRegimeSummary(regime: string, vector: AeTerminalOutput['state']['vector']): string {
  const regimeInfo = REGIME_INTERPRETATIONS[regime] || { description: 'Unknown', risk: 'Uncertain' };
  
  const guardNote = vector.guardLevel >= 2 
    ? 'Guard is in CRISIS mode, limiting exposure. '
    : vector.guardLevel >= 1 
    ? 'Guard is in WARN mode, modestly reducing exposure. '
    : '';
  
  const liquidityNote = vector.liquidityImpulse > 0.1
    ? 'Fed liquidity is expansionary, supporting risk. '
    : vector.liquidityImpulse < -0.1
    ? 'Fed liquidity is contractionary, headwind for risk. '
    : '';
  
  return `Current regime: ${regime}. ${regimeInfo.risk}. ${guardNote}${liquidityNote}`;
}

function buildKeyDrivers(vector: AeTerminalOutput['state']['vector']): EvidenceDriver[] {
  const drivers: EvidenceDriver[] = [];
  
  // Macro signed
  drivers.push({
    id: 'macro_signed',
    displayName: 'Macro Score',
    contribution: vector.macroSigned,
    contributionPct: Math.round(Math.abs(vector.macroSigned) * 25),
    direction: vector.macroSigned > 0.05 ? 'POSITIVE' : vector.macroSigned < -0.05 ? 'NEGATIVE' : 'NEUTRAL',
    explanation: vector.macroSigned > 0.1 
      ? 'Strong macro tailwind supporting USD' 
      : vector.macroSigned < -0.1
      ? 'Macro headwind pressuring USD'
      : 'Neutral macro environment',
  });
  
  // Guard level
  drivers.push({
    id: 'guard_level',
    displayName: 'Crisis Guard',
    contribution: -vector.guardLevel * 0.2,
    contributionPct: Math.round(vector.guardLevel * 15),
    direction: vector.guardLevel >= 2 ? 'NEGATIVE' : vector.guardLevel >= 1 ? 'NEGATIVE' : 'NEUTRAL',
    explanation: vector.guardLevel >= 2
      ? 'CRISIS guard active - significant position reduction'
      : vector.guardLevel >= 1
      ? 'WARN guard active - modest position reduction'
      : 'No crisis guard triggers',
  });
  
  // Liquidity impulse
  drivers.push({
    id: 'liquidity_impulse',
    displayName: 'Fed Liquidity',
    contribution: vector.liquidityImpulse,
    contributionPct: Math.round(Math.abs(vector.liquidityImpulse) * 20),
    direction: vector.liquidityImpulse > 0.1 ? 'POSITIVE' : vector.liquidityImpulse < -0.1 ? 'NEGATIVE' : 'NEUTRAL',
    explanation: vector.liquidityImpulse > 0.2
      ? 'Strong liquidity expansion (QE-like)'
      : vector.liquidityImpulse > 0
      ? 'Modest liquidity support'
      : vector.liquidityImpulse < -0.2
      ? 'Significant liquidity drain (QT)'
      : vector.liquidityImpulse < 0
      ? 'Modest liquidity headwind'
      : 'Neutral liquidity conditions',
  });
  
  // DXY signal
  if (Math.abs(vector.dxySignalSigned) > 0.05) {
    drivers.push({
      id: 'dxy_signal',
      displayName: 'DXY Fractal Signal',
      contribution: vector.dxySignalSigned,
      contributionPct: Math.round(Math.abs(vector.dxySignalSigned) * 15),
      direction: vector.dxySignalSigned > 0 ? 'POSITIVE' : 'NEGATIVE',
      explanation: vector.dxySignalSigned > 0 
        ? 'DXY fractal pattern suggests USD strength'
        : 'DXY fractal pattern suggests USD weakness',
    });
  }
  
  // Regime bias
  if (Math.abs(vector.regimeBias90d) > 0.05) {
    drivers.push({
      id: 'regime_bias',
      displayName: '90d Regime Bias',
      contribution: vector.regimeBias90d,
      contributionPct: Math.round(Math.abs(vector.regimeBias90d) * 10),
      direction: vector.regimeBias90d > 0 ? 'POSITIVE' : 'NEGATIVE',
      explanation: vector.regimeBias90d > 0
        ? 'Recent 90d trend has bullish bias'
        : 'Recent 90d trend has bearish bias',
    });
  }
  
  return drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

function buildDeltas(vector: AeTerminalOutput['state']['vector']): EvidenceDelta[] {
  // Note: Real implementation would track historical changes
  return [
    {
      metric: 'Macro Score',
      current: vector.macroSigned,
      change3m: null,
      change12m: null,
      trend: vector.macroSigned > 0.1 ? 'RISING' : vector.macroSigned < -0.1 ? 'FALLING' : 'STABLE',
    },
    {
      metric: 'Guard Level',
      current: vector.guardLevel,
      change3m: null,
      change12m: null,
      trend: vector.guardLevel >= 2 ? 'RISING' : 'STABLE',
    },
    {
      metric: 'Liquidity Impulse',
      current: vector.liquidityImpulse,
      change3m: null,
      change12m: null,
      trend: vector.liquidityImpulse > 0.1 ? 'RISING' : vector.liquidityImpulse < -0.1 ? 'FALLING' : 'STABLE',
    },
  ];
}

function buildConflicts(vector: AeTerminalOutput['state']['vector'], regime: string): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = [];
  
  // Macro vs Liquidity conflict
  if (vector.macroSigned > 0.1 && vector.liquidityImpulse < -0.1) {
    conflicts.push({
      driver1: 'Macro Score',
      driver2: 'Fed Liquidity',
      description: 'Macro is bullish but Fed is draining liquidity',
      resolution: 'Liquidity often leads; macro strength may fade',
    });
  } else if (vector.macroSigned < -0.1 && vector.liquidityImpulse > 0.1) {
    conflicts.push({
      driver1: 'Macro Score',
      driver2: 'Fed Liquidity',
      description: 'Macro is bearish but Fed is adding liquidity',
      resolution: 'Liquidity support may override macro weakness',
    });
  }
  
  // Guard vs regime conflict
  if (vector.guardLevel >= 2 && regime.includes('RISK_ON')) {
    conflicts.push({
      driver1: 'Crisis Guard',
      driver2: 'Regime Classification',
      description: 'Guard is in crisis mode but regime shows risk-on',
      resolution: 'Guard takes precedence; treat as transitional state',
    });
  }
  
  return conflicts;
}

function buildFlipConditions(regime: string, vector: AeTerminalOutput['state']['vector']): EvidenceFlipCondition[] {
  const conditions: EvidenceFlipCondition[] = [];
  
  if (regime.includes('RISK_ON')) {
    conditions.push({
      condition: 'Guard upgrades to CRISIS level (VIX spike or credit stress)',
      likelihood: 'MEDIUM',
      timeframe: 'Days to weeks',
    });
    conditions.push({
      condition: 'Macro score deteriorates below -0.2 (Fed hawkish pivot)',
      likelihood: 'LOW',
      timeframe: '1-3 months',
    });
  } else if (regime.includes('RISK_OFF')) {
    conditions.push({
      condition: 'Guard downgrades to NONE (VIX normalizes, credit spreads compress)',
      likelihood: 'MEDIUM',
      timeframe: 'Weeks to months',
    });
    conditions.push({
      condition: 'Fed announces liquidity support program',
      likelihood: 'LOW',
      timeframe: 'Event-driven',
    });
  } else {
    conditions.push({
      condition: 'Clear macro direction emerges (score > 0.15 or < -0.15)',
      likelihood: 'MEDIUM',
      timeframe: '2-6 weeks',
    });
  }
  
  // Novelty reduction
  conditions.push({
    condition: 'Novelty score drops below 0.2 (market returns to familiar state)',
    likelihood: 'MEDIUM',
    timeframe: 'Weeks',
  });
  
  return conditions;
}

function buildTransitionAnalysis(transition?: AeTerminalOutput['transition']): AeEvidencePack['transitionAnalysis'] {
  if (!transition) {
    return {
      selfTransition: 0.9,
      mostLikelyNext: 'Current regime persists',
      probability: 0.9,
    };
  }
  
  return {
    selfTransition: Math.round(transition.selfTransition * 100) / 100,
    mostLikelyNext: transition.nextMostLikely.state,
    probability: Math.round(transition.nextMostLikely.probability * 100) / 100,
  };
}

function buildScenarioWeights(scenario?: AeTerminalOutput['scenario']): AeEvidencePack['scenarioWeights'] {
  if (!scenario) {
    return {
      bull: 0.25,
      base: 0.5,
      bear: 0.25,
      dominant: 'base',
      reasoning: 'Default neutral scenario distribution',
    };
  }
  
  const { weights, dominant } = scenario;
  
  let reasoning = SCENARIO_EXPLANATIONS[dominant] || 'Unknown scenario';
  
  // Add reasoning about why this scenario dominates
  if (dominant === 'bull' && weights.bull > 0.4) {
    reasoning += '. Conditions favor upside: strong momentum, low guard, supportive liquidity.';
  } else if (dominant === 'bear' && weights.bear > 0.4) {
    reasoning += '. Conditions favor downside: negative momentum, elevated guard, liquidity headwinds.';
  } else if (dominant === 'base') {
    reasoning += '. Mixed conditions lead to base case: neither clear bull nor bear setup.';
  }
  
  return {
    bull: Math.round(weights.bull * 100) / 100,
    base: Math.round(weights.base * 100) / 100,
    bear: Math.round(weights.bear * 100) / 100,
    dominant,
    reasoning,
  };
}

function determineConfidence(
  vector: AeTerminalOutput['state']['vector'],
  nearest: AeTerminalOutput['nearest'],
  novelty: number
): 'HIGH' | 'MEDIUM' | 'LOW' {
  // High novelty = low confidence
  if (novelty > 0.5) return 'LOW';
  if (novelty > 0.3) return 'MEDIUM';
  
  // Low similarity to nearest cluster = low confidence
  if (nearest.length > 0 && nearest[0].similarity < 0.7) return 'LOW';
  if (nearest.length > 0 && nearest[0].similarity < 0.85) return 'MEDIUM';
  
  // Low macro confidence = medium confidence
  if (vector.macroConfidence < 0.5) return 'MEDIUM';
  
  return 'HIGH';
}
