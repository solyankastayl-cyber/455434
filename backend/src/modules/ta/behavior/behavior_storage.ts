/**
 * Phase AE1: Scenario Behaviour Storage
 * 
 * MongoDB operations for storing and retrieving scenario behaviour data.
 * Each scenario is stored as an experiment with:
 * - Pattern + Protocol + Context (input)
 * - Projection (expected)
 * - Outcome (result)
 */

import { Db, Collection, ObjectId } from 'mongodb';
import { 
  ScenarioBehaviour, 
  ScenarioOutcome,
  ScenarioProtocol,
  ScenarioContext,
  buildBehaviourKey,
  getDefaultProtocol,
  OutcomeStatus
} from './behavior_types.js';
import { getTimeframeSpec } from '../timeframe/timeframe_spec.js';

const COLLECTION_NAME = 'ta_scenario_behaviour';
const VERSION = '1.0.0';

// ═══════════════════════════════════════════════════════════════
// STORAGE CLASS
// ═══════════════════════════════════════════════════════════════

export class ScenarioBehaviourStorage {
  private collection: Collection<ScenarioBehaviour>;

  constructor(db: Db) {
    this.collection = db.collection<ScenarioBehaviour>(COLLECTION_NAME);
  }

  /**
   * Initialize indexes for efficient queries
   */
  async initialize(): Promise<void> {
    // Primary lookup by behaviourKey (for aggregating similar scenarios)
    await this.collection.createIndex(
      { behaviourKey: 1 },
      { background: true }
    );

    // Pattern + timeframe queries
    await this.collection.createIndex(
      { patternType: 1, timeframe: 1 },
      { background: true }
    );

    // Symbol + time queries
    await this.collection.createIndex(
      { symbol: 1, createdAt: -1 },
      { background: true }
    );

    // Outcome status for pending resolution
    await this.collection.createIndex(
      { 'outcome.status': 1, signalTs: 1 },
      { background: true }
    );

    // Context-based queries for conditional stats
    await this.collection.createIndex(
      { patternType: 1, 'context.regime': 1 },
      { background: true }
    );

    await this.collection.createIndex(
      { patternType: 1, 'context.volumeSpike': 1 },
      { background: true }
    );

    console.log(`[BehaviourStorage] Indexes created for ${COLLECTION_NAME}`);
  }

  /**
   * Save new scenario behaviour record
   */
  async saveScenario(input: {
    runId: string;
    scenarioId: string;
    symbol: string;
    timeframe: string;
    patternType: string;
    patternGroup: string;
    direction: 'BULLISH' | 'BEARISH';
    patternScore: number;
    protocol?: ScenarioProtocol;
    context: ScenarioContext;
    projection: {
      entry: number;
      stop: number;
      target: number;
      target2?: number;
      riskReward: number;
      probability: number;
    };
    signalBar: number;
  }): Promise<string> {
    const protocol = input.protocol || getDefaultProtocol(input.patternType);
    const behaviourKey = buildBehaviourKey(input.patternType, protocol, input.timeframe);

    const record: ScenarioBehaviour = {
      runId: input.runId,
      scenarioId: input.scenarioId,
      behaviourKey,
      symbol: input.symbol,
      timeframe: input.timeframe,
      patternType: input.patternType,
      patternGroup: input.patternGroup,
      direction: input.direction,
      patternScore: input.patternScore,
      protocol,
      context: input.context,
      projection: input.projection,
      signalTs: new Date(),
      signalBar: input.signalBar,
      outcome: {
        status: 'PENDING',
        barsToOutcome: 0,
        mfe: 0,
        mae: 0,
        closedBy: 'NO_ENTRY',
      },
      createdAt: new Date(),
      version: VERSION,
    };

    const result = await this.collection.insertOne(record as any);
    return result.insertedId.toString();
  }

  /**
   * Update scenario outcome
   */
  async updateOutcome(
    scenarioId: string,
    outcome: ScenarioOutcome
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      { scenarioId },
      {
        $set: {
          outcome,
          updatedAt: new Date(),
        },
      }
    );
    return result.modifiedCount > 0;
  }

  /**
   * Get scenario by ID
   */
  async getScenario(scenarioId: string): Promise<ScenarioBehaviour | null> {
    return this.collection.findOne({ scenarioId });
  }

  /**
   * Get pending scenarios for outcome resolution
   */
  async getPendingScenarios(symbol?: string): Promise<ScenarioBehaviour[]> {
    const query: any = { 'outcome.status': 'PENDING' };
    if (symbol) query.symbol = symbol;
    
    return this.collection
      .find(query)
      .sort({ signalTs: 1 })
      .toArray();
  }

  /**
   * Get scenarios by pattern type
   */
  async getByPatternType(
    patternType: string,
    options?: { limit?: number; timeframe?: string }
  ): Promise<ScenarioBehaviour[]> {
    const query: any = { patternType };
    if (options?.timeframe) query.timeframe = options.timeframe;

    return this.collection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(options?.limit || 100)
      .toArray();
  }

  /**
   * Get scenarios by behaviour key
   */
  async getByBehaviourKey(
    behaviourKey: string,
    options?: { limit?: number }
  ): Promise<ScenarioBehaviour[]> {
    return this.collection
      .find({ behaviourKey })
      .sort({ createdAt: -1 })
      .limit(options?.limit || 100)
      .toArray();
  }

  /**
   * Count scenarios by status
   */
  async countByStatus(): Promise<Record<OutcomeStatus, number>> {
    const pipeline = [
      {
        $group: {
          _id: '$outcome.status',
          count: { $sum: 1 },
        },
      },
    ];

    const results = await this.collection.aggregate(pipeline).toArray();
    const counts: Record<string, number> = {
      PENDING: 0,
      WIN: 0,
      LOSS: 0,
      TIMEOUT: 0,
      NO_ENTRY: 0,
      PARTIAL: 0,
    };

    for (const r of results) {
      counts[r._id] = r.count;
    }

    return counts as Record<OutcomeStatus, number>;
  }

  /**
   * Get total count
   */
  async getTotalCount(): Promise<number> {
    return this.collection.countDocuments();
  }

  /**
   * Get collection for direct queries
   */
  getCollection(): Collection<ScenarioBehaviour> {
    return this.collection;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let storageInstance: ScenarioBehaviourStorage | null = null;

export function initBehaviourStorage(db: Db): ScenarioBehaviourStorage {
  storageInstance = new ScenarioBehaviourStorage(db);
  return storageInstance;
}

export function getBehaviourStorage(): ScenarioBehaviourStorage | null {
  return storageInstance;
}
