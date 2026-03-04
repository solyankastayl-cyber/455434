/**
 * ALT SCANNER REPOSITORY
 * ======================
 * 
 * Database operations for Alt Scanner data.
 */

import {
  ClusterLearningSampleModel,
  PatternPerformanceModel,
  ShadowTradeModel,
  DailySnapshotModel,
  StrategyRecordModel,
  type IClusterLearningSample,
  type IPatternPerformance,
  type IShadowTrade,
  type IDailySnapshot,
  type IStrategyRecord,
} from './alt-scanner.models.js';

// ═══════════════════════════════════════════════════════════════
// CLUSTER LEARNING SAMPLES
// ═══════════════════════════════════════════════════════════════

export const clusterSampleRepo = {
  async save(sample: Partial<IClusterLearningSample>): Promise<IClusterLearningSample> {
    const doc = new ClusterLearningSampleModel(sample);
    return await doc.save();
  },

  async saveBatch(samples: Partial<IClusterLearningSample>[]): Promise<number> {
    if (samples.length === 0) return 0;
    const result = await ClusterLearningSampleModel.insertMany(samples, { ordered: false });
    return result.length;
  },

  async getRecent(limit: number = 500): Promise<IClusterLearningSample[]> {
    return await ClusterLearningSampleModel
      .find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
  },

  async getByCluster(clusterId: string, limit: number = 100): Promise<IClusterLearningSample[]> {
    return await ClusterLearningSampleModel
      .find({ clusterId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
  },

  async getForTraining(minSamples: number = 100): Promise<IClusterLearningSample[]> {
    return await ClusterLearningSampleModel
      .find()
      .sort({ timestamp: -1 })
      .limit(minSamples * 2) // Get extra for validation split
      .lean();
  },

  async count(): Promise<number> {
    return await ClusterLearningSampleModel.countDocuments();
  },

  async countByOutcome(): Promise<{ UP: number; FLAT: number; DOWN: number }> {
    const results = await ClusterLearningSampleModel.aggregate([
      { $group: { _id: '$outcomeClass', count: { $sum: 1 } } }
    ]);
    const counts = { UP: 0, FLAT: 0, DOWN: 0 };
    for (const r of results) {
      if (r._id in counts) counts[r._id as keyof typeof counts] = r.count;
    }
    return counts;
  },
};

// ═══════════════════════════════════════════════════════════════
// PATTERN PERFORMANCE
// ═══════════════════════════════════════════════════════════════

export const patternPerfRepo = {
  async upsert(patternId: string, data: Partial<IPatternPerformance>): Promise<IPatternPerformance | null> {
    return await PatternPerformanceModel.findOneAndUpdate(
      { patternId },
      { $set: { ...data, lastUpdated: new Date() } },
      { upsert: true, new: true }
    );
  },

  async get(patternId: string): Promise<IPatternPerformance | null> {
    return await PatternPerformanceModel.findOne({ patternId }).lean();
  },

  async getAll(): Promise<IPatternPerformance[]> {
    return await PatternPerformanceModel.find().lean();
  },

  async getActive(days: number = 7): Promise<IPatternPerformance[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return await PatternPerformanceModel
      .find({ lastSeen: { $gte: since } })
      .sort({ hitRate: -1 })
      .lean();
  },

  async getTop(limit: number = 10): Promise<IPatternPerformance[]> {
    return await PatternPerformanceModel
      .find({ totalTrades: { $gte: 5 } })
      .sort({ hitRate: -1 })
      .limit(limit)
      .lean();
  },

  async incrementTrade(
    patternId: string, 
    isWin: boolean, 
    returnPct: number
  ): Promise<void> {
    const update: any = {
      $inc: { totalTrades: 1, [isWin ? 'wins' : 'losses']: 1 },
      $set: { lastSeen: new Date(), lastUpdated: new Date() }
    };
    
    if (returnPct > 0) {
      update.$max = { maxReturn: returnPct };
    } else {
      update.$min = { maxLoss: returnPct };
    }
    
    await PatternPerformanceModel.updateOne({ patternId }, update);
  },
};

// ═══════════════════════════════════════════════════════════════
// SHADOW TRADES
// ═══════════════════════════════════════════════════════════════

export const shadowTradeRepo = {
  async create(trade: Partial<IShadowTrade>): Promise<IShadowTrade> {
    const doc = new ShadowTradeModel(trade);
    return await doc.save();
  },

  async close(
    tradeId: string, 
    exitPrice: number, 
    returnPct: number, 
    outcome: IShadowTrade['outcome']
  ): Promise<IShadowTrade | null> {
    return await ShadowTradeModel.findOneAndUpdate(
      { tradeId },
      {
        $set: {
          exitPrice,
          exitTime: new Date(),
          returnPct,
          outcome,
          status: 'CLOSED'
        }
      },
      { new: true }
    );
  },

  async getOpen(): Promise<IShadowTrade[]> {
    return await ShadowTradeModel
      .find({ status: 'OPEN' })
      .sort({ entryTime: -1 })
      .lean();
  },

  async getRecent(limit: number = 50): Promise<IShadowTrade[]> {
    return await ShadowTradeModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  },

  async getClosed(limit: number = 100): Promise<IShadowTrade[]> {
    return await ShadowTradeModel
      .find({ status: 'CLOSED' })
      .sort({ exitTime: -1 })
      .limit(limit)
      .lean();
  },

  async getMetrics(period: '7d' | '30d' | 'all' = '30d'): Promise<{
    totalTrades: number;
    wins: number;
    losses: number;
    hitRate: number;
    avgReturn: number;
    totalPnL: number;
  }> {
    let dateFilter = {};
    if (period !== 'all') {
      const days = period === '7d' ? 7 : 30;
      dateFilter = { exitTime: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } };
    }

    const trades = await ShadowTradeModel
      .find({ status: 'CLOSED', ...dateFilter })
      .lean();

    const wins = trades.filter(t => t.outcome === 'TP').length;
    const losses = trades.filter(t => t.outcome === 'FP').length;
    const totalTrades = trades.length;
    const avgReturn = totalTrades > 0 
      ? trades.reduce((sum, t) => sum + (t.returnPct || 0), 0) / totalTrades 
      : 0;
    const totalPnL = trades.reduce((sum, t) => sum + (t.returnPct || 0), 0);

    return {
      totalTrades,
      wins,
      losses,
      hitRate: totalTrades > 0 ? wins / totalTrades : 0,
      avgReturn,
      totalPnL,
    };
  },

  async countOpen(): Promise<number> {
    return await ShadowTradeModel.countDocuments({ status: 'OPEN' });
  },
};

// ═══════════════════════════════════════════════════════════════
// DAILY SNAPSHOTS
// ═══════════════════════════════════════════════════════════════

export const snapshotRepo = {
  async save(snapshot: Partial<IDailySnapshot>): Promise<IDailySnapshot> {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    
    return await DailySnapshotModel.findOneAndUpdate(
      { date, venue: snapshot.venue || 'BYBIT' },
      { $set: { ...snapshot, date } },
      { upsert: true, new: true }
    );
  },

  async getRecent(days: number = 30): Promise<IDailySnapshot[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return await DailySnapshotModel
      .find({ date: { $gte: since } })
      .sort({ date: -1 })
      .lean();
  },

  async getByDate(date: Date): Promise<IDailySnapshot | null> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    return await DailySnapshotModel.findOne({ date: startOfDay }).lean();
  },

  async getLatest(): Promise<IDailySnapshot | null> {
    return await DailySnapshotModel.findOne().sort({ date: -1 }).lean();
  },
};

// ═══════════════════════════════════════════════════════════════
// STRATEGIES
// ═══════════════════════════════════════════════════════════════

export const strategyRepo = {
  async create(strategy: Partial<IStrategyRecord>): Promise<IStrategyRecord> {
    const doc = new StrategyRecordModel(strategy);
    return await doc.save();
  },

  async update(strategyId: string, data: Partial<IStrategyRecord>): Promise<IStrategyRecord | null> {
    return await StrategyRecordModel.findOneAndUpdate(
      { strategyId },
      { $set: data },
      { new: true }
    );
  },

  async get(strategyId: string): Promise<IStrategyRecord | null> {
    return await StrategyRecordModel.findOne({ strategyId }).lean();
  },

  async getAll(): Promise<IStrategyRecord[]> {
    return await StrategyRecordModel.find().lean();
  },

  async getActive(): Promise<IStrategyRecord[]> {
    return await StrategyRecordModel.find({ status: 'ACTIVE' }).lean();
  },

  async setStatus(
    strategyId: string, 
    status: IStrategyRecord['status'], 
    reason?: string
  ): Promise<void> {
    const update: any = { status };
    if (status === 'ACTIVE') {
      update.lastActivatedAt = new Date();
      update.pauseReason = null;
    } else {
      update.lastDisabledAt = new Date();
      if (reason) update.pauseReason = reason;
    }
    await StrategyRecordModel.updateOne({ strategyId }, { $set: update });
  },
};

console.log('[AltScanner] Repository loaded');
