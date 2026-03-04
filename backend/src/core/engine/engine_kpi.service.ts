/**
 * Engine KPI Service (v1.1 → v2)
 * 
 * Decision Quality KPI - НЕ оценивают прибыль
 * Оценивают качество решений Engine как системы
 * 
 * KPI Categories:
 * 1. Decision Distribution
 * 2. Coverage Gating Effectiveness
 * 3. Evidence Integrity Score
 * 4. Conflict Resolution Rate
 * 5. Stability KPI (Temporal Consistency)
 * 6. User Feedback KPI
 */
import { EngineDecisionModel } from './engine_decision.model.js';

// ============ KPI THRESHOLDS ============

export const KPI_THRESHOLDS = {
  // 1. Decision Distribution
  distribution: {
    neutral: { min: 60, max: 85 },
    buy: { min: 7, max: 20 },
    sell: { min: 7, max: 20 },
    buyPlusSell: { max: 40 },
  },
  
  // 2. Coverage Gating
  coverage: {
    minForDecision: 60,
    targetAvgBuySell: 70,
  },
  
  // 3. Evidence Integrity
  evidence: {
    minDistinctSources: 2.5,
    minSupportingFacts: 3,
    expectedPenaltyRate: 0.3, // 30% решений должны иметь penalties
  },
  
  // 4. Conflict Resolution
  conflicts: {
    maxConflictBuySellRate: 0, // 0% BUY/SELL при конфликте
    minRiskIncreaseOnConflict: 10,
  },
  
  // 5. Stability
  stability: {
    maxFlipRate24h: 0.15, // 15%
    minDecisionLifespanHours: 4,
  },
  
  // 6. Feedback
  feedback: {
    targetHelpfulRatio: 0.7, // 70%
  },
};

// ============ KPI TYPES ============

export interface DistributionKPI {
  total: number;
  buy: { count: number; pct: number; status: 'ok' | 'warning' | 'critical' };
  sell: { count: number; pct: number; status: 'ok' | 'warning' | 'critical' };
  neutral: { count: number; pct: number; status: 'ok' | 'warning' | 'critical' };
  buyPlusSell: { pct: number; status: 'ok' | 'warning' | 'critical' };
  period: string;
}

export interface CoverageKPI {
  avgCoverageBuySell: number;
  avgCoverageNeutral: number;
  buySellAtLowCoverage: { count: number; pct: number; status: 'ok' | 'critical' };
  coverageVariance: number;
  period: string;
}

export interface EvidenceKPI {
  avgDistinctSources: number;
  avgSupportingFacts: number;
  decisionsWithPenalties: { count: number; pct: number };
  avgPenaltyMagnitude: number;
  singleSourceDecisions: { count: number; status: 'ok' | 'critical' };
  status: 'ok' | 'warning' | 'critical';
  period: string;
}

export interface ConflictKPI {
  totalWithConflicts: number;
  conflictToNeutralRate: number;
  conflictToBuySellRate: number;
  avgRiskIncreaseOnConflict: number;
  status: 'ok' | 'critical';
  period: string;
}

export interface StabilityKPI {
  flipRate24h: number;
  medianDecisionLifespanHours: number;
  decisionsChangedWithoutInputChange: number;
  status: 'ok' | 'warning' | 'critical';
  period: string;
}

export interface FeedbackKPI {
  totalFeedback: number;
  helpfulRatio: number;
  helpfulRatioBuy: number;
  helpfulRatioSell: number;
  helpfulRatioNeutral: number;
  feedbackWithComments: { count: number; pct: number };
  coverageCorrelation: number; // -1 to 1
  period: string;
}

export interface EngineKPISummary {
  distribution: DistributionKPI;
  coverage: CoverageKPI;
  evidence: EvidenceKPI;
  conflicts: ConflictKPI;
  stability: StabilityKPI;
  feedback: FeedbackKPI;
  overallHealth: 'healthy' | 'warning' | 'critical';
  generatedAt: Date;
  period: string;
}

// ============ KPI CALCULATIONS ============

/**
 * Calculate Decision Distribution KPI
 */
export async function calculateDistributionKPI(days: number = 7): Promise<DistributionKPI> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const results = await EngineDecisionModel.aggregate([
    { $match: { createdAt: { $gte: cutoff } } },
    { $group: { _id: '$decision', count: { $sum: 1 } } },
  ]);
  
  const counts: Record<string, number> = { BUY: 0, SELL: 0, NEUTRAL: 0 };
  results.forEach((r: any) => { counts[r._id] = r.count; });
  
  const total = counts.BUY + counts.SELL + counts.NEUTRAL;
  const thresholds = KPI_THRESHOLDS.distribution;
  
  const buyPct = total > 0 ? (counts.BUY / total) * 100 : 0;
  const sellPct = total > 0 ? (counts.SELL / total) * 100 : 0;
  const neutralPct = total > 0 ? (counts.NEUTRAL / total) * 100 : 0;
  const buyPlusSellPct = buyPct + sellPct;
  
  return {
    total,
    buy: {
      count: counts.BUY,
      pct: buyPct,
      status: buyPct >= thresholds.buy.min && buyPct <= thresholds.buy.max ? 'ok' :
              buyPct > thresholds.buy.max ? 'warning' : 'ok',
    },
    sell: {
      count: counts.SELL,
      pct: sellPct,
      status: sellPct >= thresholds.sell.min && sellPct <= thresholds.sell.max ? 'ok' :
              sellPct > thresholds.sell.max ? 'warning' : 'ok',
    },
    neutral: {
      count: counts.NEUTRAL,
      pct: neutralPct,
      status: neutralPct >= thresholds.neutral.min && neutralPct <= thresholds.neutral.max ? 'ok' :
              neutralPct > 90 ? 'warning' : neutralPct < thresholds.neutral.min ? 'critical' : 'ok',
    },
    buyPlusSell: {
      pct: buyPlusSellPct,
      status: buyPlusSellPct <= thresholds.buyPlusSell.max ? 'ok' : 'critical',
    },
    period: `${days}d`,
  };
}

/**
 * Calculate Coverage Gating KPI
 */
export async function calculateCoverageKPI(days: number = 7): Promise<CoverageKPI> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const minCoverage = KPI_THRESHOLDS.coverage.minForDecision;
  
  const [avgCoverages, lowCoverageDecisions, allDecisions] = await Promise.all([
    // Average coverage by decision type
    EngineDecisionModel.aggregate([
      { $match: { createdAt: { $gte: cutoff } } },
      { $group: {
        _id: '$decision',
        avgCoverage: { $avg: '$coverage.overall' },
      }},
    ]),
    // BUY/SELL at low coverage (should be 0)
    EngineDecisionModel.countDocuments({
      createdAt: { $gte: cutoff },
      decision: { $in: ['BUY', 'SELL'] },
      'coverage.overall': { $lt: minCoverage },
    }),
    // Total BUY/SELL
    EngineDecisionModel.countDocuments({
      createdAt: { $gte: cutoff },
      decision: { $in: ['BUY', 'SELL'] },
    }),
  ]);
  
  const coverageByType: Record<string, number> = {};
  avgCoverages.forEach((r: any) => { coverageByType[r._id] = r.avgCoverage || 0; });
  
  // Calculate variance
  const coverageValues = await EngineDecisionModel.find(
    { createdAt: { $gte: cutoff }, decision: { $in: ['BUY', 'SELL'] } },
    { 'coverage.overall': 1 }
  ).lean();
  
  const avgBuySell = ((coverageByType['BUY'] || 0) + (coverageByType['SELL'] || 0)) / 2;
  let variance = 0;
  if (coverageValues.length > 0) {
    const mean = coverageValues.reduce((sum, d: any) => sum + (d.coverage?.overall || 0), 0) / coverageValues.length;
    variance = coverageValues.reduce((sum, d: any) => sum + Math.pow((d.coverage?.overall || 0) - mean, 2), 0) / coverageValues.length;
  }
  
  const lowCoveragePct = allDecisions > 0 ? (lowCoverageDecisions / allDecisions) * 100 : 0;
  
  return {
    avgCoverageBuySell: avgBuySell,
    avgCoverageNeutral: coverageByType['NEUTRAL'] || 0,
    buySellAtLowCoverage: {
      count: lowCoverageDecisions,
      pct: lowCoveragePct,
      status: lowCoverageDecisions === 0 ? 'ok' : 'critical',
    },
    coverageVariance: variance,
    period: `${days}d`,
  };
}

/**
 * Calculate Evidence Integrity KPI
 */
export async function calculateEvidenceKPI(days: number = 7): Promise<EvidenceKPI> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const decisions = await EngineDecisionModel.find(
    { createdAt: { $gte: cutoff }, decision: { $in: ['BUY', 'SELL'] } },
    {
      'explainability.distinctSources': 1,
      'explainability.penaltiesApplied': 1,
      'reasoning.supportingFacts': 1,
    }
  ).lean();
  
  if (decisions.length === 0) {
    return {
      avgDistinctSources: 0,
      avgSupportingFacts: 0,
      decisionsWithPenalties: { count: 0, pct: 0 },
      avgPenaltyMagnitude: 0,
      singleSourceDecisions: { count: 0, status: 'ok' },
      status: 'ok',
      period: `${days}d`,
    };
  }
  
  let totalSources = 0;
  let totalFacts = 0;
  let withPenalties = 0;
  let totalPenaltyMag = 0;
  let singleSource = 0;
  
  for (const d of decisions as any[]) {
    const sources = d.explainability?.distinctSources || 0;
    totalSources += sources;
    if (sources <= 1) singleSource++;
    
    const facts = d.reasoning?.supportingFacts?.length || 0;
    totalFacts += facts;
    
    const penalties = d.explainability?.penaltiesApplied || [];
    if (penalties.length > 0) {
      withPenalties++;
      // Extract penalty magnitude from strings like "Low coverage (<50%): -15"
      for (const p of penalties) {
        const match = p.match(/-?(\d+)/);
        if (match) totalPenaltyMag += parseInt(match[1]);
      }
    }
  }
  
  const avgSources = totalSources / decisions.length;
  const avgFacts = totalFacts / decisions.length;
  const thresholds = KPI_THRESHOLDS.evidence;
  
  let status: 'ok' | 'warning' | 'critical' = 'ok';
  if (avgSources < thresholds.minDistinctSources || avgFacts < thresholds.minSupportingFacts) {
    status = 'warning';
  }
  if (singleSource > 0) {
    status = 'critical';
  }
  
  return {
    avgDistinctSources: avgSources,
    avgSupportingFacts: avgFacts,
    decisionsWithPenalties: {
      count: withPenalties,
      pct: (withPenalties / decisions.length) * 100,
    },
    avgPenaltyMagnitude: withPenalties > 0 ? totalPenaltyMag / withPenalties : 0,
    singleSourceDecisions: {
      count: singleSource,
      status: singleSource === 0 ? 'ok' : 'critical',
    },
    status,
    period: `${days}d`,
  };
}

/**
 * Calculate Conflict Resolution KPI
 */
export async function calculateConflictKPI(days: number = 7): Promise<ConflictKPI> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const decisionsWithConflicts = await EngineDecisionModel.find(
    {
      createdAt: { $gte: cutoff },
      'explainability.conflictsDetected': { $exists: true, $ne: [] },
    },
    { decision: 1, 'scores.risk': 1, 'explainability.conflictsDetected': 1 }
  ).lean();
  
  if (decisionsWithConflicts.length === 0) {
    return {
      totalWithConflicts: 0,
      conflictToNeutralRate: 100,
      conflictToBuySellRate: 0,
      avgRiskIncreaseOnConflict: 0,
      status: 'ok',
      period: `${days}d`,
    };
  }
  
  let neutral = 0;
  let buySell = 0;
  let totalRisk = 0;
  
  for (const d of decisionsWithConflicts as any[]) {
    if (d.decision === 'NEUTRAL') {
      neutral++;
    } else {
      buySell++;
    }
    totalRisk += d.scores?.risk || 0;
  }
  
  const total = decisionsWithConflicts.length;
  
  return {
    totalWithConflicts: total,
    conflictToNeutralRate: (neutral / total) * 100,
    conflictToBuySellRate: (buySell / total) * 100,
    avgRiskIncreaseOnConflict: totalRisk / total,
    status: buySell === 0 ? 'ok' : 'critical',
    period: `${days}d`,
  };
}

/**
 * Calculate Stability KPI
 */
export async function calculateStabilityKPI(days: number = 7): Promise<StabilityKPI> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // Get all decisions sorted by time for same assets
  const decisions = await EngineDecisionModel.find(
    { createdAt: { $gte: cutoff } },
    { 'asset.address': 1, decision: 1, createdAt: 1, inputHash: 1 }
  ).sort({ 'asset.address': 1, createdAt: 1 }).lean();
  
  // Track flips
  let flips24h = 0;
  let decisionsIn24h = 0;
  let changedWithoutInputChange = 0;
  const lifespans: number[] = [];
  
  const byAsset: Record<string, any[]> = {};
  for (const d of decisions as any[]) {
    const addr = d.asset?.address || 'unknown';
    if (!byAsset[addr]) byAsset[addr] = [];
    byAsset[addr].push(d);
  }
  
  for (const assetDecisions of Object.values(byAsset)) {
    for (let i = 1; i < assetDecisions.length; i++) {
      const prev = assetDecisions[i - 1];
      const curr = assetDecisions[i];
      
      const timeDiff = new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime();
      const hoursDiff = timeDiff / (1000 * 60 * 60);
      
      lifespans.push(hoursDiff);
      
      // Check for flip (BUY→SELL or SELL→BUY)
      const isFlip = (prev.decision === 'BUY' && curr.decision === 'SELL') ||
                     (prev.decision === 'SELL' && curr.decision === 'BUY');
      
      if (isFlip && new Date(curr.createdAt) >= cutoff24h) {
        flips24h++;
      }
      
      // Check if decision changed without input change
      if (prev.inputHash === curr.inputHash && prev.decision !== curr.decision) {
        changedWithoutInputChange++;
      }
      
      if (new Date(curr.createdAt) >= cutoff24h) {
        decisionsIn24h++;
      }
    }
  }
  
  const flipRate = decisionsIn24h > 0 ? (flips24h / decisionsIn24h) * 100 : 0;
  const medianLifespan = lifespans.length > 0 
    ? lifespans.sort((a, b) => a - b)[Math.floor(lifespans.length / 2)]
    : 0;
  
  const thresholds = KPI_THRESHOLDS.stability;
  let status: 'ok' | 'warning' | 'critical' = 'ok';
  if (flipRate > thresholds.maxFlipRate24h * 100) status = 'critical';
  else if (medianLifespan < thresholds.minDecisionLifespanHours) status = 'warning';
  
  return {
    flipRate24h: flipRate,
    medianDecisionLifespanHours: medianLifespan,
    decisionsChangedWithoutInputChange: changedWithoutInputChange,
    status,
    period: `${days}d`,
  };
}

/**
 * Calculate Feedback KPI
 */
export async function calculateFeedbackKPI(days: number = 7): Promise<FeedbackKPI> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const feedbackData = await EngineDecisionModel.find(
    {
      createdAt: { $gte: cutoff },
      'feedback.helpful': { $ne: null },
    },
    {
      decision: 1,
      'feedback.helpful': 1,
      'feedback.comment': 1,
      'coverage.overall': 1,
    }
  ).lean();
  
  if (feedbackData.length === 0) {
    return {
      totalFeedback: 0,
      helpfulRatio: 0,
      helpfulRatioBuy: 0,
      helpfulRatioSell: 0,
      helpfulRatioNeutral: 0,
      feedbackWithComments: { count: 0, pct: 0 },
      coverageCorrelation: 0,
      period: `${days}d`,
    };
  }
  
  const byType: Record<string, { helpful: number; total: number }> = {
    BUY: { helpful: 0, total: 0 },
    SELL: { helpful: 0, total: 0 },
    NEUTRAL: { helpful: 0, total: 0 },
  };
  
  let totalHelpful = 0;
  let withComments = 0;
  const coverageHelpful: number[] = [];
  const coverageNotHelpful: number[] = [];
  
  for (const d of feedbackData as any[]) {
    const type = d.decision;
    const helpful = d.feedback?.helpful === true;
    const coverage = d.coverage?.overall || 0;
    
    byType[type].total++;
    if (helpful) {
      byType[type].helpful++;
      totalHelpful++;
      coverageHelpful.push(coverage);
    } else {
      coverageNotHelpful.push(coverage);
    }
    
    if (d.feedback?.comment) withComments++;
  }
  
  // Simple correlation: difference in avg coverage
  const avgCoverageHelpful = coverageHelpful.length > 0 
    ? coverageHelpful.reduce((a, b) => a + b, 0) / coverageHelpful.length 
    : 0;
  const avgCoverageNotHelpful = coverageNotHelpful.length > 0 
    ? coverageNotHelpful.reduce((a, b) => a + b, 0) / coverageNotHelpful.length 
    : 0;
  // Normalize to -1..1 range
  const correlation = (avgCoverageHelpful - avgCoverageNotHelpful) / 100;
  
  return {
    totalFeedback: feedbackData.length,
    helpfulRatio: (totalHelpful / feedbackData.length) * 100,
    helpfulRatioBuy: byType.BUY.total > 0 ? (byType.BUY.helpful / byType.BUY.total) * 100 : 0,
    helpfulRatioSell: byType.SELL.total > 0 ? (byType.SELL.helpful / byType.SELL.total) * 100 : 0,
    helpfulRatioNeutral: byType.NEUTRAL.total > 0 ? (byType.NEUTRAL.helpful / byType.NEUTRAL.total) * 100 : 0,
    feedbackWithComments: {
      count: withComments,
      pct: (withComments / feedbackData.length) * 100,
    },
    coverageCorrelation: Math.max(-1, Math.min(1, correlation)),
    period: `${days}d`,
  };
}

/**
 * Calculate Full KPI Summary
 */
export async function calculateFullKPI(days: number = 7): Promise<EngineKPISummary> {
  const [distribution, coverage, evidence, conflicts, stability, feedback] = await Promise.all([
    calculateDistributionKPI(days),
    calculateCoverageKPI(days),
    calculateEvidenceKPI(days),
    calculateConflictKPI(days),
    calculateStabilityKPI(days),
    calculateFeedbackKPI(days),
  ]);
  
  // Determine overall health
  const criticals = [
    coverage.buySellAtLowCoverage.status === 'critical',
    evidence.status === 'critical',
    conflicts.status === 'critical',
    stability.status === 'critical',
    distribution.buyPlusSell.status === 'critical',
  ].filter(Boolean).length;
  
  const warnings = [
    distribution.buy.status === 'warning',
    distribution.sell.status === 'warning',
    distribution.neutral.status === 'warning',
    evidence.status === 'warning',
    stability.status === 'warning',
  ].filter(Boolean).length;
  
  let overallHealth: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (criticals > 0) overallHealth = 'critical';
  else if (warnings >= 2) overallHealth = 'warning';
  
  return {
    distribution,
    coverage,
    evidence,
    conflicts,
    stability,
    feedback,
    overallHealth,
    generatedAt: new Date(),
    period: `${days}d`,
  };
}
