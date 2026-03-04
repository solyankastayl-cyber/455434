/**
 * MACRO EVIDENCE BUILDER — P4.1
 * 
 * Builds explainability pack for macro score.
 * Answers: Why is macro score X? What drives it? What would flip it?
 */

import type { MacroScore, MacroScoreComponent } from '../dxy-macro-core/contracts/macro.contracts.js';
import type { 
  MacroEvidencePack, 
  EvidenceDriver, 
  EvidenceDelta, 
  EvidenceConflict,
  EvidenceFlipCondition 
} from './evidence.contract.js';

// ═══════════════════════════════════════════════════════════════
// INTERPRETATION MAPS
// ═══════════════════════════════════════════════════════════════

const REGIME_DESCRIPTIONS: Record<string, string> = {
  'EASING': 'dovish monetary policy, supportive for risk',
  'TIGHTENING': 'hawkish monetary policy, headwind for risk',
  'EXPANSION': 'growth accelerating, bullish macro',
  'CONTRACTION': 'growth decelerating, bearish macro',
  'NEUTRAL': 'balanced conditions, no strong directional bias',
  'ACCELERATING': 'rate of change increasing',
  'DECELERATING': 'rate of change decreasing',
  'STRESS': 'elevated financial stress, risk-off',
  'CALM': 'low volatility, risk-on',
  'STEEPENING': 'curve steepening, growth expectations rising',
  'FLATTENING': 'curve flattening, growth expectations falling',
  'INVERTED': 'inverted yield curve, recession signal',
};

const ROLE_IMPACT_DESCRIPTIONS: Record<string, { positive: string; negative: string }> = {
  'rates': {
    positive: 'Fed tightening supports USD strength',
    negative: 'Fed easing weakens USD',
  },
  'inflation': {
    positive: 'Hot inflation drives Fed hawkishness, USD bullish',
    negative: 'Cooling inflation allows Fed pivot, USD bearish',
  },
  'labor': {
    positive: 'Strong labor market supports Fed hawkishness',
    negative: 'Weak labor market forces Fed dovishness',
  },
  'liquidity': {
    positive: 'Liquidity contraction supports USD',
    negative: 'Liquidity expansion weakens USD',
  },
  'growth': {
    positive: 'Strong growth supports USD via rate expectations',
    negative: 'Weak growth pressures USD via rate expectations',
  },
  'housing': {
    positive: 'Strong housing supports growth outlook',
    negative: 'Weak housing signals growth concerns',
  },
  'credit': {
    positive: 'Tight credit conditions signal stress, USD supportive',
    negative: 'Loose credit conditions support risk, USD neutral',
  },
  'curve': {
    positive: 'Curve dynamics support USD strength',
    negative: 'Curve dynamics signal growth concerns',
  },
};

// ═══════════════════════════════════════════════════════════════
// MAIN BUILDER
// ═══════════════════════════════════════════════════════════════

export function buildMacroEvidence(score: MacroScore): MacroEvidencePack {
  const scoreSigned = score.scoreSigned;
  const score01 = score.score01;
  
  // Build headline
  const headline = buildHeadline(scoreSigned, score.confidence);
  
  // Build regime summary
  const regimeSummary = buildRegimeSummary(score);
  
  // Build key drivers
  const keyDrivers = buildKeyDrivers(score.components, scoreSigned);
  
  // Build deltas (change analysis)
  const deltas = buildDeltas(score.components);
  
  // Build conflicts
  const conflicts = buildConflicts(score.components);
  
  // Build flip conditions
  const whatWouldFlip = buildFlipConditions(score.components, scoreSigned);
  
  // Build component breakdown
  const componentBreakdown = buildComponentBreakdown(score.components);
  
  // Build regime analysis
  const regimeAnalysis = buildRegimeAnalysis(score.components);
  
  // Score interpretation
  const interpretation = interpretScore(scoreSigned);
  
  return {
    type: 'MACRO',
    headline,
    regimeSummary,
    keyDrivers,
    deltas,
    conflicts,
    whatWouldFlip,
    confidence: score.confidence,
    computedAt: new Date().toISOString(),
    scoreSummary: {
      scoreSigned,
      score01,
      interpretation,
    },
    componentBreakdown,
    regimeAnalysis,
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILDERS
// ═══════════════════════════════════════════════════════════════

function buildHeadline(scoreSigned: number, confidence: string): string {
  const strength = Math.abs(scoreSigned);
  let intensifier = '';
  
  if (strength > 0.4) intensifier = 'Strong ';
  else if (strength > 0.2) intensifier = 'Moderate ';
  else if (strength > 0.1) intensifier = 'Mild ';
  else intensifier = 'Weak ';
  
  const direction = scoreSigned > 0.05 ? 'USD Bullish' :
                    scoreSigned < -0.05 ? 'USD Bearish' :
                    'Neutral';
  
  const confNote = confidence === 'HIGH' ? '' : ` (${confidence} confidence)`;
  
  return `${intensifier}${direction} Macro Environment${confNote}`;
}

function buildRegimeSummary(score: MacroScore): string {
  const { summary } = score;
  const regimeDesc = REGIME_DESCRIPTIONS[summary.dominantRegime] || 'mixed conditions';
  
  const drivers = summary.keyDrivers.slice(0, 2).map(d => {
    const [name] = d.split(':');
    return name.trim();
  }).join(' and ');
  
  return `Dominant regime is ${summary.dominantRegime} (${regimeDesc}). Key drivers: ${drivers || 'multiple factors'}.`;
}

function buildKeyDrivers(components: MacroScoreComponent[], totalScore: number): EvidenceDriver[] {
  const totalAbsContrib = components.reduce((sum, c) => sum + Math.abs(c.normalizedPressure), 0) || 1;
  
  return components
    .sort((a, b) => Math.abs(b.normalizedPressure) - Math.abs(a.normalizedPressure))
    .slice(0, 5)
    .map(c => {
      const contribution = c.normalizedPressure;
      const contributionPct = Math.round((Math.abs(contribution) / totalAbsContrib) * 100);
      const direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' = 
        contribution > 0.01 ? 'POSITIVE' : 
        contribution < -0.01 ? 'NEGATIVE' : 
        'NEUTRAL';
      
      const impact = ROLE_IMPACT_DESCRIPTIONS[c.role];
      const explanation = direction === 'POSITIVE' 
        ? (impact?.positive || `${c.displayName} contributes positively`)
        : direction === 'NEGATIVE'
        ? (impact?.negative || `${c.displayName} contributes negatively`)
        : `${c.displayName} is neutral`;
      
      return {
        id: c.seriesId,
        displayName: c.displayName,
        contribution: Math.round(contribution * 1000) / 1000,
        contributionPct,
        direction,
        explanation,
      };
    });
}

function buildDeltas(components: MacroScoreComponent[]): EvidenceDelta[] {
  // Note: In real implementation, this would query historical data
  // For now, we use regime changes as proxy for trend
  
  return components.slice(0, 5).map(c => {
    const regime = String(c.regime);
    let trend: 'RISING' | 'FALLING' | 'STABLE' = 'STABLE';
    
    if (['TIGHTENING', 'ACCELERATING', 'EXPANSION'].includes(regime)) {
      trend = 'RISING';
    } else if (['EASING', 'DECELERATING', 'CONTRACTION'].includes(regime)) {
      trend = 'FALLING';
    }
    
    return {
      metric: c.displayName,
      current: c.rawPressure,
      change3m: null,  // Would require historical query
      change12m: null, // Would require historical query
      trend,
    };
  });
}

function buildConflicts(components: MacroScoreComponent[]): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = [];
  
  // Check for opposing signals
  const positive = components.filter(c => c.normalizedPressure > 0.02);
  const negative = components.filter(c => c.normalizedPressure < -0.02);
  
  // If significant drivers in both directions, there's a conflict
  if (positive.length > 0 && negative.length > 0) {
    const topPos = positive.sort((a, b) => b.normalizedPressure - a.normalizedPressure)[0];
    const topNeg = negative.sort((a, b) => a.normalizedPressure - b.normalizedPressure)[0];
    
    conflicts.push({
      driver1: topPos.displayName,
      driver2: topNeg.displayName,
      description: `${topPos.displayName} is pushing bullish while ${topNeg.displayName} is pushing bearish`,
      resolution: Math.abs(topPos.normalizedPressure) > Math.abs(topNeg.normalizedPressure)
        ? `${topPos.displayName} dominates, net signal is bullish`
        : `${topNeg.displayName} dominates, net signal is bearish`,
    });
  }
  
  // Check rates vs liquidity conflict
  const rates = components.find(c => c.role === 'rates');
  const liquidity = components.find(c => c.seriesId === 'LIQUIDITY_ENGINE');
  
  if (rates && liquidity) {
    const ratesDir = rates.normalizedPressure > 0 ? 'bullish' : 'bearish';
    const liqDir = liquidity.normalizedPressure > 0 ? 'bullish' : 'bearish';
    
    if (ratesDir !== liqDir && Math.abs(rates.normalizedPressure) > 0.01 && Math.abs(liquidity.normalizedPressure) > 0.01) {
      conflicts.push({
        driver1: 'Fed Funds Rate',
        driver2: 'Fed Liquidity',
        description: `Rate policy is ${ratesDir} but liquidity dynamics are ${liqDir}`,
        resolution: 'Liquidity often leads rates in impact; monitor for convergence',
      });
    }
  }
  
  return conflicts;
}

function buildFlipConditions(components: MacroScoreComponent[], currentScore: number): EvidenceFlipCondition[] {
  const conditions: EvidenceFlipCondition[] = [];
  
  // Sort by impact
  const sorted = [...components].sort((a, b) => 
    Math.abs(b.normalizedPressure) - Math.abs(a.normalizedPressure)
  );
  
  const topDriver = sorted[0];
  
  if (currentScore > 0.1) {
    // Currently bullish USD
    conditions.push({
      condition: `${topDriver?.displayName || 'Top driver'} reverses from ${topDriver?.regime || 'current'} to opposite regime`,
      likelihood: 'MEDIUM',
      timeframe: '1-3 months',
    });
    
    conditions.push({
      condition: 'Fed pivots to easing cycle amid growth slowdown',
      likelihood: 'LOW',
      timeframe: '3-6 months',
    });
    
    conditions.push({
      condition: 'Liquidity injection program (QE) announced',
      likelihood: 'LOW',
      timeframe: 'Event-driven',
    });
  } else if (currentScore < -0.1) {
    // Currently bearish USD
    conditions.push({
      condition: `${topDriver?.displayName || 'Top driver'} reverses from ${topDriver?.regime || 'current'} to opposite regime`,
      likelihood: 'MEDIUM',
      timeframe: '1-3 months',
    });
    
    conditions.push({
      condition: 'Inflation surprise leads to hawkish Fed pivot',
      likelihood: 'MEDIUM',
      timeframe: '1-2 months',
    });
    
    conditions.push({
      condition: 'Global risk-off event triggers USD safe-haven bid',
      likelihood: 'LOW',
      timeframe: 'Event-driven',
    });
  } else {
    // Neutral
    conditions.push({
      condition: 'Decisive Fed policy shift in either direction',
      likelihood: 'MEDIUM',
      timeframe: '1-3 months',
    });
    
    conditions.push({
      condition: 'Macro data surprises consistently in one direction',
      likelihood: 'MEDIUM',
      timeframe: '2-4 weeks',
    });
  }
  
  return conditions;
}

function buildComponentBreakdown(components: MacroScoreComponent[]): MacroEvidencePack['componentBreakdown'] {
  const findContrib = (filter: (c: MacroScoreComponent) => boolean) => {
    const matches = components.filter(filter);
    const contribution = matches.reduce((sum, c) => sum + c.normalizedPressure, 0);
    const weight = matches.reduce((sum, c) => sum + c.weight, 0);
    return { weight: Math.round(weight * 100) / 100, contribution: Math.round(contribution * 1000) / 1000 };
  };
  
  return {
    core: findContrib(c => ['rates', 'inflation', 'labor', 'liquidity', 'curve', 'growth'].includes(c.role) && c.seriesId !== 'LIQUIDITY_ENGINE'),
    housing: findContrib(c => c.seriesId === 'HOUSING'),
    activity: findContrib(c => c.seriesId === 'ACTIVITY'),
    credit: findContrib(c => c.seriesId === 'CREDIT'),
    liquidity: findContrib(c => c.seriesId === 'LIQUIDITY_ENGINE'),
  };
}

function buildRegimeAnalysis(components: MacroScoreComponent[]): MacroEvidencePack['regimeAnalysis'] {
  const distribution: Record<string, number> = {};
  
  for (const c of components) {
    const regime = String(c.regime);
    distribution[regime] = (distribution[regime] || 0) + 1;
  }
  
  const dominant = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'NEUTRAL';
  
  // Determine consistency
  const uniqueRegimes = Object.keys(distribution).length;
  const maxCount = Math.max(...Object.values(distribution));
  const totalCount = components.length;
  
  let consistency: 'ALIGNED' | 'MIXED' | 'CONFLICTING' = 'MIXED';
  
  if (maxCount / totalCount > 0.6) {
    consistency = 'ALIGNED';
  } else if (uniqueRegimes > 4) {
    consistency = 'CONFLICTING';
  }
  
  return { dominant, distribution, consistency };
}

function interpretScore(scoreSigned: number): string {
  if (scoreSigned > 0.3) return 'Strong USD bullish bias. Macro conditions strongly favor USD strength.';
  if (scoreSigned > 0.15) return 'Moderate USD bullish bias. Macro conditions lean toward USD strength.';
  if (scoreSigned > 0.05) return 'Mild USD bullish bias. Slight macro tailwind for USD.';
  if (scoreSigned > -0.05) return 'Neutral macro environment. No clear directional bias.';
  if (scoreSigned > -0.15) return 'Mild USD bearish bias. Slight macro headwind for USD.';
  if (scoreSigned > -0.3) return 'Moderate USD bearish bias. Macro conditions lean against USD.';
  return 'Strong USD bearish bias. Macro conditions strongly favor USD weakness.';
}
