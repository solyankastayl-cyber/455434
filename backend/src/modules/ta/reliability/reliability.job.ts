/**
 * Phase R9: Reliability Rebuild Job
 * Rebuilds reliability stats from historical outcomes
 */

import { Db } from 'mongodb';
import { betaMean, shrinkToPrior } from './utils/smoothing.js';
import { ReliabilityKey, DEFAULT_RELIABILITY_CONFIG } from './reliability.types.js';

export interface RebuildResult {
  keysProcessed: number;
  outcomesProcessed: number;
  duration: number;
}

/**
 * Rebuild reliability stats from ta_outcomes collection
 */
export async function rebuildReliability(db: Db): Promise<RebuildResult> {
  const startTime = Date.now();
  
  // Aggregate outcomes
  const agg = new Map<string, {
    patternType: string;
    timeframe: string;
    regime: string;
    volRegime?: string;
    n: number;
    wins: number;
    losses: number;
    timeouts: number;
    noEntry: number;
    sumMFE: number;
    sumMAE: number;
    sumRR: number;
  }>();
  
  const cursor = db.collection('ta_outcomes').find({
    status: { $in: ['WIN', 'LOSS', 'TIMEOUT', 'NO_ENTRY'] }
  });
  
  let outcomesProcessed = 0;
  
  while (await cursor.hasNext()) {
    const o = await cursor.next();
    if (!o) continue;
    
    outcomesProcessed++;
    
    const key: ReliabilityKey = {
      patternType: o.patternType || 'UNKNOWN',
      timeframe: o.timeframe || '1D',
      regime: o.regime || 'TRANSITION',
      volRegime: o.volRegime,
    };
    
    const id = JSON.stringify(key);
    
    const row = agg.get(id) ?? {
      ...key,
      n: 0,
      wins: 0,
      losses: 0,
      timeouts: 0,
      noEntry: 0,
      sumMFE: 0,
      sumMAE: 0,
      sumRR: 0,
    };
    
    row.n += 1;
    
    switch (o.status) {
      case 'WIN':
        row.wins += 1;
        break;
      case 'LOSS':
        row.losses += 1;
        break;
      case 'TIMEOUT':
        row.timeouts += 1;
        break;
      case 'NO_ENTRY':
        row.noEntry += 1;
        break;
    }
    
    row.sumMFE += o.mfe ?? 0;
    row.sumMAE += o.mae ?? 0;
    row.sumRR += o.rrToT1 ?? 0;
    
    agg.set(id, row);
  }
  
  // Write aggregated stats to ta_pattern_reliability
  for (const row of agg.values()) {
    const decided = row.wins + row.losses;
    const winRate = decided > 0 ? row.wins / decided : 0;
    
    const pBeta = betaMean(row.wins, row.losses, 2, 2);
    const pWinSmoothed = shrinkToPrior(
      pBeta,
      row.n,
      DEFAULT_RELIABILITY_CONFIG.smoothingStrength,
      DEFAULT_RELIABILITY_CONFIG.prior
    );
    
    await db.collection('ta_pattern_reliability').updateOne(
      {
        patternType: row.patternType,
        timeframe: row.timeframe,
        regime: row.regime,
        volRegime: row.volRegime,
      },
      {
        $set: {
          n: row.n,
          wins: row.wins,
          losses: row.losses,
          timeouts: row.timeouts,
          noEntry: row.noEntry,
          avgMFE: row.n > 0 ? row.sumMFE / row.n : 0,
          avgMAE: row.n > 0 ? row.sumMAE / row.n : 0,
          avgRR: row.n > 0 ? row.sumRR / row.n : 0,
          winRate,
          pWinSmoothed,
          updatedAt: Date.now(),
        },
      },
      { upsert: true }
    );
  }
  
  const duration = Date.now() - startTime;
  
  return {
    keysProcessed: agg.size,
    outcomesProcessed,
    duration,
  };
}

/**
 * Rebuild stats for a specific pattern type only
 */
export async function rebuildPatternType(
  db: Db,
  patternType: string
): Promise<RebuildResult> {
  const startTime = Date.now();
  
  const pipeline = [
    { $match: { patternType, status: { $in: ['WIN', 'LOSS'] } } },
    {
      $group: {
        _id: {
          patternType: '$patternType',
          timeframe: '$timeframe',
          regime: '$regime',
        },
        n: { $sum: 1 },
        wins: { $sum: { $cond: [{ $eq: ['$status', 'WIN'] }, 1, 0] } },
        losses: { $sum: { $cond: [{ $eq: ['$status', 'LOSS'] }, 1, 0] } },
        sumMFE: { $sum: { $ifNull: ['$mfe', 0] } },
        sumMAE: { $sum: { $ifNull: ['$mae', 0] } },
        sumRR: { $sum: { $ifNull: ['$rrToT1', 0] } },
      },
    },
  ];
  
  const results = await db.collection('ta_outcomes').aggregate(pipeline).toArray();
  
  for (const row of results) {
    const decided = row.wins + row.losses;
    const winRate = decided > 0 ? row.wins / decided : 0;
    const pBeta = betaMean(row.wins, row.losses, 2, 2);
    const pWinSmoothed = shrinkToPrior(pBeta, row.n, 30, 0.5);
    
    await db.collection('ta_pattern_reliability').updateOne(
      row._id,
      {
        $set: {
          n: row.n,
          wins: row.wins,
          losses: row.losses,
          avgMFE: row.n > 0 ? row.sumMFE / row.n : 0,
          avgMAE: row.n > 0 ? row.sumMAE / row.n : 0,
          avgRR: row.n > 0 ? row.sumRR / row.n : 0,
          winRate,
          pWinSmoothed,
          updatedAt: Date.now(),
        },
      },
      { upsert: true }
    );
  }
  
  return {
    keysProcessed: results.length,
    outcomesProcessed: results.reduce((s, r) => s + r.n, 0),
    duration: Date.now() - startTime,
  };
}
