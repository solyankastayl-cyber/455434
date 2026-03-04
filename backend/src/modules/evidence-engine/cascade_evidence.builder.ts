/**
 * CASCADE EVIDENCE BUILDER — P4.3
 * 
 * Builds explainability pack for SPX/BTC cascade sizing.
 * Answers: Why is position size X? What multipliers drive it? How does guard affect it?
 */

import type { 
  CascadeEvidencePack, 
  EvidenceDriver, 
  EvidenceDelta, 
  EvidenceConflict,
  EvidenceFlipCondition 
} from './evidence.contract.js';

// ═══════════════════════════════════════════════════════════════
// MULTIPLIER EXPLANATIONS
// ═══════════════════════════════════════════════════════════════

const MULTIPLIER_EXPLANATIONS = {
  mStress: {
    high: (v: number) => `High stress probability (${Math.round(v * 100)}%), significantly reducing size`,
    medium: (v: number) => `Moderate stress probability, modestly reducing size`,
    low: (v: number) => `Low stress probability, maintaining near-full size`,
  },
  mPersistence: {
    high: (v: number) => `High regime persistence (${Math.round(v * 100)}% self-transition), stable environment`,
    medium: (v: number) => `Moderate persistence, some transition uncertainty`,
    low: (v: number) => `Low persistence, high transition risk - reducing size`,
  },
  mNovelty: {
    high: (v: number) => `High novelty state (${Math.round(v * 100)}%), unusual conditions - reducing size`,
    medium: (v: number) => `Moderate novelty, some unfamiliarity`,
    low: (v: number) => `Familiar market state, no novelty penalty`,
  },
  mScenario: {
    bull: (v: number) => `Bull scenario dominant (${Math.round(v * 100)}%), increasing size`,
    bear: (v: number) => `Bear scenario dominant, reducing size for downside protection`,
    balanced: (v: number) => `Balanced scenario distribution, neutral sizing`,
  },
  mLiquidity: {
    expansion: (v: number) => `Fed liquidity expansion (+${Math.round((v - 1) * 100)}% adjustment)`,
    contraction: (v: number) => `Fed liquidity contraction (${Math.round((v - 1) * 100)}% adjustment)`,
    neutral: (v: number) => `Neutral liquidity conditions`,
  },
  mSPX: {
    strong: (v: number) => `SPX correlation strong, supporting BTC position`,
    weak: (v: number) => `SPX correlation weak, reducing BTC exposure`,
    neutral: (v: number) => `SPX correlation neutral`,
  },
};

const GUARD_EXPLANATIONS: Record<string, { trigger: string; action: string }> = {
  'NONE': {
    trigger: 'No stress indicators triggered',
    action: 'Full position sizes allowed (cap: 1.0)',
  },
  'WARN': {
    trigger: 'Elevated VIX or moderate credit stress',
    action: 'Position sizes capped at 0.75 (25% reduction)',
  },
  'CRISIS': {
    trigger: 'High VIX, elevated credit spreads, or liquidity contraction',
    action: 'Position sizes capped at 0.40 (60% reduction)',
  },
  'BLOCK': {
    trigger: 'Severe market stress - circuit breaker triggered',
    action: 'Trading blocked (cap: 0.0)',
  },
};

// ═══════════════════════════════════════════════════════════════
// MAIN BUILDER
// ═══════════════════════════════════════════════════════════════

interface CascadeOutput {
  ok: boolean;
  asset: 'SPX' | 'BTC';
  size: number;
  guardLevel: 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK';
  guardCap: number;
  multipliers: {
    mStress: number;
    mPersistence?: number;
    mNovel: number;
    mScenario: number;
    mLiquidity?: number;
    mSPX?: number;
    total: number;
  };
  inputs?: {
    pStress4w?: number;
    selfTransition?: number;
    bearProb?: number;
    bullProb?: number;
    noveltyScore?: number;
    liquidityImpulse?: number;
    spxAdjustment?: number;
  };
}

export function buildCascadeEvidence(cascade: CascadeOutput): CascadeEvidencePack {
  const { asset, size, guardLevel, guardCap, multipliers, inputs } = cascade;
  
  // Build headline
  const headline = buildHeadline(asset, size, guardLevel);
  
  // Build regime summary
  const regimeSummary = buildRegimeSummary(guardLevel, multipliers);
  
  // Build key drivers
  const keyDrivers = buildKeyDrivers(multipliers, inputs);
  
  // Build deltas
  const deltas = buildDeltas(multipliers);
  
  // Build conflicts
  const conflicts = buildConflicts(multipliers, guardLevel);
  
  // Build flip conditions
  const whatWouldFlip = buildFlipConditions(size, guardLevel, multipliers);
  
  // Build multiplier breakdown
  const multiplierBreakdown = buildMultiplierBreakdown(multipliers, inputs);
  
  // Build guard analysis
  const guardAnalysis = buildGuardAnalysis(guardLevel, guardCap);
  
  // Build size recommendation
  const sizeRecommendation = buildSizeRecommendation(size, guardLevel, multipliers);
  
  // Determine confidence
  const confidence = determineConfidence(multipliers, inputs);
  
  return {
    type: 'CASCADE',
    asset,
    headline,
    regimeSummary,
    keyDrivers,
    deltas,
    conflicts,
    whatWouldFlip,
    confidence,
    computedAt: new Date().toISOString(),
    multiplierBreakdown,
    guardAnalysis,
    sizeRecommendation,
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILDERS
// ═══════════════════════════════════════════════════════════════

function buildHeadline(asset: string, size: number, guardLevel: string): string {
  const sizeDesc = size >= 0.8 ? 'Full' :
                   size >= 0.6 ? 'Moderate' :
                   size >= 0.4 ? 'Reduced' :
                   size >= 0.2 ? 'Minimal' :
                   'Blocked';
  
  const guardNote = guardLevel !== 'NONE' ? ` (${guardLevel} guard active)` : '';
  
  return `${asset} Cascade: ${sizeDesc} position (${Math.round(size * 100)}%)${guardNote}`;
}

function buildRegimeSummary(guardLevel: string, multipliers: CascadeOutput['multipliers']): string {
  const guardInfo = GUARD_EXPLANATIONS[guardLevel] || GUARD_EXPLANATIONS['NONE'];
  
  const totalMult = multipliers.total;
  const multDesc = totalMult >= 0.9 ? 'near-maximum' :
                   totalMult >= 0.7 ? 'moderately positive' :
                   totalMult >= 0.5 ? 'modestly reduced' :
                   'significantly reduced';
  
  return `Guard status: ${guardLevel}. ${guardInfo.action}. Cascade multipliers are ${multDesc} (${Math.round(totalMult * 100)}%).`;
}

function buildKeyDrivers(
  multipliers: CascadeOutput['multipliers'],
  inputs?: CascadeOutput['inputs']
): EvidenceDriver[] {
  const drivers: EvidenceDriver[] = [];
  
  // mStress
  const stressImpact = 1 - multipliers.mStress;
  drivers.push({
    id: 'mStress',
    displayName: 'Stress Multiplier',
    contribution: -stressImpact,
    contributionPct: Math.round(Math.abs(stressImpact) * 50),
    direction: stressImpact > 0.1 ? 'NEGATIVE' : 'NEUTRAL',
    explanation: stressImpact > 0.3 
      ? MULTIPLIER_EXPLANATIONS.mStress.high(inputs?.pStress4w || 0.2)
      : stressImpact > 0.1
      ? MULTIPLIER_EXPLANATIONS.mStress.medium(inputs?.pStress4w || 0.1)
      : MULTIPLIER_EXPLANATIONS.mStress.low(inputs?.pStress4w || 0.05),
  });
  
  // mScenario
  const scenarioBias = multipliers.mScenario - 1;
  drivers.push({
    id: 'mScenario',
    displayName: 'Scenario Multiplier',
    contribution: scenarioBias,
    contributionPct: Math.round(Math.abs(scenarioBias) * 50),
    direction: scenarioBias > 0.05 ? 'POSITIVE' : scenarioBias < -0.05 ? 'NEGATIVE' : 'NEUTRAL',
    explanation: scenarioBias > 0.1 
      ? MULTIPLIER_EXPLANATIONS.mScenario.bull(inputs?.bullProb || 0.4)
      : scenarioBias < -0.1
      ? MULTIPLIER_EXPLANATIONS.mScenario.bear(inputs?.bearProb || 0.4)
      : MULTIPLIER_EXPLANATIONS.mScenario.balanced(0.5),
  });
  
  // mNovel
  const noveltyImpact = 1 - multipliers.mNovel;
  drivers.push({
    id: 'mNovel',
    displayName: 'Novelty Multiplier',
    contribution: -noveltyImpact,
    contributionPct: Math.round(Math.abs(noveltyImpact) * 30),
    direction: noveltyImpact > 0.1 ? 'NEGATIVE' : 'NEUTRAL',
    explanation: noveltyImpact > 0.2 
      ? MULTIPLIER_EXPLANATIONS.mNovelty.high(inputs?.noveltyScore || 0.5)
      : noveltyImpact > 0.05
      ? MULTIPLIER_EXPLANATIONS.mNovelty.medium(inputs?.noveltyScore || 0.3)
      : MULTIPLIER_EXPLANATIONS.mNovelty.low(inputs?.noveltyScore || 0.1),
  });
  
  // mLiquidity (if present)
  if (multipliers.mLiquidity !== undefined) {
    const liqImpact = multipliers.mLiquidity - 1;
    drivers.push({
      id: 'mLiquidity',
      displayName: 'Liquidity Multiplier',
      contribution: liqImpact,
      contributionPct: Math.round(Math.abs(liqImpact) * 40),
      direction: liqImpact > 0.02 ? 'POSITIVE' : liqImpact < -0.02 ? 'NEGATIVE' : 'NEUTRAL',
      explanation: liqImpact > 0.05 
        ? MULTIPLIER_EXPLANATIONS.mLiquidity.expansion(multipliers.mLiquidity)
        : liqImpact < -0.05
        ? MULTIPLIER_EXPLANATIONS.mLiquidity.contraction(multipliers.mLiquidity)
        : MULTIPLIER_EXPLANATIONS.mLiquidity.neutral(multipliers.mLiquidity),
    });
  }
  
  // mSPX (BTC only)
  if (multipliers.mSPX !== undefined) {
    const spxImpact = multipliers.mSPX - 1;
    drivers.push({
      id: 'mSPX',
      displayName: 'SPX Correlation',
      contribution: spxImpact,
      contributionPct: Math.round(Math.abs(spxImpact) * 30),
      direction: spxImpact > 0.02 ? 'POSITIVE' : spxImpact < -0.02 ? 'NEGATIVE' : 'NEUTRAL',
      explanation: spxImpact > 0.05 
        ? MULTIPLIER_EXPLANATIONS.mSPX.strong(multipliers.mSPX)
        : spxImpact < -0.05
        ? MULTIPLIER_EXPLANATIONS.mSPX.weak(multipliers.mSPX)
        : MULTIPLIER_EXPLANATIONS.mSPX.neutral(multipliers.mSPX),
    });
  }
  
  return drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

function buildDeltas(multipliers: CascadeOutput['multipliers']): EvidenceDelta[] {
  return [
    {
      metric: 'Stress Multiplier',
      current: multipliers.mStress,
      change3m: null,
      change12m: null,
      trend: multipliers.mStress < 0.8 ? 'FALLING' : 'STABLE',
    },
    {
      metric: 'Scenario Multiplier',
      current: multipliers.mScenario,
      change3m: null,
      change12m: null,
      trend: multipliers.mScenario > 1.05 ? 'RISING' : multipliers.mScenario < 0.95 ? 'FALLING' : 'STABLE',
    },
    {
      metric: 'Total Cascade',
      current: multipliers.total,
      change3m: null,
      change12m: null,
      trend: multipliers.total > 0.8 ? 'STABLE' : multipliers.total < 0.5 ? 'FALLING' : 'STABLE',
    },
  ];
}

function buildConflicts(
  multipliers: CascadeOutput['multipliers'],
  guardLevel: string
): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = [];
  
  // Scenario vs Guard conflict
  if (multipliers.mScenario > 1.1 && guardLevel !== 'NONE') {
    conflicts.push({
      driver1: 'Scenario (Bull)',
      driver2: `Guard (${guardLevel})`,
      description: 'Bull scenario favors larger size but guard is limiting exposure',
      resolution: 'Guard takes precedence - wait for guard to clear before sizing up',
    });
  }
  
  // High stress but bull scenario
  if (multipliers.mStress < 0.8 && multipliers.mScenario > 1.05) {
    conflicts.push({
      driver1: 'Stress Probability',
      driver2: 'Scenario Weights',
      description: 'Elevated stress probability conflicts with bullish scenario',
      resolution: 'Net effect is cautious sizing - stress overrides scenario',
    });
  }
  
  return conflicts;
}

function buildFlipConditions(
  size: number,
  guardLevel: string,
  multipliers: CascadeOutput['multipliers']
): EvidenceFlipCondition[] {
  const conditions: EvidenceFlipCondition[] = [];
  
  if (size < 0.5) {
    // Currently reduced
    conditions.push({
      condition: `Guard downgrades from ${guardLevel} to NONE`,
      likelihood: 'MEDIUM',
      timeframe: 'Days to weeks',
    });
    conditions.push({
      condition: 'Stress probability drops below 5%',
      likelihood: 'MEDIUM',
      timeframe: '1-4 weeks',
    });
  } else {
    // Currently near full
    conditions.push({
      condition: 'VIX spike triggers WARN/CRISIS guard',
      likelihood: 'LOW',
      timeframe: 'Event-driven',
    });
    conditions.push({
      condition: 'Credit spreads widen significantly',
      likelihood: 'LOW',
      timeframe: 'Days to weeks',
    });
  }
  
  // Scenario flip
  if (multipliers.mScenario > 1.05) {
    conditions.push({
      condition: 'Scenario shifts from bull-dominant to bear-dominant',
      likelihood: 'MEDIUM',
      timeframe: 'Weeks',
    });
  } else if (multipliers.mScenario < 0.95) {
    conditions.push({
      condition: 'Scenario shifts from bear-dominant to bull-dominant',
      likelihood: 'MEDIUM',
      timeframe: 'Weeks',
    });
  }
  
  return conditions;
}

function buildMultiplierBreakdown(
  multipliers: CascadeOutput['multipliers'],
  inputs?: CascadeOutput['inputs']
): CascadeEvidencePack['multiplierBreakdown'] {
  return {
    mStress: {
      value: Math.round(multipliers.mStress * 1000) / 1000,
      explanation: `Based on 4-week stress probability: ${Math.round((inputs?.pStress4w || 0.06) * 100)}%`,
    },
    mPersistence: {
      value: Math.round((multipliers.mPersistence || 1.0) * 1000) / 1000,
      explanation: `Self-transition probability: ${Math.round((inputs?.selfTransition || 0.9) * 100)}%`,
    },
    mNovelty: {
      value: Math.round(multipliers.mNovel * 1000) / 1000,
      explanation: `Novelty score: ${Math.round((inputs?.noveltyScore || 0) * 100)}% (0=familiar, 100=novel)`,
    },
    mScenario: {
      value: Math.round(multipliers.mScenario * 1000) / 1000,
      explanation: `Bull: ${Math.round((inputs?.bullProb || 0.25) * 100)}%, Bear: ${Math.round((inputs?.bearProb || 0.25) * 100)}%`,
    },
    mLiquidity: {
      value: Math.round((multipliers.mLiquidity || 1.0) * 1000) / 1000,
      explanation: `Fed liquidity impulse: ${inputs?.liquidityImpulse !== undefined ? (inputs.liquidityImpulse > 0 ? '+' : '') + Math.round(inputs.liquidityImpulse * 100) + '%' : 'N/A'}`,
    },
    mSPX: multipliers.mSPX !== undefined ? {
      value: Math.round(multipliers.mSPX * 1000) / 1000,
      explanation: `SPX correlation adjustment: ${inputs?.spxAdjustment !== undefined ? Math.round(inputs.spxAdjustment * 100) + '%' : 'N/A'}`,
    } : undefined,
    final: Math.round(multipliers.total * 1000) / 1000,
  };
}

function buildGuardAnalysis(
  guardLevel: string,
  guardCap: number
): CascadeEvidencePack['guardAnalysis'] {
  const info = GUARD_EXPLANATIONS[guardLevel] || GUARD_EXPLANATIONS['NONE'];
  
  return {
    level: guardLevel as CascadeEvidencePack['guardAnalysis']['level'],
    cap: guardCap,
    trigger: info.trigger,
  };
}

function buildSizeRecommendation(
  size: number,
  guardLevel: string,
  multipliers: CascadeOutput['multipliers']
): CascadeEvidencePack['sizeRecommendation'] {
  let rationale: string;
  
  if (size >= 0.9) {
    rationale = 'Full size: All systems green. No guard triggers, favorable scenario, low stress.';
  } else if (size >= 0.7) {
    rationale = 'Near-full size: Minor caution from one or more multipliers but overall constructive.';
  } else if (size >= 0.5) {
    rationale = 'Reduced size: Multiple caution signals. Guard active or elevated stress probability.';
  } else if (size >= 0.2) {
    rationale = `Minimal size: ${guardLevel} guard limiting exposure. Wait for conditions to improve.`;
  } else {
    rationale = 'Position blocked: BLOCK guard active. Capital preservation mode.';
  }
  
  return {
    size: Math.round(size * 1000) / 1000,
    rationale,
  };
}

function determineConfidence(
  multipliers: CascadeOutput['multipliers'],
  inputs?: CascadeOutput['inputs']
): 'HIGH' | 'MEDIUM' | 'LOW' {
  // High novelty = low confidence
  if ((inputs?.noveltyScore || 0) > 0.5) return 'LOW';
  
  // Many multipliers far from 1.0 = more uncertainty
  const deviations = [
    Math.abs(multipliers.mStress - 1),
    Math.abs(multipliers.mScenario - 1),
    Math.abs(multipliers.mNovel - 1),
  ];
  const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  
  if (avgDeviation > 0.2) return 'MEDIUM';
  if (avgDeviation > 0.3) return 'LOW';
  
  return 'HIGH';
}
