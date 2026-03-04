/**
 * Scores Repository
 * Database operations for scores
 */
import { ScoreModel, IScore, ScoreSubjectType, ScoreWindow } from './scores.model.js';
import type { ScoreSort, ScoreTier } from './scores.schema.js';

export interface ScoreFilter {
  subjectType?: ScoreSubjectType;
  subjectId?: string;
  window?: ScoreWindow;
  tier?: ScoreTier;
  minComposite?: number;
  maxRisk?: number;
}

export interface ScoreUpsertData {
  subjectType: ScoreSubjectType;
  subjectId: string;
  window: ScoreWindow;
  behaviorScore: number;
  intensityScore: number;
  consistencyScore: number;
  riskScore: number;
  influenceScore: number;
  compositeScore: number;
  tier: 'green' | 'yellow' | 'orange' | 'red';
  breakdown: IScore['breakdown'];
  chain?: string;
}

class ScoresRepository {
  /**
   * Upsert score (create or update)
   */
  async upsert(data: ScoreUpsertData): Promise<IScore> {
    const result = await ScoreModel.findOneAndUpdate(
      {
        subjectType: data.subjectType,
        subjectId: data.subjectId.toLowerCase(),
        window: data.window,
      },
      {
        $set: {
          ...data,
          subjectId: data.subjectId.toLowerCase(),
          chain: data.chain || 'ethereum',
          calculatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    return result;
  }

  /**
   * Bulk upsert scores
   */
  async bulkUpsert(scores: ScoreUpsertData[]): Promise<number> {
    if (scores.length === 0) return 0;

    const operations = scores.map((score) => ({
      updateOne: {
        filter: {
          subjectType: score.subjectType,
          subjectId: score.subjectId.toLowerCase(),
          window: score.window,
        },
        update: {
          $set: {
            ...score,
            subjectId: score.subjectId.toLowerCase(),
            chain: score.chain || 'ethereum',
            calculatedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    const result = await ScoreModel.bulkWrite(operations);
    return result.upsertedCount + result.modifiedCount;
  }

  /**
   * Find score by subject
   */
  async findBySubject(
    subjectType: ScoreSubjectType,
    subjectId: string,
    window: ScoreWindow = '30d'
  ): Promise<IScore | null> {
    return ScoreModel.findOne({
      subjectType,
      subjectId: subjectId.toLowerCase(),
      window,
    }).lean<IScore>();
  }

  /**
   * Find scores for address (all windows)
   */
  async findByAddress(address: string): Promise<IScore[]> {
    return ScoreModel.find({
      subjectType: 'address',
      subjectId: address.toLowerCase(),
    })
      .sort({ window: 1 })
      .lean<IScore[]>();
  }

  /**
   * Find top scores
   */
  async findTop(options: {
    subjectType?: ScoreSubjectType;
    sort?: ScoreSort;
    tier?: ScoreTier;
    window?: ScoreWindow;
    limit?: number;
    offset?: number;
  }): Promise<IScore[]> {
    const {
      subjectType = 'address',
      sort = 'composite',
      tier,
      window = '30d',
      limit = 50,
      offset = 0,
    } = options;

    const query: Record<string, unknown> = {
      subjectType,
      window,
    };

    if (tier) {
      query.tier = tier;
    }

    // Sort mapping
    const sortField: Record<ScoreSort, string> = {
      composite: 'compositeScore',
      behavior: 'behaviorScore',
      intensity: 'intensityScore',
      consistency: 'consistencyScore',
      risk: 'riskScore',
      influence: 'influenceScore',
    };

    return ScoreModel.find(query)
      .sort({ [sortField[sort]]: -1 })
      .skip(offset)
      .limit(limit)
      .lean<IScore[]>();
  }

  /**
   * Find scores for multiple addresses (watchlist)
   */
  async findByAddresses(
    addresses: string[],
    window: ScoreWindow = '30d'
  ): Promise<IScore[]> {
    return ScoreModel.find({
      subjectType: 'address',
      subjectId: { $in: addresses.map((a) => a.toLowerCase()) },
      window,
    })
      .sort({ compositeScore: -1 })
      .lean<IScore[]>();
  }

  /**
   * Get stats
   */
  async getStats(): Promise<{
    totalScored: number;
    byTier: Record<string, number>;
    byWindow: Record<string, number>;
    avgComposite: number;
    lastCalculated: Date | null;
  }> {
    const [totalScored, tierAgg, windowAgg, avgAgg, lastScore] = await Promise.all([
      ScoreModel.countDocuments(),
      ScoreModel.aggregate([
        { $group: { _id: '$tier', count: { $sum: 1 } } },
      ]),
      ScoreModel.aggregate([
        { $group: { _id: '$window', count: { $sum: 1 } } },
      ]),
      ScoreModel.aggregate([
        { $group: { _id: null, avg: { $avg: '$compositeScore' } } },
      ]),
      ScoreModel.findOne().sort({ calculatedAt: -1 }).select('calculatedAt'),
    ]);

    const byTier: Record<string, number> = {};
    tierAgg.forEach((t: { _id: string; count: number }) => {
      byTier[t._id] = t.count;
    });

    const byWindow: Record<string, number> = {};
    windowAgg.forEach((w: { _id: string; count: number }) => {
      byWindow[w._id] = w.count;
    });

    return {
      totalScored,
      byTier,
      byWindow,
      avgComposite: avgAgg[0]?.avg || 0,
      lastCalculated: lastScore?.calculatedAt || null,
    };
  }

  /**
   * Delete old scores
   */
  async deleteOld(olderThan: Date): Promise<number> {
    const result = await ScoreModel.deleteMany({
      calculatedAt: { $lt: olderThan },
    });
    return result.deletedCount;
  }
}

export const scoresRepository = new ScoresRepository();
