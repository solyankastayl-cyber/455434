/**
 * Data Accumulation Service
 * 
 * Logs engine decisions and backfills price outcomes
 */
import { EngineDecisionLogModel, type IEngineDecisionLog } from './engine_decision_log.model.js';
import { PriceOutcomeModel, type IPriceOutcome } from './price_outcome.model.js';
import { getLatestPrice, getHistoricalPrice } from './price_service.js';
import { 
  calcReturnPct, 
  classifyReturn, 
  isHorizonReached, 
  getHorizonTime,
  type Horizon 
} from './label_classifier.js';
import { decideV2 } from '../engine_v2/engine_v2.service.js';
import { getLatestRankings } from '../rankings_v2/rankings_v2.service.js';
import type { EngineWindow } from '../engine_v2/signals_fetcher.js';

const HORIZONS: Horizon[] = ['1h', '6h', '24h', '72h', '7d'];

/**
 * Log an Engine V2 decision
 */
export async function logEngineDecision(
  decision: any,
  subjectId: string,
  subjectKind: string = 'entity'
): Promise<IEngineDecisionLog | null> {
  try {
    // Get current price
    const priceData = await getLatestPrice(subjectId);
    
    const log = await EngineDecisionLogModel.create({
      subject: { kind: subjectKind, id: subjectId },
      window: decision.window,
      computedAt: new Date(decision.computedAt),
      decision: decision.decision,
      confidenceBand: decision.confidenceBand,
      scores: decision.scores,
      gating: decision.gating,
      health: decision.health,
      notes: decision.notes,
      topSignals: decision.attribution?.topSignals?.slice(0, 10) || [],
      shadow: { enabled: false },
      price0: priceData?.price,
      priceSource: priceData?.source,
      meta: { engineVersion: 'v2' },
    });
    
    // Create price outcome record with empty horizons
    if (priceData?.price) {
      await PriceOutcomeModel.create({
        subject: { kind: subjectKind, id: subjectId },
        decisionLogId: log._id,
        t0: log.computedAt,
        price0: priceData.price,
        horizons: HORIZONS.map(h => ({ h })),
        meta: { priceSource: priceData.source, ok: true },
      });
    }
    
    return log;
  } catch (error) {
    console.error('[DataAccum] Error logging decision:', error);
    return null;
  }
}

/**
 * Run decision snapshot for top tokens
 */
export async function runDecisionSnapshot(
  window: EngineWindow = '24h',
  limit: number = 50
): Promise<{ logged: number; errors: number }> {
  let logged = 0;
  let errors = 0;
  
  try {
    // Get universe from Rankings V2
    const rankings = await getLatestRankings(window, undefined, limit);
    
    for (const ranking of rankings) {
      try {
        const decision = await decideV2({
          asset: ranking.subject.id,
          window,
        });
        
        if (decision) {
          await logEngineDecision(decision, ranking.subject.id, ranking.subject.kind);
          logged++;
        }
      } catch (err) {
        console.error(`[DataAccum] Error for ${ranking.subject.id}:`, err);
        errors++;
      }
      
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 100));
    }
    
    // If no rankings, use default tokens
    if (rankings.length === 0) {
      const defaultTokens = ['ETH', 'BTC', 'USDT', 'BNB', 'SOL'];
      for (const token of defaultTokens) {
        try {
          const decision = await decideV2({ asset: token, window });
          if (decision) {
            await logEngineDecision(decision, token, 'entity');
            logged++;
          }
        } catch (err) {
          errors++;
        }
      }
    }
  } catch (error) {
    console.error('[DataAccum] Snapshot error:', error);
  }
  
  return { logged, errors };
}

/**
 * Backfill price outcomes for decision logs
 */
export async function backfillOutcomes(
  limit: number = 100
): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;
  
  try {
    // Find outcomes with incomplete horizons
    const outcomes = await PriceOutcomeModel.find({
      'horizons.price1': { $exists: false },
    })
      .sort({ t0: -1 })
      .limit(limit)
      .lean();
    
    for (const outcome of outcomes) {
      try {
        let needsUpdate = false;
        
        for (const horizon of outcome.horizons) {
          // Skip if already filled
          if (horizon.price1 !== undefined) continue;
          
          // Check if horizon has been reached
          if (!isHorizonReached(outcome.t0, horizon.h as Horizon)) continue;
          
          // Get historical price
          const t1 = getHorizonTime(outcome.t0, horizon.h as Horizon);
          const priceData = await getHistoricalPrice(outcome.subject.id, t1);
          
          if (priceData?.price) {
            horizon.t1 = t1;
            horizon.price1 = priceData.price;
            horizon.retPct = calcReturnPct(outcome.price0, priceData.price);
            horizon.label = classifyReturn(horizon.retPct, horizon.h as Horizon);
            needsUpdate = true;
          }
          
          // Small delay
          await new Promise(r => setTimeout(r, 200));
        }
        
        if (needsUpdate) {
          await PriceOutcomeModel.updateOne(
            { _id: outcome._id },
            { $set: { horizons: outcome.horizons } }
          );
          updated++;
        }
      } catch (err) {
        console.error(`[DataAccum] Backfill error for ${outcome.subject.id}:`, err);
        errors++;
      }
    }
  } catch (error) {
    console.error('[DataAccum] Backfill error:', error);
  }
  
  return { updated, errors };
}

/**
 * Get ML dataset stats
 */
export async function getDatasetStats(): Promise<{
  totalDecisions: number;
  totalOutcomes: number;
  labeledOutcomes: number;
  labelDistribution: Record<string, number>;
  horizonCoverage: Record<string, number>;
}> {
  const [totalDecisions, totalOutcomes, outcomes] = await Promise.all([
    EngineDecisionLogModel.countDocuments(),
    PriceOutcomeModel.countDocuments(),
    PriceOutcomeModel.find({ 'horizons.label': { $exists: true } }).lean(),
  ]);
  
  const labelDistribution: Record<string, number> = { UP: 0, DOWN: 0, FLAT: 0 };
  const horizonCoverage: Record<string, number> = {};
  
  for (const outcome of outcomes) {
    for (const h of outcome.horizons) {
      if (h.label) {
        labelDistribution[h.label] = (labelDistribution[h.label] || 0) + 1;
        horizonCoverage[h.h] = (horizonCoverage[h.h] || 0) + 1;
      }
    }
  }
  
  return {
    totalDecisions,
    totalOutcomes,
    labeledOutcomes: outcomes.length,
    labelDistribution,
    horizonCoverage,
  };
}

/**
 * Export ML-ready dataset
 */
export async function exportMLDataset(params: {
  window?: EngineWindow;
  horizon?: Horizon;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<any[]> {
  const {
    window = '24h',
    horizon = '24h',
    from,
    to,
    limit = 1000,
  } = params;
  
  const query: any = {};
  if (from || to) {
    query.t0 = {};
    if (from) query.t0.$gte = from;
    if (to) query.t0.$lte = to;
  }
  
  const outcomes = await PriceOutcomeModel.find(query)
    .sort({ t0: -1 })
    .limit(limit)
    .populate('decisionLogId')
    .lean();
  
  const dataset: any[] = [];
  
  for (const outcome of outcomes) {
    const decisionLog = outcome.decisionLogId as any;
    if (!decisionLog) continue;
    
    const horizonData = outcome.horizons.find(h => h.h === horizon);
    if (!horizonData?.label) continue;
    
    // Build feature row
    dataset.push({
      // Subject
      subjectId: outcome.subject.id,
      subjectKind: outcome.subject.kind,
      
      // Time
      t0: outcome.t0,
      window: decisionLog.window,
      
      // Features: Engine scores
      evidence: decisionLog.scores?.evidence,
      direction: decisionLog.scores?.direction,
      risk: decisionLog.scores?.risk,
      coverage: decisionLog.scores?.coverage,
      confidence: decisionLog.scores?.confidence,
      
      // Features: Health
      engineStatus: decisionLog.health?.engineStatus,
      driftFlagsCount: decisionLog.health?.driftFlags?.length || 0,
      
      // Features: Gating
      gatingBlocked: decisionLog.gating?.blocked ? 1 : 0,
      gatingReasonCount: decisionLog.gating?.reasons?.length || 0,
      
      // Features: Signals
      topSignalsCount: decisionLog.topSignals?.length || 0,
      avgSignalContribution: decisionLog.topSignals?.length 
        ? decisionLog.topSignals.reduce((s: number, t: any) => s + (t.contribution || 0), 0) / decisionLog.topSignals.length
        : 0,
      
      // Decision
      decision: decisionLog.decision,
      
      // Label
      horizon,
      retPct: horizonData.retPct,
      label: horizonData.label,
      
      // Prices
      price0: outcome.price0,
      price1: horizonData.price1,
    });
  }
  
  return dataset;
}
