/**
 * Strategy Profiles Repository
 */
import { 
  StrategyProfileModel, 
  IStrategyProfile, 
  StrategyType,
  RiskLevel,
  InfluenceLevel 
} from './strategy_profiles.model.js';
import type { StrategySortEnum } from './strategy_profiles.schema.js';

export interface StrategyProfileUpsertData {
  address: string;
  chain?: string;
  strategyType: StrategyType;
  secondaryStrategy?: StrategyType | null;
  confidence: number;
  stability: number;
  riskLevel: RiskLevel;
  influenceLevel: InfluenceLevel;
  avgHoldingTimeHours: number;
  preferredWindow: '1d' | '7d' | '30d';
  preferredAssets: string[];
  performanceProxy: IStrategyProfile['performanceProxy'];
  bundleBreakdown: IStrategyProfile['bundleBreakdown'];
  previousStrategy?: StrategyType | null;
  strategyChangesLast30d: number;
}

class StrategyProfilesRepository {
  /**
   * Upsert strategy profile
   */
  async upsert(data: StrategyProfileUpsertData): Promise<IStrategyProfile> {
    const result = await StrategyProfileModel.findOneAndUpdate(
      {
        address: data.address.toLowerCase(),
        chain: data.chain || 'ethereum',
      },
      {
        $set: {
          ...data,
          address: data.address.toLowerCase(),
          chain: data.chain || 'ethereum',
          detectedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    return result;
  }

  /**
   * Bulk upsert
   */
  async bulkUpsert(profiles: StrategyProfileUpsertData[]): Promise<number> {
    if (profiles.length === 0) return 0;

    const operations = profiles.map((profile) => ({
      updateOne: {
        filter: {
          address: profile.address.toLowerCase(),
          chain: profile.chain || 'ethereum',
        },
        update: {
          $set: {
            ...profile,
            address: profile.address.toLowerCase(),
            chain: profile.chain || 'ethereum',
            detectedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    const result = await StrategyProfileModel.bulkWrite(operations);
    return result.upsertedCount + result.modifiedCount;
  }

  /**
   * Find by address
   */
  async findByAddress(
    address: string,
    chain: string = 'ethereum'
  ): Promise<IStrategyProfile | null> {
    return StrategyProfileModel.findOne({
      address: address.toLowerCase(),
      chain,
    }).lean<IStrategyProfile>();
  }

  /**
   * Find top strategies
   */
  async findTop(options: {
    strategyType?: StrategyType;
    riskLevel?: RiskLevel;
    influenceLevel?: InfluenceLevel;
    minConfidence?: number;
    sort?: StrategySortEnum;
    limit?: number;
    offset?: number;
    chain?: string;
  }): Promise<IStrategyProfile[]> {
    const {
      strategyType,
      riskLevel,
      influenceLevel,
      minConfidence,
      sort = 'confidence',
      limit = 50,
      offset = 0,
      chain = 'ethereum',
    } = options;

    const query: Record<string, unknown> = { chain };

    if (strategyType) {
      query.strategyType = strategyType;
    }
    if (riskLevel) {
      query.riskLevel = riskLevel;
    }
    if (influenceLevel) {
      query.influenceLevel = influenceLevel;
    }
    if (minConfidence !== undefined) {
      query.confidence = { $gte: minConfidence };
    }

    // Sort mapping
    const sortField: Record<StrategySortEnum, Record<string, 1 | -1>> = {
      confidence: { confidence: -1 },
      stability: { stability: -1 },
      influence: { influenceLevel: -1, confidence: -1 },
      risk: { riskLevel: -1, confidence: -1 },
      recent: { detectedAt: -1 },
    };

    return StrategyProfileModel.find(query)
      .sort(sortField[sort])
      .skip(offset)
      .limit(limit)
      .lean<IStrategyProfile[]>();
  }

  /**
   * Find by strategy type
   */
  async findByStrategyType(
    strategyType: StrategyType,
    options: { limit?: number; minConfidence?: number; chain?: string } = {}
  ): Promise<IStrategyProfile[]> {
    const { limit = 50, minConfidence = 0, chain = 'ethereum' } = options;

    return StrategyProfileModel.find({
      strategyType,
      chain,
      confidence: { $gte: minConfidence },
    })
      .sort({ confidence: -1 })
      .limit(limit)
      .lean<IStrategyProfile[]>();
  }

  /**
   * Get stats
   */
  async getStats(chain: string = 'ethereum'): Promise<{
    totalProfiles: number;
    byStrategy: Record<string, number>;
    byRiskLevel: Record<string, number>;
    byInfluenceLevel: Record<string, number>;
    avgConfidence: number;
    avgStability: number;
  }> {
    const [
      totalProfiles,
      strategyAgg,
      riskAgg,
      influenceAgg,
      avgAgg,
    ] = await Promise.all([
      StrategyProfileModel.countDocuments({ chain }),
      StrategyProfileModel.aggregate([
        { $match: { chain } },
        { $group: { _id: '$strategyType', count: { $sum: 1 } } },
      ]),
      StrategyProfileModel.aggregate([
        { $match: { chain } },
        { $group: { _id: '$riskLevel', count: { $sum: 1 } } },
      ]),
      StrategyProfileModel.aggregate([
        { $match: { chain } },
        { $group: { _id: '$influenceLevel', count: { $sum: 1 } } },
      ]),
      StrategyProfileModel.aggregate([
        { $match: { chain } },
        {
          $group: {
            _id: null,
            avgConfidence: { $avg: '$confidence' },
            avgStability: { $avg: '$stability' },
          },
        },
      ]),
    ]);

    const byStrategy: Record<string, number> = {};
    strategyAgg.forEach((s: { _id: string; count: number }) => {
      byStrategy[s._id] = s.count;
    });

    const byRiskLevel: Record<string, number> = {};
    riskAgg.forEach((r: { _id: string; count: number }) => {
      byRiskLevel[r._id] = r.count;
    });

    const byInfluenceLevel: Record<string, number> = {};
    influenceAgg.forEach((i: { _id: string; count: number }) => {
      byInfluenceLevel[i._id] = i.count;
    });

    return {
      totalProfiles,
      byStrategy,
      byRiskLevel,
      byInfluenceLevel,
      avgConfidence: avgAgg[0]?.avgConfidence || 0,
      avgStability: avgAgg[0]?.avgStability || 0,
    };
  }

  /**
   * Get addresses needing profile update
   */
  async getAddressesNeedingUpdate(
    limit: number = 500,
    chain: string = 'ethereum'
  ): Promise<string[]> {
    // Get profiles not updated in last hour
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);

    const result = await StrategyProfileModel.find({
      chain,
      detectedAt: { $lt: cutoff },
    })
      .select('address')
      .limit(limit)
      .lean();

    return result.map((r: { address: string }) => r.address);
  }
}

export const strategyProfilesRepository = new StrategyProfilesRepository();
