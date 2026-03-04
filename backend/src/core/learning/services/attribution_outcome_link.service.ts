/**
 * Attribution Outcome Link Service
 * 
 * ETAP 3.3: Links predictions to outcomes with signal attribution.
 * 
 * Key responsibilities:
 * - Build links for snapshots with validated trends
 * - Compute verdict using deterministic rules
 * - Extract signal contributions from snapshot
 * - Apply drift confidence modifier
 * 
 * NO ML - NO side effects on Ranking/Engine.
 * Reads only from: PredictionSnapshot, OutcomeObservation, TrendValidation
 */
import { AttributionOutcomeLinkModel, type IAttributionOutcomeLink } from '../models/attribution_outcome_link.model.js';
import { PredictionSnapshotModel, type IPredictionSnapshot } from '../models/PredictionSnapshot.model.js';
import { OutcomeObservationModel, type IOutcomeObservation } from '../models/OutcomeObservation.model.js';
import { TrendValidationModel, type ITrendValidation } from '../models/trend_validation.model.js';
import type { Bucket, Horizon, DriftLevel } from '../learning.types.js';
import type { TrendLabel, DelayLabel } from '../types/trend.types.js';
import { 
  VERDICT_RULES, 
  type Verdict, 
  type SignalContribution, 
  type SignalContribSummary,
  type LinkQuality,
} from '../types/attribution.types.js';

// ==================== TYPES ====================

export interface LinkResult {
  snapshotId: string;
  horizon: Horizon;
  status: 'created' | 'updated' | 'skipped' | 'error';
  verdict?: Verdict;
  reason?: string;
}

export interface LinkBatchResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  details: LinkResult[];
}

type HorizonKey = '1d' | '7d' | '30d';
const HORIZONS: HorizonKey[] = ['1d', '7d', '30d'];

// ==================== DRIFT CONFIDENCE MODIFIERS ====================

const DRIFT_CONFIDENCE_MODIFIERS: Record<DriftLevel, number> = {
  LOW: 1.0,
  MEDIUM: 0.85,
  HIGH: 0.6,
  CRITICAL: 0.3,
};

// ==================== CORE FUNCTIONS ====================

/**
 * Compute verdict using deterministic rules
 * Pure function - same inputs always produce same output
 */
export function computeVerdict(
  bucket: Bucket,
  trendLabel: TrendLabel,
  delayLabel: DelayLabel
): Verdict {
  const bucketRules = VERDICT_RULES[bucket];
  if (!bucketRules) return 'FALSE_POSITIVE';
  
  const trendRules = bucketRules[trendLabel];
  if (!trendRules) return 'FALSE_POSITIVE';
  
  const verdict = trendRules[delayLabel];
  return verdict || 'FALSE_POSITIVE';
}

/**
 * Extract signal contributions from snapshot
 */
export function extractSignalContrib(snapshot: IPredictionSnapshot): SignalContribSummary {
  const positiveSignals: SignalContribution[] = [];
  const negativeSignals: SignalContribution[] = [];
  const conflicts: Array<{ key: string; conflictScore: number }> = [];
  
  // Engine confidence contribution
  const engineConfidence = snapshot.decision.confidence;
  const confidenceDirection = engineConfidence >= 50 ? 'positive' : 'negative';
  const confidenceContrib: SignalContribution = {
    key: 'engineConfidence',
    source: 'engine',
    value: engineConfidence,
    weight: 0.30, // From ranking weights
    direction: confidenceDirection,
  };
  
  if (confidenceDirection === 'positive') {
    positiveSignals.push(confidenceContrib);
  } else {
    negativeSignals.push(confidenceContrib);
  }
  
  // Risk contribution (inverse - high risk is negative)
  const risk = snapshot.decision.risk;
  const riskDirection = risk > 45 ? 'negative' : risk < 30 ? 'positive' : 'neutral';
  const riskContrib: SignalContribution = {
    key: 'engineRisk',
    source: 'engine',
    value: risk,
    weight: 0.15,
    direction: riskDirection,
  };
  
  if (riskDirection === 'negative') {
    negativeSignals.push(riskContrib);
  } else if (riskDirection === 'positive') {
    positiveSignals.push(riskContrib);
  }
  
  // Actor signal contribution
  const actorScore = snapshot.engineContext.actorSignalScore;
  if (actorScore !== 0) {
    const actorDirection = actorScore > 0 ? 'positive' : 'negative';
    const actorContrib: SignalContribution = {
      key: 'actorSignalScore',
      source: 'actor',
      value: actorScore,
      weight: 0.20,
      direction: actorDirection,
    };
    
    if (actorDirection === 'positive') {
      positiveSignals.push(actorContrib);
    } else {
      negativeSignals.push(actorContrib);
    }
  }
  
  // Drift contribution (high drift is negative for confidence)
  const driftScore = snapshot.liveContext.driftScore;
  const driftLevel = snapshot.liveContext.driftLevel;
  if (driftScore > 0.15) {
    negativeSignals.push({
      key: 'driftScore',
      source: 'live',
      value: driftScore,
      weight: 0.10,
      direction: 'negative',
    });
  }
  
  // Score contribution
  const score = snapshot.decision.score;
  const scoreDirection = score >= 60 ? 'positive' : score <= 40 ? 'negative' : 'neutral';
  const scoreContrib: SignalContribution = {
    key: 'compositeScore',
    source: 'engine',
    value: score,
    weight: 0.25,
    direction: scoreDirection,
  };
  
  if (scoreDirection === 'positive') {
    positiveSignals.push(scoreContrib);
  } else if (scoreDirection === 'negative') {
    negativeSignals.push(scoreContrib);
  }
  
  // Calculate totals
  const totalPositive = positiveSignals.reduce((sum, s) => sum + Math.abs(s.value * s.weight), 0);
  const totalNegative = negativeSignals.reduce((sum, s) => sum + Math.abs(s.value * s.weight), 0);
  
  // Sort by contribution magnitude
  positiveSignals.sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight));
  negativeSignals.sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight));
  
  // Top 3 each
  const topPositive = positiveSignals.slice(0, 3);
  const topNegative = negativeSignals.slice(0, 3);
  
  // Determine top contributor
  const allSignals = [...positiveSignals, ...negativeSignals];
  const topContributor = allSignals.length > 0 
    ? allSignals.sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight))[0].key
    : null;
  
  return {
    positiveSignals: topPositive,
    negativeSignals: topNegative,
    conflicts,
    topContributor,
    totalPositive: Math.round(totalPositive * 100) / 100,
    totalNegative: Math.round(totalNegative * 100) / 100,
  };
}

/**
 * Apply drift confidence modifier
 */
export function applyDriftConfidenceModifier(
  baseConfidence: number,
  driftLevel: DriftLevel
): number {
  const modifier = DRIFT_CONFIDENCE_MODIFIERS[driftLevel] || 1.0;
  return Math.round(baseConfidence * modifier * 100) / 100;
}

/**
 * Build link for a single snapshot + horizon
 */
export async function buildLink(
  snapshotId: string,
  horizon: Horizon
): Promise<LinkResult> {
  try {
    // Check if link already exists
    const existingLink = await AttributionOutcomeLinkModel.findOne({
      snapshotId,
      horizon,
    });
    
    if (existingLink) {
      return { snapshotId, horizon, status: 'skipped', reason: 'Link already exists' };
    }
    
    // Get snapshot
    const snapshot = await PredictionSnapshotModel.findOne({ snapshotId }).lean();
    if (!snapshot) {
      return { snapshotId, horizon, status: 'skipped', reason: 'Snapshot not found' };
    }
    
    // Get outcome observation
    const outcome = await OutcomeObservationModel.findOne({ snapshotId }).lean();
    if (!outcome) {
      return { snapshotId, horizon, status: 'skipped', reason: 'Outcome not found' };
    }
    
    // Check if horizon data exists
    const horizonOutcome = outcome.horizons?.[horizon];
    if (!horizonOutcome) {
      return { snapshotId, horizon, status: 'skipped', reason: `No ${horizon} outcome data` };
    }
    
    // Get trend validation
    const trendValidation = await TrendValidationModel.findOne({ snapshotId }).lean();
    if (!trendValidation) {
      return { snapshotId, horizon, status: 'skipped', reason: 'Trend validation not found' };
    }
    
    // Get horizon trend data
    const horizonTrend = trendValidation.horizons?.[horizon];
    if (!horizonTrend) {
      return { snapshotId, horizon, status: 'skipped', reason: `No ${horizon} trend validation` };
    }
    
    // Extract data
    const bucket = snapshot.decision.bucket as Bucket;
    const trendLabel = horizonTrend.label as TrendLabel;
    const delayLabel = trendValidation.final.delay as DelayLabel;
    
    // Compute verdict
    const verdict = computeVerdict(bucket, trendLabel, delayLabel);
    
    // Extract signal contributions
    const signalContrib = extractSignalContrib(snapshot);
    
    // Build quality metrics
    const quality: LinkQuality = {
      liveApprovedCoverage: 1.0, // TODO: Calculate from actual approved coverage
      driftLevel: snapshot.liveContext.driftLevel as DriftLevel,
      confidenceModifierApplied: DRIFT_CONFIDENCE_MODIFIERS[snapshot.liveContext.driftLevel as DriftLevel] || 1.0,
      trendConfidence: trendValidation.final.confidence,
      dataCompleteness: calculateDataCompleteness(outcome, trendValidation),
    };
    
    // Create link
    const link: Omit<IAttributionOutcomeLink, 'createdAt' | 'updatedAt'> = {
      tokenAddress: snapshot.token.address.toLowerCase(),
      symbol: snapshot.token.symbol,
      snapshotId,
      horizon,
      bucketAtDecision: bucket,
      scoreAtDecision: snapshot.decision.score,
      confidenceAtDecision: snapshot.decision.confidence,
      riskAtDecision: snapshot.decision.risk,
      trendLabel,
      delayLabel,
      outcomeDeltaPct: horizonOutcome.returnPct,
      drawdownPct: horizonOutcome.maxDrawdownPct,
      volumeDeltaPct: horizonOutcome.volumeChangePct,
      signalContrib,
      verdict,
      quality,
      linkedAt: new Date(),
    };
    
    await AttributionOutcomeLinkModel.create(link);
    
    return { snapshotId, horizon, status: 'created', verdict };
    
  } catch (error: any) {
    return { snapshotId, horizon, status: 'error', reason: error.message };
  }
}

/**
 * Calculate data completeness score
 */
function calculateDataCompleteness(
  outcome: IOutcomeObservation,
  trend: ITrendValidation
): number {
  let score = 0;
  let total = 0;
  
  // Check outcome horizons
  for (const h of HORIZONS) {
    total++;
    if (outcome.horizons?.[h]) score++;
  }
  
  // Check trend horizons
  for (const h of HORIZONS) {
    total++;
    if (trend.horizons?.[h]) score++;
  }
  
  return Math.round((score / total) * 100) / 100;
}

/**
 * Build links for pending snapshots
 */
export async function buildLinksForPendingSnapshots(
  horizon: Horizon,
  limit: number = 100
): Promise<LinkBatchResult> {
  const result: LinkBatchResult = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };
  
  try {
    // Find trend validations with data for this horizon
    const trendValidations = await TrendValidationModel.find({
      [`horizons.${horizon}`]: { $exists: true },
    })
      .select('snapshotId')
      .limit(limit * 2)
      .lean();
    
    if (trendValidations.length === 0) {
      return result;
    }
    
    const snapshotIds = trendValidations.map(tv => tv.snapshotId);
    
    // Filter out already linked
    const existingLinks = await AttributionOutcomeLinkModel.find({
      snapshotId: { $in: snapshotIds },
      horizon,
    }).select('snapshotId').lean();
    
    const linkedSet = new Set(existingLinks.map(l => l.snapshotId));
    const pending = snapshotIds.filter(id => !linkedSet.has(id)).slice(0, limit);
    
    // Process each
    for (const snapshotId of pending) {
      const linkResult = await buildLink(snapshotId, horizon);
      result.details.push(linkResult);
      result.processed++;
      
      switch (linkResult.status) {
        case 'created':
          result.created++;
          break;
        case 'updated':
          result.updated++;
          break;
        case 'skipped':
          result.skipped++;
          break;
        case 'error':
          result.errors++;
          break;
      }
    }
    
    return result;
    
  } catch (error: any) {
    console.error('[AttributionLink] Batch build failed:', error);
    throw error;
  }
}

// ==================== QUERY FUNCTIONS ====================

/**
 * Get link by snapshot ID and horizon
 */
export async function getLinkBySnapshotAndHorizon(
  snapshotId: string,
  horizon: Horizon
): Promise<IAttributionOutcomeLink | null> {
  return AttributionOutcomeLinkModel.findOne({ snapshotId, horizon }).lean();
}

/**
 * Get links by token
 */
export async function getLinksByToken(
  tokenAddress: string,
  horizon?: Horizon,
  limit: number = 50
): Promise<IAttributionOutcomeLink[]> {
  const query: any = { tokenAddress: tokenAddress.toLowerCase() };
  if (horizon) query.horizon = horizon;
  
  return AttributionOutcomeLinkModel.find(query)
    .sort({ linkedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get link statistics
 */
export async function getLinkStats(horizon?: Horizon): Promise<{
  total: number;
  byVerdict: Record<Verdict, number>;
  byBucket: Record<Bucket, number>;
  avgConfidence: number;
  avgTrendConfidence: number;
  truePositiveRate: number;
  falsePositiveRate: number;
}> {
  const matchStage: any = {};
  if (horizon) matchStage.horizon = horizon;
  
  const [
    total,
    verdictCounts,
    bucketCounts,
    avgStats,
  ] = await Promise.all([
    AttributionOutcomeLinkModel.countDocuments(matchStage),
    AttributionOutcomeLinkModel.aggregate([
      { $match: matchStage },
      { $group: { _id: '$verdict', count: { $sum: 1 } } },
    ]),
    AttributionOutcomeLinkModel.aggregate([
      { $match: matchStage },
      { $group: { _id: '$bucketAtDecision', count: { $sum: 1 } } },
    ]),
    AttributionOutcomeLinkModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          avgConfidence: { $avg: '$confidenceAtDecision' },
          avgTrendConfidence: { $avg: '$quality.trendConfidence' },
        },
      },
    ]),
  ]);
  
  const byVerdict: Record<Verdict, number> = {
    TRUE_POSITIVE: 0,
    FALSE_POSITIVE: 0,
    TRUE_NEGATIVE: 0,
    FALSE_NEGATIVE: 0,
    MISSED: 0,
    DELAYED_TRUE: 0,
  };
  verdictCounts.forEach(v => {
    if (v._id in byVerdict) {
      byVerdict[v._id as Verdict] = v.count;
    }
  });
  
  const byBucket: Record<Bucket, number> = {
    BUY: 0,
    WATCH: 0,
    SELL: 0,
  };
  bucketCounts.forEach(b => {
    if (b._id in byBucket) {
      byBucket[b._id as Bucket] = b.count;
    }
  });
  
  const stats = avgStats[0] || {};
  
  // Calculate rates
  const positives = byVerdict.TRUE_POSITIVE + byVerdict.FALSE_POSITIVE + byVerdict.DELAYED_TRUE;
  const truePositiveRate = positives > 0 
    ? Math.round(((byVerdict.TRUE_POSITIVE + byVerdict.DELAYED_TRUE) / positives) * 100) 
    : 0;
  const falsePositiveRate = positives > 0 
    ? Math.round((byVerdict.FALSE_POSITIVE / positives) * 100) 
    : 0;
  
  return {
    total,
    byVerdict,
    byBucket,
    avgConfidence: Math.round((stats.avgConfidence || 0) * 100) / 100,
    avgTrendConfidence: Math.round((stats.avgTrendConfidence || 0) * 100) / 100,
    truePositiveRate,
    falsePositiveRate,
  };
}

/**
 * Get pending snapshots for linking
 */
export async function getPendingForLinking(
  horizon: Horizon,
  limit: number = 100
): Promise<string[]> {
  // Find trend validations with this horizon
  const trendValidations = await TrendValidationModel.find({
    [`horizons.${horizon}`]: { $exists: true },
  })
    .select('snapshotId')
    .lean();
  
  const snapshotIds = trendValidations.map(tv => tv.snapshotId);
  
  // Filter out already linked
  const existingLinks = await AttributionOutcomeLinkModel.find({
    snapshotId: { $in: snapshotIds },
    horizon,
  }).select('snapshotId').lean();
  
  const linkedSet = new Set(existingLinks.map(l => l.snapshotId));
  
  return snapshotIds
    .filter(id => !linkedSet.has(id))
    .slice(0, limit);
}
