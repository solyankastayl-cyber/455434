/**
 * Phase AE2.1: Behaviour Builder Job
 * 
 * Builds a behaviour model snapshot from ta_scenario_behaviour data.
 * The model captures empirical win rates and calculates boosts.
 */

import { Collection, Db } from 'mongodb';
import { v4 as uuid } from 'uuid';
import { 
  BehaviourModel, 
  BehaviourKeyStats, 
  ConditionStats,
  BehaviourModelRules,
  DEFAULT_BEHAVIOUR_RULES
} from './behaviour_model_types.js';
import { ScenarioBehaviour, ScenarioContext } from './behavior_types.js';

const BEHAVIOUR_MODELS_COLLECTION = 'ta_behaviour_models';

// ═══════════════════════════════════════════════════════════════
// CONFIDENCE CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate confidence based on sample size using Wilson score approximation
 */
function calculateConfidence(n: number, scale: number = 150): number {
  if (n === 0) return 0;
  // Asymptotic to 1, reaches ~0.9 at n=scale
  return 1 - Math.exp(-n / scale);
}

// ═══════════════════════════════════════════════════════════════
// BOOST CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate boost with Bayesian shrinkage to prevent overfitting
 */
function calculateBoost(
  winRate: number,
  baseline: number,
  confidence: number,
  rules: BehaviourModelRules
): number {
  const rawDelta = winRate - baseline;
  
  // Apply shrinkage and confidence weighting
  const shrunk = rawDelta * rules.globalShrink * confidence;
  
  // Clamp to limits
  return Math.max(-rules.maxPenalty, Math.min(rules.maxBoost, shrunk));
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATION
// ═══════════════════════════════════════════════════════════════

type RawStats = {
  n: number;
  wins: number;
  losses: number;
  totalR: number;
  totalMFE: number;
  totalMAE: number;
};

function aggregateByKey(rows: ScenarioBehaviour[]): Map<string, RawStats> {
  const map = new Map<string, RawStats>();
  
  for (const row of rows) {
    const key = row.behaviourKey;
    
    if (!map.has(key)) {
      map.set(key, { n: 0, wins: 0, losses: 0, totalR: 0, totalMFE: 0, totalMAE: 0 });
    }
    
    const stats = map.get(key)!;
    stats.n++;
    
    if (row.outcome.status === 'WIN') {
      stats.wins++;
    } else if (row.outcome.status === 'LOSS') {
      stats.losses++;
    }
    
    stats.totalR += row.outcome.rMultiple || 0;
    stats.totalMFE += row.outcome.mfe || 0;
    stats.totalMAE += Math.abs(row.outcome.mae || 0);
  }
  
  return map;
}

type ConditionKey = {
  patternType: string;
  condition: string;
};

function aggregateByCondition(rows: ScenarioBehaviour[]): Map<string, RawStats & ConditionKey> {
  const map = new Map<string, RawStats & ConditionKey>();
  
  // Conditions to track
  const conditions: Array<{ field: keyof ScenarioContext; values: any[] }> = [
    { field: 'volumeSpike', values: [true] },
    { field: 'maAlignment', values: [true] },
    { field: 'regime', values: ['STRONG_UP', 'STRONG_DOWN'] },
    { field: 'volatility', values: ['HIGH', 'EXTREME'] },
    { field: 'rsiZone', values: ['OVERSOLD', 'OVERBOUGHT'] },
    { field: 'atKeyLevel', values: [true] },
  ];
  
  for (const row of rows) {
    for (const { field, values } of conditions) {
      const contextValue = row.context[field];
      
      if (values.includes(contextValue)) {
        const condKey = `${row.patternType}:${field}=${contextValue}`;
        
        if (!map.has(condKey)) {
          map.set(condKey, {
            patternType: row.patternType,
            condition: `${field}=${contextValue}`,
            n: 0, wins: 0, losses: 0, totalR: 0, totalMFE: 0, totalMAE: 0
          });
        }
        
        const stats = map.get(condKey)!;
        stats.n++;
        
        if (row.outcome.status === 'WIN') stats.wins++;
        else if (row.outcome.status === 'LOSS') stats.losses++;
        
        stats.totalR += row.outcome.rMultiple || 0;
        stats.totalMFE += row.outcome.mfe || 0;
        stats.totalMAE += Math.abs(row.outcome.mae || 0);
      }
    }
  }
  
  return map;
}

// ═══════════════════════════════════════════════════════════════
// BUILDER CLASS
// ═══════════════════════════════════════════════════════════════

export class BehaviourModelBuilder {
  private scenarioCollection: Collection<ScenarioBehaviour>;
  private modelCollection: Collection<BehaviourModel>;
  
  constructor(db: Db) {
    this.scenarioCollection = db.collection('ta_scenario_behaviour');
    this.modelCollection = db.collection(BEHAVIOUR_MODELS_COLLECTION);
  }
  
  /**
   * Initialize model collection indexes
   */
  async initialize(): Promise<void> {
    await this.modelCollection.createIndex({ builtAt: -1 });
    await this.modelCollection.createIndex({ modelId: 1 }, { unique: true });
    console.log(`[BehaviourBuilder] Indexes created for ${BEHAVIOUR_MODELS_COLLECTION}`);
  }
  
  /**
   * Build a new behaviour model from scenario data
   */
  async build(rules: BehaviourModelRules = DEFAULT_BEHAVIOUR_RULES): Promise<BehaviourModel> {
    const startTime = Date.now();
    
    // Fetch completed scenarios only
    const rows = await this.scenarioCollection.find({
      'outcome.status': { $in: ['WIN', 'LOSS', 'PARTIAL'] }
    }).toArray();
    
    if (rows.length === 0) {
      throw new Error('No completed scenarios found for model building');
    }
    
    // Calculate global baseline
    const totalWins = rows.filter(r => r.outcome.status === 'WIN').length;
    const totalResolved = rows.filter(r => ['WIN', 'LOSS'].includes(r.outcome.status)).length;
    const globalWinRate = totalResolved > 0 ? totalWins / totalResolved : rules.baselineWinRate;
    
    // Aggregate by behaviour key
    const keyStats = aggregateByKey(rows);
    const keys: BehaviourKeyStats[] = [];
    
    for (const [key, stats] of keyStats) {
      const resolved = stats.wins + stats.losses;
      if (resolved === 0) continue;
      
      const winRate = stats.wins / resolved;
      const confidence = calculateConfidence(stats.n);
      const boost = calculateBoost(winRate, globalWinRate, confidence, rules);
      
      keys.push({
        behaviourKey: key,
        n: stats.n,
        wins: stats.wins,
        losses: stats.losses,
        winRate,
        avgR: stats.totalR / stats.n,
        avgMFE: stats.totalMFE / stats.n,
        avgMAE: stats.totalMAE / stats.n,
        confidence,
        boost,
      });
    }
    
    // Sort by sample size
    keys.sort((a, b) => b.n - a.n);
    
    // Aggregate by condition
    const condStats = aggregateByCondition(rows);
    const conditions: ConditionStats[] = [];
    
    // Calculate pattern-level baselines
    const patternBaselines = new Map<string, number>();
    for (const row of rows) {
      if (!patternBaselines.has(row.patternType)) {
        const patternRows = rows.filter(r => r.patternType === row.patternType);
        const patternWins = patternRows.filter(r => r.outcome.status === 'WIN').length;
        const patternResolved = patternRows.filter(r => ['WIN', 'LOSS'].includes(r.outcome.status)).length;
        patternBaselines.set(row.patternType, patternResolved > 0 ? patternWins / patternResolved : globalWinRate);
      }
    }
    
    for (const [, stats] of condStats) {
      const resolved = stats.wins + stats.losses;
      if (resolved < 5) continue; // Minimum samples for condition stats
      
      const winRate = stats.wins / resolved;
      const patternBaseline = patternBaselines.get(stats.patternType) || globalWinRate;
      const deltaWinRate = winRate - patternBaseline;
      const confidence = calculateConfidence(stats.n, 100); // Lower scale for conditions
      const boost = calculateBoost(winRate, patternBaseline, confidence, rules);
      
      conditions.push({
        patternType: stats.patternType,
        condition: stats.condition,
        n: stats.n,
        deltaWinRate,
        boost,
        confidence,
      });
    }
    
    // Sort by lift (delta win rate)
    conditions.sort((a, b) => b.deltaWinRate - a.deltaWinRate);
    
    // Build model
    const model: BehaviourModel = {
      modelId: uuid(),
      version: 1,
      builtAt: new Date(),
      buildDurationMs: Date.now() - startTime,
      rules,
      keys,
      conditions,
      summary: {
        totalScenarios: rows.length,
        uniqueKeys: keys.length,
        uniqueConditions: conditions.length,
        avgWinRate: globalWinRate,
        avgConfidence: keys.length > 0 
          ? keys.reduce((sum, k) => sum + k.confidence, 0) / keys.length 
          : 0,
      },
    };
    
    // Save to MongoDB
    await this.modelCollection.insertOne(model as any);
    
    return model;
  }
  
  /**
   * Get the latest model
   */
  async getLatestModel(): Promise<BehaviourModel | null> {
    const results = await this.modelCollection
      .find()
      .sort({ builtAt: -1 })
      .limit(1)
      .toArray();
    
    return results[0] || null;
  }
  
  /**
   * Get model by ID
   */
  async getModel(modelId: string): Promise<BehaviourModel | null> {
    return this.modelCollection.findOne({ modelId });
  }
  
  /**
   * Get all models
   */
  async getAllModels(): Promise<BehaviourModel[]> {
    return this.modelCollection
      .find()
      .sort({ builtAt: -1 })
      .toArray();
  }
  
  /**
   * Get model status
   */
  async getStatus(): Promise<{
    hasModel: boolean;
    latestModelId: string | null;
    builtAt: Date | null;
    keysCount: number;
    conditionsCount: number;
  }> {
    const model = await this.getLatestModel();
    
    return {
      hasModel: !!model,
      latestModelId: model?.modelId || null,
      builtAt: model?.builtAt || null,
      keysCount: model?.keys.length || 0,
      conditionsCount: model?.conditions.length || 0,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let builderInstance: BehaviourModelBuilder | null = null;

export function initBehaviourBuilder(db: Db): BehaviourModelBuilder {
  builderInstance = new BehaviourModelBuilder(db);
  return builderInstance;
}

export function getBehaviourBuilder(): BehaviourModelBuilder | null {
  return builderInstance;
}
